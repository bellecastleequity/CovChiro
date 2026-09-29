import type { PayoutStatus } from "./stateMachines";
import { HOUR } from "./time";

/**
 * Doctor pay ledger. Every dollar owed to a doctor is a Payout row:
 *   SHIFT         pay + mileage for a completed assignment
 *   LODGING       approved lodging receipt (100% pass-through)
 *   LATE_CANCEL   doctor's share of a clinic's forfeited deposit
 *   ADJUSTMENT    admin bonus (+) or correction (−), always audit-logged
 * A row becomes payable at releaseAt (completion + hold) unless a dispute or
 * admin hold is open, and is paid by a Stripe Connect transfer (INV-5).
 */

export type PayoutKind = "SHIFT" | "LODGING" | "LATE_CANCEL" | "ADJUSTMENT";

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
 * Net amount for one transfer to one doctor: payable rows are netted so a
 * negative adjustment is recovered from the next payment. Returns null when
 * the net is not positive (nothing to send yet).
 */
export function netTransfer(rows: { id: string; amountCents: number }[]): { ids: string[]; amountCents: number } | null {
  const amountCents = rows.reduce((a, r) => a + r.amountCents, 0);
  if (amountCents <= 0) return null;
  return { ids: rows.map((r) => r.id), amountCents };
}
