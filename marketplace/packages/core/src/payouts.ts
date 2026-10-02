import type { PayoutStatus } from "./stateMachines";
import { HOUR } from "./time";

/**
 * Provider pay ledger. Every dollar owed to a provider is a Payout row:
 *   SHIFT         pay + mileage for a completed assignment
 *   LODGING       approved lodging receipt (100% pass-through)
 *   LATE_CANCEL   provider's share of a clinic's forfeited deposit
 *   ADJUSTMENT    admin bonus (+) or correction (−), always audit-logged
 *   VOLUME        extra visits past the booked tier (Addendum 03), after the clinic is charged
 * A row becomes payable at releaseAt (completion + hold) unless a dispute or
 * admin hold is open, and is paid by a Stripe Connect transfer (INV-5).
 */

export type PayoutKind = "SHIFT" | "LODGING" | "LATE_CANCEL" | "ADJUSTMENT" | "VOLUME";

export interface PayoutFacts {
  kind: PayoutKind;
  status: PayoutStatus;
  amountCents: number;
  releaseAt: Date | null;
  paidAt: Date | null;
  onHold: boolean;
}

export function releaseAt(completedAt: Date, holdHours: number): Date {
  return new Date(+completedAt + holdHours * HOUR);
}

/** Ready to transfer now: scheduled, past the hold, no open dispute or hold, positive amount. */
export function isPayable(p: PayoutFacts, now: Date, hasOpenDispute: boolean): boolean {
  return (
    (p.status === "SCHEDULED" || p.status === "FAILED") &&
    !p.onHold &&
    !hasOpenDispute &&
    p.releaseAt !== null &&
    +p.releaseAt <= +now &&
    p.amountCents > 0
  );
}

export interface PayoutSummary {
  upcomingCents: number; // confirmed shifts not yet completed
  scheduledCents: number; // completed, in hold window
  readyCents: number; // payable now
  onHoldCents: number;
  processingCents: number;
  paidCents: number;
  paidYtdCents: number;
}

export function summarizePayouts(rows: (PayoutFacts & { hasOpenDispute?: boolean })[], now: Date): PayoutSummary {
  const s: PayoutSummary = { upcomingCents: 0, scheduledCents: 0, readyCents: 0, onHoldCents: 0, processingCents: 0, paidCents: 0, paidYtdCents: 0 };
  const yearStart = new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  for (const r of rows) {
    if (r.status === "CANCELLED") continue;
    if (r.status === "PAID") {
      s.paidCents += r.amountCents;
      if (r.paidAt && r.paidAt >= yearStart) s.paidYtdCents += r.amountCents;
    } else if (r.status === "PROCESSING") s.processingCents += r.amountCents;
    else if (r.status === "PENDING") s.upcomingCents += r.amountCents;
    else if (r.onHold || r.status === "ON_HOLD" || r.hasOpenDispute) s.onHoldCents += r.amountCents;
    else if (isPayable(r, now, !!r.hasOpenDispute)) s.readyCents += r.amountCents;
    else s.scheduledCents += r.amountCents;
  }
  return s;
}

/**
 * Net amount for one transfer to one provider: payable rows are netted so a
 * negative adjustment is recovered from the next payment. Returns null when
 * the net is not positive (nothing to send yet).
 */
export function netTransfer(rows: { id: string; amountCents: number }[]): { ids: string[]; amountCents: number } | null {
  const amountCents = rows.reduce((a, r) => a + r.amountCents, 0);
  if (amountCents <= 0) return null;
  return { ids: rows.map((r) => r.id), amountCents };
}

/** A clinic charge that can fund provider transfers: amount − refunds − already transferred. */
export interface ChargeSource { paymentId: string; assignmentId: string; capacityCents: number }
export interface TransferLeg { paymentId: string | null; amountCents: number }

/**
 * Split one provider payment into Stripe transfers, each linked to a clinic charge of the
 * same booking (Stripe source_transaction), so those funds are set aside for the provider
 * and never paid out to the platform. Charges are used in the order given (deposit, then
 * balance). Whatever they can't cover (bonuses, adjustments, refunded charges) is one
 * unlinked leg from the platform balance. Negative rows reduce unlinked money first.
 * The legs always add up to the net amount owed.
 */
export function planTransferLegs(rows: { assignmentId: string | null; amountCents: number }[], sources: ChargeSource[]): TransferLeg[] {
  const net = rows.reduce((a, r) => a + r.amountCents, 0);
  if (net <= 0) return [];
  const owed = new Map<string, number>();
  for (const r of rows) if (r.assignmentId) owed.set(r.assignmentId, (owed.get(r.assignmentId) ?? 0) + r.amountCents);
  const capacity = new Map(sources.map((s) => [s.paymentId, Math.max(0, s.capacityCents)]));
  const linked: { paymentId: string; amountCents: number }[] = [];
  for (const [assignmentId, amount] of owed) {
    let left = Math.max(0, amount);
    for (const s of sources.filter((x) => x.assignmentId === assignmentId)) {
      if (left <= 0) break;
      const take = Math.min(left, capacity.get(s.paymentId) ?? 0);
      if (take <= 0) continue;
      linked.push({ paymentId: s.paymentId, amountCents: take });
      capacity.set(s.paymentId, (capacity.get(s.paymentId) ?? 0) - take);
      left -= take;
    }
  }
  let unlinked = net - linked.reduce((a, l) => a + l.amountCents, 0);
  // Negative adjustments larger than the unlinked money come off the last linked legs.
  for (let i = linked.length - 1; unlinked < 0 && i >= 0; i--) {
    const cut = Math.min(linked[i].amountCents, -unlinked);
    linked[i].amountCents -= cut;
    unlinked += cut;
  }
  return [...linked.filter((l) => l.amountCents > 0), ...(unlinked > 0 ? [{ paymentId: null, amountCents: unlinked }] : [])];
}
