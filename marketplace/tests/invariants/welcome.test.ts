import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { applyToShift, cancelShiftByClinic, createShift, invalidateSettings, promo, quoteForClinic, quoteShift, selectApplicant, welcome } from "@cm/services";
import type { Actor } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider, uid } from "../factories";

async function setSetting(key: string, value: unknown) {
  await prisma.setting.upsert({ where: { key }, create: { key, value: value as object }, update: { value: value as object } });
  invalidateSettings();
}
const admin = async (): Promise<Actor> => {
  const u = await prisma.user.create({ data: { email: `a-${uid()}@test.dev`, name: "Admin", role: "PLATFORM_ADMIN", emailVerifiedAt: new Date() } });
  return { userId: u.id, role: "PLATFORM_ADMIN", providerId: null, clinicOrgId: null };
};
/** Test clinics share one street address by default; the duplicate-business check needs each to be distinct. */
const newClinic = () => makeClinic({ address: `${Math.floor(Math.random() * 9000) + 100} Welcome Way ${uid()}` });
const post = async (c: Awaited<ReturnType<typeof makeClinic>>, days: number) =>
  (await createShift(c.actor, { locationId: c.location.id, professionCode: "DC", ...futureWeekday(days) } as never, { post: true })).shiftId;
async function book(c: Awaited<ReturnType<typeof makeClinic>>, shiftId: string) {
  const p = await makeProvider();
  await applyToShift(p.actor, shiftId, { commit: true });
  await selectApplicant(c.actor, shiftId, p.id);
  return prisma.assignment.findFirstOrThrow({ where: { shiftId } });
}
async function complete(assignmentId: string) {
  await prisma.assignment.update({ where: { id: assignmentId }, data: { status: "COMPLETED", completedAt: new Date() } });
  await welcome.welcomeSweep();
}

beforeAll(async () => setSetting("welcome.enabled", true));
afterAll(async () => {
  await prisma.setting.upsert({ where: { key: "welcome.enabled" }, create: { key: "welcome.enabled", value: false }, update: { value: false } });
  invalidateSettings();
});

describe("Welcome Discount: 15% off a clinic's first 3 completed bookings", () => {
  it("quotes 15% of the base rate automatically, with no code; provider pay never changes", async () => {
    const c = await newClinic();
    const q = await quoteForClinic(c.actor, { locationId: c.location.id, professionCode: "DC", ...futureWeekday(21) } as never);
    const plain = await quoteShift(prisma, { locationId: c.location.id, professionCode: "DC", ...futureWeekday(21) });
    expect(plain.welcome).toBeNull();
    expect(q.welcome).toMatchObject({ percent: 15, available: 3 });
    expect(q.welcome!.discountCents).toBe(Math.round(q.welcome!.baseCents * 0.15));

    const shiftId = await post(c, 21);
    const sh = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
    expect(sh.welcomeDiscountCents).toBe(q.welcome!.discountCents);
    expect(sh.promoDiscountCents).toBe(q.welcome!.discountCents);
    expect(sh.providerPayCents).toBe(plain.base.providerPayCents);

    const a = await book(c, shiftId);
    expect(a.welcomeDiscountCents).toBe(sh.welcomeDiscountCents);
    expect(a.providerPayCents).toBe(sh.providerPayCents);
    const r = await prisma.welcomeRedemption.findUniqueOrThrow({ where: { shiftId } });
    expect(r).toMatchObject({ status: "RESERVED", assignmentId: a.id, discountCents: sh.welcomeDiscountCents });

    // Completion redeems it, the clinic hears how many are left, once.
    await complete(a.id);
    expect((await prisma.welcomeRedemption.findUniqueOrThrow({ where: { shiftId } })).status).toBe("REDEEMED");
    await welcome.welcomeSweep();
    const mine = await welcome.clinicWelcome(c.actor);
    expect(mine).toMatchObject({ stage: "TWO_LEFT", counts: { used: 1, available: 2, remaining: 2 }, savedCents: sh.welcomeDiscountCents });
    expect(mine!.slots.map((s) => s.status)).toEqual(["USED", "AVAILABLE", "AVAILABLE"]);
  });

  it("never gives more than three: posted shifts hold their place, the 4th is standard price", async () => {
    const c = await newClinic();
    const ids = [await post(c, 21), await post(c, 28), await post(c, 35), await post(c, 42)];
    const shifts = await prisma.shift.findMany({ where: { id: { in: ids } } });
    const by = new Map(shifts.map((s) => [s.id, s]));
    expect(ids.map((id) => by.get(id)!.welcomeDiscountCents > 0)).toEqual([true, true, true, false]);
    const st = await welcome.welcomeState(prisma, c.org.id);
    expect(st!.counts).toMatchObject({ pending: 3, available: 0, remaining: 3 });
    expect(st!.canUse).toBe(false);

    // Cancelling a booked one makes it available again.
    await book(c, ids[0]);
    expect((await prisma.welcomeRedemption.findUniqueOrThrow({ where: { shiftId: ids[0] } })).status).toBe("RESERVED");
    await cancelShiftByClinic(c.actor, ids[0], "No longer needed");
    expect((await prisma.welcomeRedemption.findUniqueOrThrow({ where: { shiftId: ids[0] } })).status).toBe("RELEASED");
    expect((await welcome.welcomeState(prisma, c.org.id))!.counts).toMatchObject({ pending: 2, available: 1 });
  });

  it("confirmation never exceeds the total even if the discount was priced before others were used", async () => {
    const c = await newClinic();
    const ids = [await post(c, 21), await post(c, 28), await post(c, 35)];
    // A 4th shift priced with the discount by a stale screen: confirmation drops it under the lock.
    const extra = await post(c, 42);
    const priced = (await prisma.shift.findUniqueOrThrow({ where: { id: ids[0] } })).welcomeDiscountCents;
    await prisma.shift.update({ where: { id: extra }, data: { welcomeDiscountCents: priced, promoDiscountCents: priced } });
    for (const id of ids) await book(c, id);
    const a = await book(c, extra);
    expect(a.welcomeDiscountCents).toBe(0);
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: extra } })).welcomeDiscountCents).toBe(0);
    expect(await prisma.welcomeRedemption.count({ where: { clinicOrgId: c.org.id, status: { in: ["RESERVED", "REDEEMED"] } } })).toBe(3);
  });

  it("a typed promo code gives the larger of the two, never both; the welcome waits when the code wins", async () => {
    const a = await admin();
    const small = `WSM${uid()}`.toUpperCase(), big = `WBG${uid()}`.toUpperCase();
    await promo.createPromo(a, { code: small, kind: "FIXED", value: 5 });
    await promo.createPromo(a, { code: big, kind: "PERCENT", value: 30 });
    const c = await newClinic();
    const input = { locationId: c.location.id, professionCode: "DC", ...futureWeekday(21) };
    const q1 = await quoteForClinic(c.actor, { ...input, promoCode: small } as never);
    expect(q1.welcome).not.toBeNull();
    expect(q1.promoCode).toBeNull();
    expect(q1.promoSetAside).toBe(small);
    const q2 = await quoteForClinic(c.actor, { ...input, promoCode: big } as never);
    expect(q2.welcome).toBeNull();
    expect(q2.promoCode).toBe(big);
    expect(q2.promoSetAside).toBeNull();
  });

  it("an established clinic's earlier completed bookings count toward the three", async () => {
    const c = await newClinic();
    const ids = [await post(c, 21), await post(c, 28)];
    // Simulate history from before the offer: an entitlement recorded with 2 prior completions.
    await prisma.welcomeRedemption.deleteMany({ where: { clinicOrgId: c.org.id } });
    await prisma.shift.updateMany({ where: { id: { in: ids } }, data: { status: "CANCELLED", welcomeDiscountCents: 0 } });
    await prisma.welcomeEntitlement.update({ where: { clinicOrgId: c.org.id }, data: { priorCompleted: 2 } });
    const st = await welcome.welcomeState(prisma, c.org.id);
    expect(st!.counts).toMatchObject({ used: 2, available: 1 });
    const mine = await welcome.clinicWelcome(c.actor);
    expect(mine!.stage).toBe("ONE_LEFT");
  });

  it("a new account for a business that already booked waits for an admin; approval releases it", async () => {
    const address = `77 Repeat Rd ${uid()}`;
    const first = await makeClinic({ address });
    const s1 = await post(first, 21);
    await complete((await book(first, s1)).id);

    const again = await makeClinic({ address });
    const st = await welcome.welcomeState(prisma, again.org.id);
    expect(st!.entitlement.status).toBe("REVIEW");
    expect(st!.canUse).toBe(false);
    const q = await quoteForClinic(again.actor, { locationId: again.location.id, professionCode: "DC", ...futureWeekday(28) } as never);
    expect(q.welcome).toBeNull();

    const a = await admin();
    await expect(welcome.adminAdjust(a, again.org.id, { op: "approve", note: "" })).rejects.toThrow(/note/);
    await welcome.adminAdjust(a, again.org.id, { op: "approve", note: "Different owner, new practice" });
    const after = await welcome.welcomeState(prisma, again.org.id);
    expect(after!.entitlement.status).toBe("ACTIVE");
    expect(after!.canUse).toBe(true);
    expect(await prisma.auditLog.count({ where: { action: "welcome.approve", entityId: after!.entitlement.id } })).toBe(1);
  });

  it("the admin report counts the discounts given", async () => {
    const report = await welcome.welcomeReport(await admin());
    expect(report.settings).toMatchObject({ enabled: true, percent: 15, bookings: 3 });
    expect(report.redeemed).toBeGreaterThanOrEqual(1);
    expect(report.discountsFundedCents).toBeGreaterThan(0);
  });
});
