/**
 * Overdue clinic payments (owner decision Oct 2026): a clinic charge that fails is retried, and if
 * anything the clinic owes is still unpaid payments.payInFullAfterHours after it first failed, the
 * clinic's future bookings are charged in full at confirmation instead of the deposit, until an
 * admin restores the normal deposit. Pure rules; services/overdue.ts runs them.
 */

/** Every kind of clinic charge counts (refunds are money going back, never owed). */
export const OVERDUE_PAYMENT_TYPES = ["DEPOSIT", "BALANCE", "VOLUME", "LODGING", "CANCELLATION_FEE", "CONVERSION_FEE", "ADJUSTMENT"] as const;

export function overduePaymentAction(p: {
  status: "PENDING" | "PROCESSING" | "SUCCEEDED" | "FAILED" | "REFUNDED" | string;
  firstFailedAt: Date | null;
  retryCount: number;
  now: Date;
  /** Hours after the first failure at which the card is retried (one retry per entry). */
  retryAfterHours: number[];
  payInFullAfterHours: number;
  /** When an admin last restored the normal deposit: charges that failed before then don't count again. */
  clearedAt: Date | null;
  alreadyFlagged: boolean;
  enabled: boolean;
}): { retry: boolean; flag: boolean } {
  if (p.status !== "FAILED" || !p.firstFailedAt) return { retry: false, flag: false };
  const hours = (+p.now - +p.firstFailedAt) / 3_600_000;
  const nextRetry = p.retryAfterHours[p.retryCount];
  const retry = nextRetry !== undefined && hours >= nextRetry;
  const flag = p.enabled && !p.alreadyFlagged && hours >= p.payInFullAfterHours && (!p.clearedAt || +p.firstFailedAt > +p.clearedAt);
  return { retry, flag };
}

/** Share of the booking charged at confirmation. */
export function depositPercentFor(depositPercent: number, payInFull: boolean): number {
  return payInFull ? 100 : depositPercent;
}
