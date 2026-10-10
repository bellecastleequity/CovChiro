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
  /** Rebilling failsafe: when given, a charge older than maxAgeDays (by when it was made) or excluded by an admin is never chased. */
  createdAt?: Date;
  maxAgeDays?: number;
  excludedAt?: Date | null;
}): { retry: boolean; flag: boolean } {
  if (p.status !== "FAILED" || !p.firstFailedAt) return { retry: false, flag: false };
  if (p.excludedAt) return { retry: false, flag: false };
  if (p.createdAt && p.maxAgeDays !== undefined && !autoCollectable({ createdAt: p.createdAt, now: p.now, maxAgeDays: p.maxAgeDays, excludedAt: null })) return { retry: false, flag: false };
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

/**
 * Rebilling failsafe (owner request Oct 2026): automatic notices, retries and the pay-in-full switch
 * only ever look at charges made in the last maxAgeDays (payments.autoCollectMaxAgeDays) that an
 * admin hasn't excluded. Older failures (old test charges, long-settled disputes) stay visible to
 * admins but are never retried by themselves.
 */
export function autoCollectable(p: { createdAt: Date; now: Date; maxAgeDays: number; excludedAt: Date | null }): boolean {
  if (p.excludedAt) return false;
  return +p.now - +p.createdAt <= p.maxAgeDays * 86_400_000;
}

type PaymentLike = { id: string; type: string; amountCents: number; assignmentId: string | null };

/** A failed charge whose booking already has a paid charge of the same kind and amount: never charge it again. Returns that payment's id. */
export function alreadyPaidBy(failed: PaymentLike, others: (PaymentLike & { status: string })[]): string | null {
  if (!failed.assignmentId) return null;
  const hit = others.find((o) => o.id !== failed.id && o.status === "SUCCEEDED" && o.assignmentId === failed.assignmentId && o.type === failed.type && o.amountCents === failed.amountCents);
  return hit?.id ?? null;
}
