import { HOUR, lodgingAdvancePlan, lodgingOnCancel, lodgingOnReplacement, lodgingReleaseFloor, type LodgingCancelOutcome } from "@cm/core";
import { prisma } from "@cm/db";
import { paymentsProvider } from "@cm/integrations";
import { audit, getSettings, SYSTEM, type Actor, type Db } from "./context";
import { notifyAdmins, notifyClinic } from "./notify";

/**
 * Lodging paid up front (owner decision Oct 2026; rules in core/lodging.ts).
 *
 *   confirm     → the deposit takes 100% of the lodging (less any hold on the shift);
 *                 LODGING payout row = the provider's lodging advance, PENDING until they reconfirm
 *   reconfirm   → SCHEDULED from 48 h before the start, sent at once when due
 *   provider drops out → advance reversed in Stripe, lodging HELD on the shift (Shift.lodgingHeldCents)
 *   replacement → the hold pays their lodging (Assignment.lodgingCreditCents), the rest is refunded
 *   unfilled / clinic cancels the shift → hold refunded
 *   clinic cancels late → provider keeps one night, the rest refunded
 *
 * Bookings made before this change (no LODGING_UPFRONT flag) keep lodging inside the SHIFT payout.
 */

export const UPFRONT_FLAG = "LODGING_UPFRONT";

/** The provider's pay without the lodging advance (which has its own payout row). */
export function shiftPayoutCents(a: { providerTotalCents: number; lodgingEstimateCents: number; flags: string[] }): number {
  return a.flags.includes(UPFRONT_FLAG) ? a.providerTotalCents - a.lodgingEstimateCents : a.providerTotalCents;
}

/** Inside the confirmation transaction: the lodging advance row. */
export async function createLodgingAdvance(db: Db, a: { id: string; providerId: string; startsAt: Date; confirmedAt: Date; lodgingEstimateCents: number }, label: string, now: Date) {
  if (a.lodgingEstimateCents <= 0) return;
  const plan = lodgingAdvancePlan({ startsAt: a.startsAt, confirmedAt: a.confirmedAt, now }, await getSettings(db));
  await db.payout.create({
    data: {
      providerId: a.providerId,
      assignmentId: a.id,
      kind: "LODGING",
      description: `Lodging advance · ${label}`,
      amountCents: a.lodgingEstimateCents,
      status: plan.waitForReconfirm ? "PENDING" : "SCHEDULED",
      releaseAt: plan.waitForReconfirm ? null : plan.releaseAt,
    },
  });
}

/** Lodging held on the shift from an earlier provider: what the new booking uses and what goes back. */
export async function takeShiftHold(db: Db, shiftId: string, newLodgingCents: number) {
  const shift = await db.shift.findUniqueOrThrow({ where: { id: shiftId }, select: { lodgingHeldCents: true } });
  const r = lodgingOnReplacement(shift.lodgingHeldCents, newLodgingCents);
  if (shift.lodgingHeldCents) await db.shift.update({ where: { id: shiftId }, data: { lodgingHeldCents: 0 } });
  return { heldCents: shift.lodgingHeldCents, ...r };
}

/** After confirmation: refund the part of the hold the replacement didn't need. */
export async function refundUnusedHold(shiftId: string, keepAssignmentId: string, amountCents: number) {
  if (amountCents <= 0) return;
  const refunded = await refundShiftLodging(SYSTEM, shiftId, amountCents, "lodging hold not needed by the replacement", { skip: keepAssignmentId });
  const shift = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId }, include: { location: true } });
  if (refunded > 0) {
    await notifyClinic(prisma, shift.location.clinicOrgId, {
      template: "lodging_hold_refunded",
      title: "Lodging refunded",
      body: `Your replacement provider doesn't need to stay over, so the $${(refunded / 100).toFixed(2)} lodging we held for this shift is being refunded to your card.`,
      link: `/clinic/shifts/${shiftId}`,
    });
  }
}

/** The provider reconfirmed (or tapped On my way): their lodging advance is released from 48 h before the start. */
export async function releaseLodgingOnReconfirm(assignmentId: string, now = new Date()) {
  const row = await prisma.payout.findFirst({ where: { assignmentId, kind: "LODGING", status: "PENDING" }, include: { assignment: true } });
  if (!row?.assignment) return null;
  const s = await getSettings();
  const at = new Date(Math.max(+now, +lodgingReleaseFloor(row.assignment.startsAt, s)));
  await prisma.payout.update({ where: { id: row.id }, data: { status: "SCHEDULED", releaseAt: at } });
  if (+at <= +now) return sendLodgingAdvance(row.id);
  return null;
}

/** Send one lodging advance now (payout setup and holds permitting); the payout job retries otherwise. */
export async function sendLodgingAdvance(payoutId: string) {
  const row = await prisma.payout.findUnique({ where: { id: payoutId }, include: { provider: true } });
  if (!row || row.status !== "SCHEDULED" || row.onHold || !row.provider.stripePayoutsEnabled) return null;
  const { issuePayment } = await import("./payouts");
  return issuePayment(SYSTEM, row.providerId, { payoutIds: [row.id] }).catch((e) => {
    console.error("lodging advance not sent", e);
    return null;
  });
}

/** Send an assignment's lodging advance if it's already due (booked inside the 48-hour window). */
export async function sendDueLodgingAdvance(assignmentId: string) {
  const row = await prisma.payout.findFirst({ where: { assignmentId, kind: "LODGING", status: "SCHEDULED", onHold: false, releaseAt: { lte: new Date() } } });
  return row ? sendLodgingAdvance(row.id) : null;
}

/** Deposit failed: the advance waits for the clinic's payment. Fixed: released again. */
export async function holdLodgingForPayment(assignmentId: string, hold: boolean) {
  await prisma.payout.updateMany({
    where: { assignmentId, kind: "LODGING", status: { in: ["PENDING", "SCHEDULED", "FAILED"] }, ...(hold ? {} : { holdReason: "Waiting for the clinic's payment" }) },
    data: hold ? { onHold: true, holdReason: "Waiting for the clinic's payment" } : { onHold: false, holdReason: null },
  });
}

// ---------------- cancellations ----------------

export interface LodgingCancelPlan {
  assignmentId: string;
  shiftId: string;
  providerId: string;
  /** Lodging inside this booking's paid deposit (left out of the deposit refund matrix). */
  depositPart: number;
  outcome: LodgingCancelOutcome;
  payoutId: string | null;
  paidOut: boolean;
}

/**
 * Before cancelling a booking: what happens to its lodging. Null for bookings without up-front lodging.
 * `depositPaid` = what the clinic paid toward this booking's deposit.
 */
export async function lodgingCancelPlan(
  a: { id: string; shiftId: string; providerId: string; startsAt: Date; flags: string[]; lodgingEstimateCents: number; lodgingCreditCents: number; depositCents: number },
  by: "CLINIC" | "PROVIDER" | "PLATFORM",
  reopen: boolean,
  now: Date,
  depositPaid: number,
): Promise<LodgingCancelPlan | null> {
  if (!a.flags.includes(UPFRONT_FLAG) || a.lodgingEstimateCents <= 0) return null;
  const own = a.lodgingEstimateCents - a.lodgingCreditCents;
  const depositPart = depositPaid > 0 ? Math.min(own, depositPaid) : 0;
  const row = await prisma.payout.findFirst({ where: { assignmentId: a.id, kind: "LODGING" } });
  const paidOut = row?.status === "PAID" ? row.amountCents : 0;
  const shift = await prisma.shift.findUniqueOrThrow({ where: { id: a.shiftId }, select: { lodgingCapCentsPerNight: true, flyInNightlyCents: true } });
  const assignment = await prisma.assignment.findUniqueOrThrow({ where: { id: a.id }, select: { flyIn: true } });
  const nightly = (assignment.flyIn ? shift.flyInNightlyCents : shift.lodgingCapCentsPerNight) ?? a.lodgingEstimateCents;
  const outcome = lodgingOnCancel(
    { by, reopen, now, startsAt: a.startsAt, lodgingCents: a.lodgingEstimateCents, nightlyCents: nightly, collectedCents: depositPart + a.lodgingCreditCents, paidOutCents: paidOut },
    await getSettings(),
  );
  return { assignmentId: a.id, shiftId: a.shiftId, providerId: a.providerId, depositPart, outcome, payoutId: row?.id ?? null, paidOut: paidOut > 0 };
}

/** Inside the cancel transaction, after unpaid payout rows were cancelled: the hold, and the night the provider keeps. */
export async function applyLodgingCancelInTx(db: Db, plan: LodgingCancelPlan | null, now: Date) {
  if (!plan) return;
  const { outcome } = plan;
  if (outcome.holdCents > 0) await db.shift.update({ where: { id: plan.shiftId }, data: { lodgingHeldCents: { increment: outcome.holdCents } } });
  if (outcome.providerKeepsCents > 0 && !plan.paidOut && plan.payoutId) {
    await db.payout.update({
      where: { id: plan.payoutId },
      data: { status: "SCHEDULED", amountCents: outcome.providerKeepsCents, releaseAt: now, onHold: false, holdReason: null, transferId: null, description: "Lodging kept: the clinic cancelled close to the start" },
    });
  }
}

/** After the cancel transaction: take the advance back and refund the clinic its lodging. */
export async function finishLodgingCancel(actor: Actor, plan: LodgingCancelPlan | null, reason: string) {
  if (!plan) return;
  if (plan.outcome.reverseCents > 0) await reverseLodgingAdvance(plan.assignmentId, plan.outcome.reverseCents, reason);
  if (plan.outcome.refundCents > 0) {
    await refundShiftLodging(actor, plan.shiftId, plan.outcome.refundCents, `lodging: ${reason}`, { first: plan.assignmentId, firstMax: plan.depositPart });
  }
  if (plan.outcome.providerKeepsCents > 0 && !plan.paidOut && plan.payoutId) await sendLodgingAdvance(plan.payoutId);
  await audit(prisma, actor, "lodging.cancel", "Assignment", plan.assignmentId, null, { ...plan.outcome, reason });
}

/**
 * Refund lodging money held on a shift. It sits in the clinic's charges for that shift's bookings:
 * `first` (up to firstMax) is used first, then the shift's other bookings, newest first.
 */
export async function refundShiftLodging(actor: Actor, shiftId: string, amountCents: number, reason: string, opts: { first?: string; firstMax?: number; skip?: string } = {}) {
  const { refundAssignment } = await import("./payments");
  let left = amountCents;
  if (opts.first && (opts.firstMax ?? 0) > 0) left -= await refundAssignment(actor, opts.first, Math.min(left, opts.firstMax!), reason);
  const others = await prisma.assignment.findMany({ where: { shiftId, id: { notIn: [opts.first, opts.skip].filter((x): x is string => !!x) } }, orderBy: { confirmedAt: "desc" }, select: { id: true } });
  for (const o of others) {
    if (left <= 0) break;
    left -= await refundAssignment(actor, o.id, left, reason);
  }
  if (left > 0) {
    await notifyAdmins(prisma, { template: "lodging_refund_short", title: "Lodging refund needs a look", body: `Shift ${shiftId}: $${(left / 100).toFixed(2)} of held lodging couldn't be refunded automatically (${reason}).`, link: `/admin/shifts/${shiftId}`, email: true });
  }
  return amountCents - left;
}

/** The shift will never be filled (start passed, or the clinic cancelled it): refund whatever lodging is held. */
export async function releaseShiftHold(actor: Actor, shiftId: string, reason: string) {
  const claimed = await prisma.shift.findUnique({ where: { id: shiftId }, select: { lodgingHeldCents: true } });
  if (!claimed?.lodgingHeldCents) return 0;
  const r = await prisma.shift.updateMany({ where: { id: shiftId, lodgingHeldCents: claimed.lodgingHeldCents }, data: { lodgingHeldCents: 0 } });
  if (r.count !== 1) return 0;
  const refunded = await refundShiftLodging(actor, shiftId, claimed.lodgingHeldCents, reason);
  await audit(prisma, actor, "lodging.hold_refunded", "Shift", shiftId, { lodgingHeldCents: claimed.lodgingHeldCents }, { refunded, reason });
  return refunded;
}

/** Job: shifts that reached their start unfilled get their held lodging back. */
export async function unfilledHoldSweep(now = new Date()) {
  const rows = await prisma.shift.findMany({ where: { lodgingHeldCents: { gt: 0 }, OR: [{ status: { in: ["UNFILLED", "CANCELLED"] } }, { startsAt: { lte: new Date(+now - HOUR) }, assignments: { none: { status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] } } } }] }, select: { id: true, location: { select: { clinicOrgId: true } } } });
  let refunded = 0;
  for (const r of rows) {
    const amt = await releaseShiftHold(SYSTEM, r.id, "no replacement provider was placed");
    if (amt > 0) {
      refunded++;
      await notifyClinic(prisma, r.location.clinicOrgId, {
        template: "lodging_hold_refunded",
        title: "Lodging refunded",
        body: `We couldn't place another provider for this shift, so the $${(amt / 100).toFixed(2)} lodging we held is being refunded to your card.`,
        link: `/clinic/shifts/${r.id}`,
      });
    }
  }
  return { refunded };
}

/**
 * Take back (part of) a lodging advance already sent: Stripe transfer reversals on its legs, newest
 * first. Whatever can't be reversed is recovered from the provider's next payment (negative adjustment).
 * One row per booking records it, so it never runs twice.
 */
export async function reverseLodgingAdvance(assignmentId: string, amountCents: number, reason: string) {
  const tag = `ref ${assignmentId}`;
  const done = await prisma.payout.findFirst({ where: { kind: "ADJUSTMENT", description: { contains: `Lodging advance returned` }, AND: { description: { contains: tag } } } });
  if (done) return 0;
  const row = await prisma.payout.findFirst({ where: { assignmentId, kind: "LODGING", status: "PAID" }, include: { transfer: { include: { legs: true } } } });
  if (!row) return 0;
  const legs = (row.transfer?.legs ?? []).filter((l) => l.status === "PAID" && l.stripeTransferId).reverse();
  let left = Math.min(amountCents, row.amountCents);
  let reversed = 0;
  let failure: string | null = null;
  for (const leg of legs) {
    if (left <= 0) break;
    const amt = Math.min(left, leg.amountCents);
    try {
      await paymentsProvider().reverseTransfer({ transferId: leg.stripeTransferId!, amountCents: amt, idempotencyKey: `lodging-reverse-${assignmentId}-${leg.id}`, metadata: { reason: "lodging_advance_returned", assignmentId } });
      if (leg.paymentId) await prisma.payment.update({ where: { id: leg.paymentId }, data: { transferredCents: { decrement: amt } } });
      left -= amt;
      reversed += amt;
    } catch (e) {
      failure = e instanceof Error ? e.message : String(e);
      break;
    }
  }
  const now = new Date();
  const label = `Lodging advance returned (${reason}) · ${tag}`;
  if (reversed > 0) {
    await prisma.payout.create({ data: { providerId: row.providerId, kind: "ADJUSTMENT", description: label.slice(0, 300), amountCents: -reversed, status: "PAID", releaseAt: now, paidAt: now } });
  }
  if (left > 0) {
    // Recovered from the next payment instead.
    await prisma.payout.create({ data: { providerId: row.providerId, kind: "ADJUSTMENT", description: `${label} · from your next payment`.slice(0, 300), amountCents: -left, status: "SCHEDULED", releaseAt: now } });
    await notifyAdmins(prisma, { template: "lodging_reversal_failed", title: "A lodging advance couldn't be taken back in Stripe", body: `$${(left / 100).toFixed(2)} will come off the provider's next payment${failure ? ` (${failure})` : ""}.`, link: "/admin/payouts", email: true });
  }
  await audit(prisma, SYSTEM, "lodging.advance_reversed", "Assignment", assignmentId, null, { reversed, recoverLater: left, reason, failure });
  return reversed;
}
