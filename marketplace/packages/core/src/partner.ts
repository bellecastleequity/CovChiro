/**
 * Partner clinic program. A clinic that agrees to book all its temporary coverage with us gets
 * (1) a discount that comes out of the platform margin only, never provider pay or travel, and
 * (2) a rate lock: its clinic price can't go above the rate card in effect when the current term
 * started. Terms renew automatically from the signing date until the partnership is ended.
 */

export interface PartnershipFacts {
  status: "OFFERED" | "ACTIVE" | "ENDED" | "WITHDRAWN";
  startsAt: Date | null;
  endedAt: Date | null;
  termMonths: number;
  discountPercent: number;
}

/** Same day-of-month `months` later (clamped to the month's last day), same time of day. */
export function addMonths(d: Date, months: number): Date {
  const y = d.getUTCFullYear(), m = d.getUTCMonth() + months;
  const last = new Date(Date.UTC(y, m + 1, 0)).getUTCDate();
  return new Date(Date.UTC(y, m, Math.min(d.getUTCDate(), last), d.getUTCHours(), d.getUTCMinutes(), d.getUTCSeconds(), d.getUTCMilliseconds()));
}

/** The term that `at` falls in, or null when the partnership isn't in force at that moment. */
export function partnerTermAt(p: PartnershipFacts, at: Date): { termStart: Date; termEnd: Date; termNumber: number } | null {
  if (!p.startsAt || (p.status !== "ACTIVE" && p.status !== "ENDED")) return null;
  if (+at < +p.startsAt) return null;
  if (p.endedAt && +at >= +p.endedAt) return null;
  const months = Math.max(1, p.termMonths);
  let n = 0;
  // Whole terms elapsed (a loop keeps month-end clamping exact; terms are ≥ 1 month so it's short).
  while (+addMonths(p.startsAt, months * (n + 1)) <= +at) n++;
  return { termStart: addMonths(p.startsAt, months * n), termEnd: addMonths(p.startsAt, months * (n + 1)), termNumber: n + 1 };
}

/**
 * The partner discount on one shift's coverage price. Promo and partner discounts together stay
 * within `maxShareOfMarginPercent` of the margin, so provider pay is never subsidised.
 */
export function partnerDiscountCents(quote: { clinicPriceCents: number; providerPayCents: number }, discountPercent: number, promoCents: number, maxShareOfMarginPercent: number): number {
  const margin = Math.max(0, quote.clinicPriceCents - quote.providerPayCents);
  const cap = Math.floor((margin * maxShareOfMarginPercent) / 100);
  const raw = Math.round((quote.clinicPriceCents * Math.min(100, Math.max(0, discountPercent))) / 100);
  return Math.max(0, Math.min(raw, cap - Math.max(0, promoCents)));
}

/**
 * Rate lock: the clinic price is the lower of today's card and the card in effect when the term
 * started, but never below today's provider pay (a rise in provider pay comes out of our margin,
 * never the provider's pocket). Provider pay always follows today's card.
 */
export function lockedClinicPriceCents(current: { clinicPriceCents: number; providerPayCents: number }, locked: { clinicPriceCents: number } | null): number {
  if (!locked) return current.clinicPriceCents;
  return Math.min(current.clinicPriceCents, Math.max(locked.clinicPriceCents, current.providerPayCents));
}
