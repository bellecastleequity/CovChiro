import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { applyToShift, clinicRate, createShift, dispatch, invalidateSettings, selectApplicant, shiftChanges } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider } from "../factories";

const HOUR = 3_600_000;
async function setSetting(key: string, value: unknown) {
  await prisma.setting.upsert({ where: { key }, create: { key, value: value as object }, update: { value: value as object } });
  invalidateSettings();
}

beforeAll(async () => setSetting("clinicRate.enabled", true));
afterAll(async () => {
  await prisma.setting.deleteMany({ where: { key: { startsWith: "clinicRate." } } });
  invalidateSettings();
});

/** Orlando DC full day: market $625 clinic / $500 provider (same as the flows test). */
async function post(clinic: Awaited<ReturnType<typeof makeClinic>>, over: Record<string, unknown> = {}, days = 21) {
  const { startsAt, endsAt } = futureWeekday(days);
  const releaseAt = new Date(+startsAt - 72 * HOUR).toISOString();
  return createShift(
    clinic.actor,
    { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt, clinicRate: { priceCents: 55000, release: true, releaseAt, releaseHours: 72, accepted: true, ...over } } as never,
    { post: true },
  );
}

describe("Clinic-set rate (beta)", () => {
  it("posts at the clinic's rate: same provider share, receipt stored and emailed, never auto-filled", async () => {
    const clinic = await makeClinic();
    const { shiftId } = await post(clinic);
    const sh = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(sh).toMatchObject({ rateMode: "CLINIC", clinicPriceCents: 55000, providerPayCents: 44000, marketClinicPriceCents: 62500, marketProviderPayCents: 50000, releaseOnUnfilled: true, releaseHours: 72, instantBook: false, promoDiscountCents: 0 });
    expect(+sh.releaseAt!).toBe(+sh.startsAt - 72 * HOUR);
    expect(sh.selectionDeadline).toBeNull();
    const terms = sh.rateTerms as { text: string; acceptedById: string; floorCents: number };
    expect(terms.acceptedById).toBe(clinic.user.id);
    expect(terms.floorCents).toBe(50000);
    expect(terms.text).toContain("$550.00");
    expect(terms.text).toMatch(/between 72 and 168 hours/);
    expect(await prisma.notification.count({ where: { userId: clinic.user.id, template: "clinic_rate_receipt" } })).toBe(1);
    // Not filled automatically.
    expect((await dispatch.startDispatch(shiftId, "CLINIC_REQUEST" as never)).dispatchId).toBeNull();
    await prisma.shift.update({ where: { id: shiftId }, data: { selectionDeadline: null } });
    await dispatch.runSelectionDeadlines(new Date(+sh.startsAt - 24 * HOUR));
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } })).status).not.toBe("CONFIRMED");
    expect(shiftChanges.canChange(sh)).toBe(false);
    // A provider applies and the clinic confirms at its rate.
    const p = await makeProvider();
    await applyToShift(p.actor, shiftId, { commit: true });
    await selectApplicant(clinic.actor, shiftId, p.id);
    const a = await prisma.assignment.findFirstOrThrow({ where: { shiftId, status: "CONFIRMED" } });
    expect(a.clinicPriceCents).toBe(55000);
    expect(a.providerPayCents).toBe(44000);
  });

  it("refuses: below the floor, at or above market, with a promo, inside the window, as a draft, multi-day, or when the window changed", async () => {
    const clinic = await makeClinic();
    await expect(post(clinic, { priceCents: 49900 })).rejects.toThrow(/at least \$500/);
    await expect(post(clinic, { priceCents: 62500 })).rejects.toThrow(/at or above the market/);
    await expect(post(clinic, { accepted: false })).rejects.toThrow(/confirm you understand/);
    await expect(post(clinic, { releaseHours: 96 })).rejects.toThrow(/window has just changed/);
    await expect(post(clinic, { releaseAt: new Date().toISOString() })).rejects.toThrow(/release time has changed/);
    const { startsAt, endsAt } = futureWeekday(21);
    await expect(createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt, promoCode: "WHATEVER", clinicRate: { priceCents: 55000, release: true, releaseAt: null, releaseHours: 72, accepted: true } } as never, { post: true })).rejects.toThrow(/Promo codes can't be combined/);
    await expect(createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt, clinicRate: { priceCents: 55000, release: true, releaseAt: null, releaseHours: 72, accepted: true } } as never, { post: false })).rejects.toThrow(/applied when you post/);
    const soon = new Date(Date.now() + 48 * HOUR);
    await expect(createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt: soon, endsAt: new Date(+soon + 8 * HOUR), clinicRate: { priceCents: 55000, release: true, releaseAt: null, releaseHours: 72, accepted: true } } as never, { post: true })).rejects.toThrow(/more than 72 hours/);
    const { bookings } = await import("@cm/services");
    const d2 = { locationId: clinic.location.id, professionCode: "DC", startsAt: new Date(+startsAt + 7 * 24 * HOUR), endsAt: new Date(+endsAt + 7 * 24 * HOUR) };
    await expect(bookings.createMultiDay(clinic.actor, [{ locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt, clinicRate: { priceCents: 55000, release: true, releaseAt: null, releaseHours: 72, accepted: true } } as never, d2], { post: true })).rejects.toThrow(/single-day/);
    await setSetting("clinicRate.enabled", false);
    await expect(post(clinic)).rejects.toThrow(/isn't available/);
    await setSetting("clinicRate.enabled", true);
  });

  it("releases an unfilled shift to market at its release time; applicants hear the pay went up", async () => {
    const clinic = await makeClinic();
    const { shiftId } = await post(clinic);
    const p = await makeProvider();
    await applyToShift(p.actor, shiftId, { commit: true });
    await prisma.shift.update({ where: { id: shiftId }, data: { releaseAt: new Date(Date.now() - 60_000) } });
    expect(await clinicRate.releaseDueClinicRates()).toBeGreaterThanOrEqual(1);
    const sh = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(sh.releasedAt).not.toBeNull();
    expect(sh.clinicPriceCents).toBe(62500);
    expect(sh.providerPayCents).toBe(50000);
    expect(sh.selectionDeadline).not.toBeNull();
    expect(sh.rateMode).toBe("CLINIC"); // history kept; releasedAt marks it as market now
    expect(await prisma.notification.count({ where: { userId: p.userId, template: "clinic_rate_released_provider" } })).toBe(1);
    expect(await prisma.notification.count({ where: { userId: clinic.user.id, template: "clinic_rate_released" } })).toBe(1);
    expect(shiftChanges.canChange(sh)).toBe(true);
  });

  it("'don't release' is never released by the job; the clinic can still release now", async () => {
    const clinic = await makeClinic();
    const { shiftId } = await post(clinic, { release: false, releaseAt: null });
    await prisma.shift.update({ where: { id: shiftId }, data: { releaseAt: new Date(Date.now() - 60_000) } });
    await clinicRate.releaseDueClinicRates();
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } })).releasedAt).toBeNull();
    const r = await clinicRate.releaseNow(clinic.actor, shiftId);
    expect(r.clinicPriceCents).toBe(62500);
    await expect(clinicRate.releaseNow(clinic.actor, shiftId)).rejects.toThrow(/already at the market/);
  });
});
