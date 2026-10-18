/**
 * Welcome Discount (owner spec Oct 2026, docs/specs/welcome-discount.md): a clinic's first three
 * completed coverage bookings are 15% off, automatically, with no code and no expiration. The
 * discount is a percentage of the base coverage rate (never overtime, premiums or travel), funded
 * from the platform margin only, so provider pay never changes.
 */

/** The part of the price the discount applies to: the rate card's base (hourly: card × billable hours). */
export function welcomeBaseCents(i: { pricingModel: string; cardClinicCents: number; billableHours: number; clinicPriceCents: number }): number {
  const base = i.pricingModel === "HOURLY" ? Math.round(i.cardClinicCents * i.billableHours) : i.cardClinicCents;
  return Math.max(0, Math.min(base, i.clinicPriceCents));
}

/**
 * The discount in cents: percent of the base, never more than the allowed share of the margin, and
 * never so much that the booking's contribution falls below the configured minimum.
 */
export function welcomeDiscount(i: { baseCents: number; percent: number; clinicPriceCents: number; providerPayCents: number; maxShareOfMarginPercent: number; minContributionCents: number }): number {
  const margin = Math.max(0, i.clinicPriceCents - i.providerPayCents);
  const raw = Math.round((i.baseCents * Math.min(100, Math.max(0, i.percent))) / 100);
  const shareCap = Math.floor((margin * Math.min(100, Math.max(0, i.maxShareOfMarginPercent))) / 100);
  const floorCap = Math.max(0, margin - Math.max(0, i.minContributionCents));
  return Math.max(0, Math.min(raw, shareCap, floorCap));
}

export interface WelcomeCounts {
  total: number;
  /** Completed (redeemed, plus completed bookings before the offer existed). */
  used: number;
  /** Held for confirmed bookings not yet completed. */
  reserved: number;
  /** Posted, unfilled shifts already priced with the discount. */
  pending: number;
  /** Discounts a new booking can still get. */
  available: number;
  /** Not yet used (available + reserved + pending). */
  remaining: number;
}

export function welcomeCounts(i: { total: number; priorCompleted: number; reserved: number; redeemed: number; pending: number }): WelcomeCounts {
  const used = Math.min(i.total, i.priorCompleted + i.redeemed);
  const reserved = Math.min(i.total - used, i.reserved);
  const pending = Math.min(i.total - used - reserved, i.pending);
  return { total: i.total, used, reserved, pending, available: i.total - used - reserved - pending, remaining: i.total - used };
}

export type WelcomeStage = "NEW" | "TWO_LEFT" | "ONE_LEFT" | "DONE";

/** Which dashboard/email message fits (built for 3 bookings; other totals map by what's left). */
export function welcomeStage(c: { total: number; used: number }): WelcomeStage {
  const left = c.total - c.used;
  if (left <= 0) return "DONE";
  if (c.used === 0) return "NEW";
  return left === 1 ? "ONE_LEFT" : "TWO_LEFT";
}
