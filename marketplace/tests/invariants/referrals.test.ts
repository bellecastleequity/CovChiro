import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { applyToShift, autoCompleteDue, createShift, referrals, selectApplicant, startDueShifts } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider, uid } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
const DAY = 86_400_000;
type Clinic = Awaited<ReturnType<typeof makeClinic>>;
type Provider = Awaited<ReturnType<typeof makeProvider>>;

/** Book and complete one shift (deposit + balance charged), ending 3 hours ago. */
async function workShift(clinic: Clinic, provider: Provider, days: number) {
  const { startsAt, endsAt } = futureWeekday(days);
  const { shiftId } = await createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt }, { post: true });
  await applyToShift(provider.actor, shiftId, { commit: true });
  const { assignmentId } = await selectApplicant(clinic.actor, shiftId, provider.id);
  const end = new Date(Date.now() - 3 * 3_600_000);
  const start = new Date(+end - 8 * 3_600_000);
  await prisma.$executeRaw`ALTER TABLE "Shift" DISABLE TRIGGER shift_state_sync`;
  await prisma.shift.update({ where: { id: shiftId }, data: { startsAt: start, endsAt: end } });
  await prisma.$executeRaw`ALTER TABLE "Shift" ENABLE TRIGGER shift_state_sync`;
  await prisma.assignment.updateMany({ where: { shiftId }, data: { startsAt: start, endsAt: end } });
  await startDueShifts();
  await autoCompleteDue();
  const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
  expect(a.status).toBe("COMPLETED");
  return a;
}

const later = () => new Date(Date.now() + 4 * DAY);
const referralFor = (userId: string) => prisma.referral.findUniqueOrThrow({ where: { refereeUserId: userId } });

describe("referrals: provider invites provider", () => {
  it("pays both providers through the pay ledger once the friend's first shift is done", async () => {
    const referrer = await makeProvider();
    const friend = await makeProvider();
    const code = await referrals.referralCodeForUser(referrer.userId);
    expect(await referrals.invitation(code.toLowerCase())).toMatchObject({ code, friendRewardCents: 1000 });
    await referrals.recordReferralSignup(friend.userId, code);
    expect(await referralFor(friend.userId)).toMatchObject({ status: "PENDING", referrerUserId: referrer.userId });

    // Nothing until the first shift is done and the hold has passed.
    await referrals.referralSweep(later());
    expect((await referralFor(friend.userId)).status).toBe("PENDING");
    await workShift(await makeClinic(), friend, 30);
    await referrals.referralSweep(new Date());
    expect((await referralFor(friend.userId)).status).toBe("PENDING");

    await referrals.referralSweep(later());
    const r = await referralFor(friend.userId);
    expect(r).toMatchObject({ status: "REWARDED", referrerRewardCents: 2000, refereeRewardCents: 1000 });
    const p1 = await prisma.payout.findUniqueOrThrow({ where: { id: r.referrerPayoutId! } });
    const p2 = await prisma.payout.findUniqueOrThrow({ where: { id: r.refereePayoutId! } });
    expect(p1).toMatchObject({ providerId: referrer.id, amountCents: 2000, status: "SCHEDULED" });
    expect(p2).toMatchObject({ providerId: friend.id, amountCents: 1000, status: "SCHEDULED" });

    // Paying again is a no-op.
    expect(await referrals.payReferral(admin, r.id)).toBeNull();
    expect(await prisma.payout.count({ where: { providerId: referrer.id, description: { startsWith: "Referral bonus" } } })).toBe(1);
    const mine = await referrals.myReferrals(referrer.userId);
    expect(mine).toMatchObject({ code, earnedCents: 2000, joined: 1 });
  });
});

describe("referrals: provider invites a clinic", () => {
  it("the clinic's bonus is a credit that comes off its next shift automatically", async () => {
    const referrer = await makeProvider();
    const clinic = await makeClinic();
    await referrals.recordReferralSignup(clinic.user.id, await referrals.referralCodeForUser(referrer.userId));
    await workShift(clinic, await makeProvider(), 31);
    await referrals.referralSweep(later());
    const r = await referralFor(clinic.user.id);
    expect(r.status).toBe("REWARDED");
    expect(r.referrerPayoutId).toBeTruthy();
    expect(r.refereeCreditCode).toMatch(/^CREDIT-/);
    expect(await prisma.promoCode.findUniqueOrThrow({ where: { code: r.refereeCreditCode! } })).toMatchObject({ kind: "FIXED", value: 1000, maxUses: 1 });

    const { startsAt, endsAt } = futureWeekday(32);
    const { shiftId } = await createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt }, { post: true });
    const shift = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId }, include: { promoCode: true } });
    expect(shift.promoCode?.code).toBe(r.refereeCreditCode);
    expect(shift.promoDiscountCents).toBe(1000);
    // Once used, it isn't offered again.
    const p = await makeProvider();
    await applyToShift(p.actor, shiftId, { commit: true });
    await selectApplicant(clinic.actor, shiftId, p.id);
    expect(await referrals.referralCreditFor(clinic.org.id)).toBeNull();
  });
});

describe("referrals: checks", () => {
  it("flags a shared phone number for approval, then pays on approve", async () => {
    const referrer = await makeProvider();
    const friend = await makeProvider();
    await prisma.user.update({ where: { id: referrer.userId }, data: { phone: "(407) 555-0142" } });
    await prisma.user.update({ where: { id: friend.userId }, data: { phone: "407-555-0142" } });
    await referrals.recordReferralSignup(friend.userId, await referrals.referralCodeForUser(referrer.userId));
    await workShift(await makeClinic(), friend, 33);
    await referrals.referralSweep(later());
    const r = await referralFor(friend.userId);
    expect(r).toMatchObject({ status: "FLAGGED", flagReasons: ["same phone number"], referrerPayoutId: null });
    await referrals.approveReferral(admin, r.id);
    expect((await referralFor(friend.userId)).status).toBe("REWARDED");
  });

  it("ignores self-referrals and bad codes, keeps the first referrer, and expires stale invitations", async () => {
    const a = await makeProvider();
    const b = await makeProvider();
    const c = await makeProvider();
    expect(await referrals.recordReferralSignup(a.userId, await referrals.referralCodeForUser(a.userId))).toBeNull();
    expect(await referrals.recordReferralSignup(a.userId, `NOPE${uid().slice(0, 4)}`)).toBeNull();
    await referrals.recordReferralSignup(b.userId, await referrals.referralCodeForUser(a.userId));
    await referrals.recordReferralSignup(b.userId, await referrals.referralCodeForUser(c.userId));
    expect((await referralFor(b.userId)).referrerUserId).toBe(a.userId);
    await prisma.referral.update({ where: { refereeUserId: b.userId }, data: { expiresAt: new Date(Date.now() - DAY) } });
    await referrals.referralSweep();
    expect((await referralFor(b.userId)).status).toBe("EXPIRED");
  });

  it("rejects when the invited account is banned", async () => {
    const referrer = await makeProvider();
    const friend = await makeProvider();
    await referrals.recordReferralSignup(friend.userId, await referrals.referralCodeForUser(referrer.userId));
    await workShift(await makeClinic(), friend, 34);
    await prisma.user.update({ where: { id: friend.userId }, data: { disabledAt: new Date() } });
    await referrals.referralSweep(later());
    expect((await referralFor(friend.userId)).status).toBe("REJECTED");
  });
});
