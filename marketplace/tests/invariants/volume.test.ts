import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { applyToShift, autoCompleteDue, bookings, createShift, getEligibleProviders, payfloors, quoteForClinic, selectApplicant, shiftBoard, startDueShifts, volume } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider } from "../factories";

type Clinic = Awaited<ReturnType<typeof makeClinic>>;
type Provider = Awaited<ReturnType<typeof makeProvider>>;
const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
const later = (h: number) => new Date(Date.now() + h * 3_600_000);

async function post(clinic: Clinic, expectedPatients: number | null, days: number) {
  const { startsAt, endsAt } = futureWeekday(days);
  const { shiftId } = await createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt, expectedPatients }, { post: true });
  return prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
}

/** Book, then pretend the day happened and the booking auto-completed (balance charged). */
async function worked(clinic: Clinic, provider: Provider, expected: number, days: number) {
  const shift = await post(clinic, expected, days);
  await applyToShift(provider.actor, shift.id, { commit: true });
  const { assignmentId } = await selectApplicant(clinic.actor, shift.id, provider.id);
  const end = new Date(Date.now() - 3 * 3_600_000);
  const start = new Date(+end - 8 * 3_600_000);
  await prisma.$executeRaw`ALTER TABLE "Shift" DISABLE TRIGGER shift_state_sync`;
  await prisma.shift.update({ where: { id: shift.id }, data: { startsAt: start, endsAt: end } });
  await prisma.$executeRaw`ALTER TABLE "Shift" ENABLE TRIGGER shift_state_sync`;
  await prisma.assignment.updateMany({ where: { shiftId: shift.id }, data: { startsAt: start, endsAt: end } });
  await startDueShifts();
  await autoCompleteDue();
  return assignmentId;
}

const volumePaid = async (assignmentId: string) =>
  (await prisma.payment.findMany({ where: { assignmentId, type: "VOLUME", status: "SUCCEEDED" } })).reduce((x, p) => x + p.amountCents, 0);
const volumePayout = (assignmentId: string) => prisma.payout.findUnique({ where: { assignmentId_kind: { assignmentId, kind: "VOLUME" } } });

describe("volume pricing (Light / Busy + extra visits)", () => {
  it("expected visits pick the tier; the shift keeps the terms in force at posting", async () => {
    const clinic = await makeClinic();
    const light = await post(clinic, 10, 60);
    expect(light).toMatchObject({ declaredTier: "LIGHT", clinicPriceCents: 50000, providerPayCents: 42000 });
    expect(light.volumeTerms).toEqual({ ceiling: 12, grace: 5, overageClinicCents: 1000, overageProviderCents: 800 });
    const busy = await post(clinic, 22, 61);
    expect(busy).toMatchObject({ declaredTier: "BUSY", clinicPriceCents: 62500, providerPayCents: 50000 });
    // No number given = Busy.
    expect((await post(clinic, null, 62)).declaredTier).toBe("BUSY");

    // Clinic quote shows both tier prices and the rule, never provider pay.
    const { startsAt, endsAt } = futureWeekday(63);
    const q = await quoteForClinic(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt, expectedPatients: 8 });
    expect(q.volume).toMatchObject({ tier: "LIGHT", clinicPrices: { LIGHT: 50000, BUSY: 62500 }, ceilings: { LIGHT: 12, BUSY: 30 } });
    expect(JSON.stringify(q)).not.toMatch(/42000|providerPay|overageProvider/);

    // Provider sees the tier and expected visits on the board with their pay.
    const provider = await makeProvider();
    const card = (await shiftBoard(provider.actor)).find((b) => b.id === light.id);
    expect(card?.pay.payCents).toBe(42000);
  });

  it("provider count stands after the clinic's window: extra visits past ceiling + grace are charged, then paid", async () => {
    const clinic = await makeClinic();
    const provider = await makeProvider();
    const id = await worked(clinic, provider, 10, 64); // LIGHT: 12 + 5 grace
    const r = await volume.submitVisits(provider.actor, id, 25);
    expect(r.overageVisits).toBe(8);
    // Not charged inside the clinic's 2-hour window.
    expect(await volume.volumeSweep(later(1))).toBe(0);
    expect(await volumePaid(id)).toBe(0);
    await volume.volumeSweep(later(3));
    expect(await volumePaid(id)).toBe(8000);
    expect(await volumePayout(id)).toMatchObject({ amountCents: 6400, status: "SCHEDULED" });
    expect(await prisma.visitCount.findUnique({ where: { assignmentId: id } })).toMatchObject({ status: "FINAL", outcome: "PROVIDER", finalVisits: 25, overageClinicCents: 8000, overageProviderCents: 6400 });
    // Settled: no more changes from either side.
    await expect(volume.submitVisits(provider.actor, id, 30)).rejects.toThrow();
  });

  it("a fewer-visits day never lowers the booked price; within-grace day costs nothing extra", async () => {
    const clinic = await makeClinic();
    const provider = await makeProvider();
    const id = await worked(clinic, provider, 25, 65); // BUSY
    await volume.submitVisits(provider.actor, id, 9);
    await volume.confirmVisitsAsClinic(clinic.actor, id);
    await volume.volumeSweep(later(0.1));
    expect(await volumePaid(id)).toBe(0);
    expect(await volumePayout(id)).toBeNull();
    const a = await prisma.assignment.findUniqueOrThrow({ where: { id } });
    expect(a.clinicPriceCents).toBe(62500);
  });

  it("clinic count within 2 → average rounded down; beyond → lower count billed, admin sets the rest", async () => {
    const clinic = await makeClinic();
    const p1 = await makeProvider();
    const a1 = await worked(clinic, p1, 10, 66);
    await volume.submitVisits(p1.actor, a1, 22);
    await volume.reportVisitsAsClinic(clinic.actor, a1, 20, "Two were no-shows");
    await volume.volumeSweep(later(3));
    expect(await prisma.visitCount.findUnique({ where: { assignmentId: a1 } })).toMatchObject({ outcome: "SPLIT", finalVisits: 21, overageVisits: 4 });
    expect(await volumePaid(a1)).toBe(4000);

    const clinic2 = await makeClinic();
    const p2 = await makeProvider();
    const a2 = await worked(clinic2, p2, 10, 67);
    await volume.submitVisits(p2.actor, a2, 30);
    await volume.reportVisitsAsClinic(clinic2.actor, a2, 20, "We only saw twenty");
    await volume.volumeSweep(later(3));
    expect(await prisma.visitCount.findUnique({ where: { assignmentId: a2 } })).toMatchObject({ status: "DISPUTED", finalVisits: 20, overageVisits: 3 });
    expect(await volumePaid(a2)).toBe(3000);
    expect((await volumePayout(a2))?.amountCents).toBe(2400);
    // Clinic can't change it after the window; the provider's view never shows the clinic's reason.
    await expect(volume.confirmVisitsAsClinic(clinic2.actor, a2)).rejects.toThrow();
    expect((await volume.visitViewForProvider(p2.actor, a2))?.clinicReason).toBeNull();

    await volume.adminSetVisits(admin, a2, 26, "Checked sign-in sheet totals");
    expect(await volumePaid(a2)).toBe(9000);
    expect((await volumePayout(a2))?.amountCents).toBe(7200);
    expect(await prisma.visitCount.findUnique({ where: { assignmentId: a2 } })).toMatchObject({ status: "FINAL", outcome: "ADMIN", finalVisits: 26 });
  });

  it("F12: a provider's minimum pay hides lower-paying shifts; a Busy day clears it", async () => {
    const clinic = await makeClinic();
    const provider = await makeProvider();
    await payfloors.savePayFloor(provider.actor, { professionCode: "DC", minFullDayCents: 45000 });
    const light = await post(clinic, 8, 68);
    const busy = await post(clinic, 20, 69);
    const ids = async (shiftId: string) => (await getEligibleProviders(prisma, shiftId)).eligible.map((e) => e.providerId);
    expect(await ids(light.id)).not.toContain(provider.id);
    expect(await ids(busy.id)).toContain(provider.id);
    const board = (await shiftBoard(provider.actor)).map((b) => b.id);
    expect(board).not.toContain(light.id);
    expect(board).toContain(busy.id);
    await expect(applyToShift(provider.actor, light.id, { commit: true })).rejects.toMatchObject({ code: "BELOW_PAY_FLOOR" });
    // Clearing the floor brings them back.
    await payfloors.savePayFloor(provider.actor, { professionCode: "DC", minFullDayCents: null });
    expect(await ids(light.id)).toContain(provider.id);
  });

  it("several providers at once = one separate booking each; one provider can't take two", async () => {
    const clinic = await makeClinic();
    const { startsAt, endsAt } = futureWeekday(70);
    const r = await bookings.createForProviders(clinic.actor, [{ locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt, expectedPatients: 15 }], 2, { post: true });
    expect(r.bookings).toBe(2);
    expect(r.shiftIds).toHaveLength(2);
    const [s1, s2] = await Promise.all(r.shiftIds.map((id) => prisma.shift.findUniqueOrThrow({ where: { id } })));
    expect(s1).toMatchObject({ declaredTier: "BUSY", status: "OPEN" });
    expect(s2.startsAt).toEqual(s1.startsAt);
    // The clinic quote mentions the overlap; it's allowed.
    const q = await quoteForClinic(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt, expectedPatients: 15 });
    expect(q.overlapping).toBe(2);

    const p1 = await makeProvider();
    const p2 = await makeProvider();
    await applyToShift(p1.actor, s1.id, { commit: true });
    await selectApplicant(clinic.actor, s1.id, p1.id);
    // Same provider is now busy at that time for the second booking.
    await expect(applyToShift(p1.actor, s2.id, { commit: true })).rejects.toThrow();
    await applyToShift(p2.actor, s2.id, { commit: true });
    await selectApplicant(clinic.actor, s2.id, p2.id);
    await expect(bookings.createForProviders(clinic.actor, [{ locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt }], 9, { post: true })).rejects.toThrow(/1 to 5/);
  });
});
