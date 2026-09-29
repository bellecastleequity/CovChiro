import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { devOutbox } from "@cm/integrations";
import {
  addAdjustment,
  applyToShift,
  autoCompleteDue,
  cancelAssignment,
  cancelShiftByClinic,
  createShift,
  earningsFor,
  issuePayment,
  leads,
  openDispute,
  payoutsOverview,
  promo,
  releaseDuePayouts,
  selectApplicant,
  setHold,
  shiftBoard,
  shiftCandidates,
  startDueShifts,
} from "@cm/services";
import { futureWeekday, makeClinic, makeProvider } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };

async function postShift(clinic: Awaited<ReturnType<typeof makeClinic>>, days = 21, promoCode?: string) {
  const { startsAt, endsAt } = futureWeekday(days);
  const { shiftId } = await createShift(clinic.actor, { locationId: clinic.location.id, professionCode: "DC", startsAt, endsAt, promoCode }, { post: true });
  return prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
}

/** Pretend time passed: move a confirmed shift into the past. */
async function shiftToPast(shiftId: string, hoursAgoEnd: number) {
  const end = new Date(Date.now() - hoursAgoEnd * 3_600_000);
  const start = new Date(+end - 8 * 3_600_000);
  await prisma.$executeRaw`ALTER TABLE "Shift" DISABLE TRIGGER shift_state_sync`;
  await prisma.shift.update({ where: { id: shiftId }, data: { startsAt: start, endsAt: end } });
  await prisma.$executeRaw`ALTER TABLE "Shift" ENABLE TRIGGER shift_state_sync`;
  await prisma.assignment.updateMany({ where: { shiftId }, data: { startsAt: start, endsAt: end } });
}

describe("Phase 1 end-to-end: post → apply → select → deposit → complete → balance → payout", () => {
  it("runs the whole money flow through the fake Stripe", async () => {
    const clinic = await makeClinic();
    const provider = await makeProvider();
    const shift = await postShift(clinic);
    expect(shift.status).toBe("OPEN");
    // FL-Central full day: $575 clinic / $375 provider (seed placeholders).
    expect(shift.clinicPriceCents).toBe(57500);
    expect(shift.providerPayCents).toBe(37500);

    // Board shows provider pay only.
    const board = await shiftBoard(provider.actor);
    const card = board.find((b) => b.id === shift.id)!;
    expect(card.pay.payCents).toBe(37500);
    expect(JSON.stringify(card)).not.toContain("57500");

    await applyToShift(provider.actor, shift.id, { commit: true, note: "Happy to help — call me at 407-555-1234" });
    const app = await prisma.application.findFirstOrThrow({ where: { shiftId: shift.id } });
    expect(app.note).toContain("[contact removed]");

    // Candidate list never exposes provider pay.
    const cands = await shiftCandidates(clinic.actor, shift.id);
    expect(cands.applicants.map((a) => a.providerId)).toContain(provider.id);
    expect(JSON.stringify(cands)).not.toMatch(/providerPay|payCents|37500/);

    const { assignmentId } = await selectApplicant(clinic.actor, shift.id, provider.id);
    const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { payments: true, payouts: true } });
    expect(a.clinicTotalCents).toBe(57500 + a.mileageCents);
    expect(a.providerTotalCents).toBe(37500 + a.mileageCents);
    expect(a.payments.find((p) => p.type === "DEPOSIT")).toMatchObject({ status: "SUCCEEDED", amountCents: Math.round(a.clinicTotalCents * 0.1) });
    expect(a.payouts).toHaveLength(1);
    expect(a.payouts[0]).toMatchObject({ kind: "SHIFT", status: "PENDING", amountCents: a.providerTotalCents });

    // Time passes: shift starts, ends, auto-completes 2h later.
    await shiftToPast(shift.id, 3);
    expect(await startDueShifts()).toBeGreaterThanOrEqual(1);
    expect(await autoCompleteDue()).toBeGreaterThanOrEqual(1);
    const done = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { payments: true, payouts: true } });
    expect(done.status).toBe("COMPLETED");
    const balance = done.payments.find((p) => p.type === "BALANCE")!;
    expect(balance.status).toBe("SUCCEEDED");
    expect(balance.amountCents + done.payments.find((p) => p.type === "DEPOSIT")!.amountCents).toBe(done.clinicTotalCents);
    expect(done.payouts[0].status).toBe("SCHEDULED");

    // 48h hold: not released by the job yet…
    await releaseDuePayouts();
    expect((await prisma.payout.findFirstOrThrow({ where: { assignmentId } })).status).toBe("SCHEDULED");
    // …after the hold it is.
    await prisma.payout.updateMany({ where: { assignmentId }, data: { releaseAt: new Date(Date.now() - 1000) } });
    await releaseDuePayouts();
    const paid = await prisma.payout.findFirstOrThrow({ where: { assignmentId }, include: { transfer: true } });
    expect(paid.status).toBe("PAID");
    expect(paid.transfer).toMatchObject({ status: "PAID", amountCents: done.providerTotalCents });
    expect(paid.transfer!.stripeTransferId).toMatch(/^tr_fake_/);

    // Paid rows are immutable.
    await expect(prisma.payout.update({ where: { id: paid.id }, data: { amountCents: 1 } })).rejects.toThrow(/immutable/);

    const earnings = await earningsFor(provider.id);
    expect(earnings.summary.paidCents).toBe(done.providerTotalCents);
  });
});

describe("provider pay ledger: holds, disputes, adjustments, issuing payment", () => {
  it("admin issues payment; holds and disputes block it; negative adjustments net out", async () => {
    const clinic = await makeClinic();
    const provider = await makeProvider();
    const shift = await postShift(clinic, 28);
    await applyToShift(provider.actor, shift.id, { commit: true });
    const { assignmentId } = await selectApplicant(clinic.actor, shift.id, provider.id);
    await shiftToPast(shift.id, 3);
    await startDueShifts();

    // Clinic opens a dispute within 48h: auto-complete skips it, payment is blocked.
    await openDispute(clinic.actor, assignmentId, "Provider arrived an hour late");
    await autoCompleteDue();
    expect((await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } })).status).toBe("IN_PROGRESS");
    const { resolveDispute } = await import("@cm/services");
    const dispute = await prisma.dispute.findFirstOrThrow({ where: { assignmentId } });
    await resolveDispute(admin, dispute.id, { resolution: "Partial refund of one hour", refundCents: 5000, payoutAdjustmentCents: -5000 });
    const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(a.status).toBe("COMPLETED");

    const shiftPayout = await prisma.payout.findFirstOrThrow({ where: { assignmentId, kind: "SHIFT" } });
    await setHold(admin, shiftPayout.id, true, "Checking timesheet");
    expect(await issuePayment(admin, provider.id, { early: true })).toBeNull(); // only the −$50 is left → nothing to send
    await setHold(admin, shiftPayout.id, false, null);
    await addAdjustment(admin, { providerId: provider.id, amountCents: 2500, description: "Thank-you bonus" });

    const overview = await payoutsOverview(admin);
    const row = overview.providers.find((p) => p.provider.id === provider.id)!;
    expect(row.summary.scheduledCents + row.summary.readyCents).toBe(a.providerTotalCents - 5000 + 2500);

    const r = await issuePayment(admin, provider.id, { early: true, note: "Paid early for Friday" });
    expect(r).toMatchObject({ status: "PAID", amountCents: a.providerTotalCents - 5000 + 2500 });
    expect(await prisma.payout.count({ where: { providerId: provider.id, status: { not: "PAID" } } })).toBe(0);
    // Nothing left to pay → second click is a no-op (no double payment).
    expect(await issuePayment(admin, provider.id, { early: true })).toBeNull();
    const refunds = await prisma.payment.findMany({ where: { assignmentId, type: "REFUND" } });
    expect(refunds.reduce((x, p) => x + p.amountCents, 0)).toBe(5000);
  });
});

describe("promo codes come out of the margin, never provider pay", () => {
  it("applies, caps at margin, counts redemption only on confirmation, voids on cancel", async () => {
    await promo.createPromo(admin, { code: "SPRING25", kind: "PERCENT", value: 25, maxUses: 5 });
    await promo.createPromo(admin, { code: "HUGE", kind: "FIXED", value: 1000 }); // $1,000 off → capped at margin
    const clinic = await makeClinic();
    const shift = await postShift(clinic, 35, "spring25");
    expect(shift.promoDiscountCents).toBe(Math.round(57500 * 0.25));
    expect(shift.providerPayCents).toBe(37500);
    expect((await prisma.promoCode.findUniqueOrThrow({ where: { code: "SPRING25" } })).usedCount).toBe(0);

    const clinic2 = await makeClinic();
    const capped = await postShift(clinic2, 35, "HUGE");
    expect(capped.promoDiscountCents).toBe(57500 - 37500);

    const provider = await makeProvider();
    await applyToShift(provider.actor, shift.id, { commit: true });
    const { assignmentId } = await selectApplicant(clinic.actor, shift.id, provider.id);
    const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
    expect(a.providerTotalCents).toBe(37500 + a.mileageCents);
    expect(a.clinicTotalCents).toBe(57500 - shift.promoDiscountCents + a.mileageCents);
    expect((await prisma.promoCode.findUniqueOrThrow({ where: { code: "SPRING25" } })).usedCount).toBe(1);
    // One use per clinic by default.
    await expect(postShift(clinic, 42, "SPRING25")).rejects.toMatchObject({ code: "PROMO_INVALID" });

    // Provider cancels → redemption voided and the use returned.
    await cancelAssignment(provider.actor, assignmentId, "Family emergency", { by: "PROVIDER" });
    expect((await prisma.promoCode.findUniqueOrThrow({ where: { code: "SPRING25" } })).usedCount).toBe(0);
    expect((await prisma.promoRedemption.findUniqueOrThrow({ where: { shiftId: shift.id } })).voidedAt).not.toBeNull();
  });

  it("campaign landing codes: library code can't be used directly; personal copy bound to the email works once", async () => {
    await promo.createPromo(admin, { code: "EXPO", kind: "FIXED", value: 50 });
    await promo.saveLanding(admin, "EXPO", { enabled: true, audience: "CLINIC", headline: "Expo special" });
    const landing = await promo.campaignForLanding("EXPO");
    expect(landing).toMatchObject({ offer: "$50 off", audience: "CLINIC" });
    const clinic = await makeClinic();
    await expect(postShift(clinic, 21, "EXPO")).rejects.toMatchObject({ code: "PROMO_INVALID" });
    const cap = await leads.captureLead({ name: "Casey", email: clinic.user.email, source: "landing", campaign: "EXPO" });
    expect(cap.code).toMatch(/^EXPO-/);
    const shift = await postShift(clinic, 21, cap.code!);
    expect(shift.promoDiscountCents).toBe(5000);
    const other = await makeClinic();
    await expect(postShift(other, 21, cap.code!)).rejects.toMatchObject({ code: "PROMO_INVALID" });
    const stats = (await promo.listPromos(admin)).find((p) => p.code === "EXPO")!;
    expect(stats.stats).toMatchObject({ visits: 1, signups: 1 });
  });
});

describe("cancellation matrix (SPEC §9.3)", () => {
  it("clinic ≥48h: deposit refunded; clinic <48h: forfeited with provider share", async () => {
    const clinic = await makeClinic();
    const provider = await makeProvider();
    const early = await postShift(clinic, 21);
    await applyToShift(provider.actor, early.id, { commit: true });
    const { assignmentId } = await selectApplicant(clinic.actor, early.id, provider.id);
    const out = await cancelShiftByClinic(clinic.actor, early.id, "Changed plans");
    expect(out!.refundDepositCents).toBeGreaterThan(0);
    expect(await prisma.payment.count({ where: { assignmentId, type: "REFUND" } })).toBe(1);

    const late = await postShift(clinic, 21);
    const p2 = await makeProvider();
    await applyToShift(p2.actor, late.id, { commit: true });
    const r2 = await selectApplicant(clinic.actor, late.id, p2.id);
    // Make it start in 24h.
    const start = new Date(Date.now() + 24 * 3_600_000);
    await prisma.shift.update({ where: { id: late.id }, data: { startsAt: start, endsAt: new Date(+start + 8 * 3_600_000) } });
    await prisma.assignment.update({ where: { id: r2.assignmentId }, data: { startsAt: start, endsAt: new Date(+start + 8 * 3_600_000) } });
    const out2 = await cancelShiftByClinic(clinic.actor, late.id, "Closed for storm");
    expect(out2).toMatchObject({ refundDepositCents: 0 });
    expect(out2!.providerCompensationCents).toBeGreaterThan(0);
    const comp = await prisma.payout.findFirstOrThrow({ where: { assignmentId: r2.assignmentId, kind: "LATE_CANCEL" } });
    expect(comp.amountCents).toBe(out2!.providerCompensationCents);
  });

  it("provider late cancel → full refund, lateCancel recorded, shift reopened for backfill", async () => {
    const clinic = await makeClinic();
    const provider = await makeProvider();
    const shift = await postShift(clinic, 21);
    await applyToShift(provider.actor, shift.id, { commit: true });
    const { assignmentId } = await selectApplicant(clinic.actor, shift.id, provider.id);
    const start = new Date(Date.now() + 30 * 3_600_000);
    await prisma.shift.update({ where: { id: shift.id }, data: { startsAt: start, endsAt: new Date(+start + 8 * 3_600_000) } });
    await prisma.assignment.update({ where: { id: assignmentId }, data: { startsAt: start, endsAt: new Date(+start + 8 * 3_600_000) } });
    const out = await cancelAssignment(provider.actor, assignmentId, "Sick", { by: "PROVIDER" });
    expect(out.countsAsLateCancel).toBe(true);
    expect((await prisma.providerStats.findUniqueOrThrow({ where: { providerId: provider.id } })).lateCancels).toBe(1);
    expect((await prisma.shift.findUniqueOrThrow({ where: { id: shift.id } })).status).toBe("OPEN");
    expect(await prisma.payment.count({ where: { assignmentId, type: "REFUND" } })).toBe(1);
  });
});

describe("leads", () => {
  it("popup → welcome code + first email; drip; signup stops it; unsubscribe", async () => {
    const email = `lead-${Date.now()}@test.dev`;
    const r = await leads.captureLead({ name: "Jordan Smith", email, source: "popup", audience: "CLINIC" });
    expect(r.code).toMatch(/^WELCOME-/);
    expect(devOutbox.some((m) => m.to === email && /WELCOME-/.test(m.subject ?? ""))).toBe(true);
    // Signing up again returns the same code.
    const again = await leads.captureLead({ name: "Jordan Smith", email, source: "popup", audience: "CLINIC" });
    expect(again).toMatchObject({ code: r.code, alreadySignedUp: true });
    const lead = await prisma.lead.findFirstOrThrow({ where: { email } });
    expect(lead.dripStep).toBe(1);
    await prisma.lead.update({ where: { id: lead.id }, data: { nextDripAt: new Date(Date.now() - 1000) } });
    await leads.runLeadDrip();
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).dripStep).toBe(2);
    expect(await leads.unsubscribe(lead.unsubscribeToken)).toBe(true);
    expect((await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } })).status).toBe("UNSUBSCRIBED");
  });

  it("waitlist signups record profession + state and never get a promo code", async () => {
    const r = await leads.captureLead({ name: "Ana Ruiz", email: `wait-${Date.now()}@test.dev`, source: "waitlist", audience: "PROVIDER", professionCode: "LMT", state: "FL" });
    expect(r.code).toBeNull();
    const lead = await prisma.lead.findUniqueOrThrow({ where: { id: r.leadId } });
    expect(lead).toMatchObject({ professionCode: "LMT", state: "FL", status: "NURTURING", audience: "PROVIDER" });
  });
});
