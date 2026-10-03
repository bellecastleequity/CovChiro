/**
 * Clinic-set rate (beta, owner decision Oct 2026). A clinic may post a single shift below the
 * market rate, down to a floor (percent of the market price for that exact shift). It's not
 * auto-filled: providers apply and the clinic picks. If the clinic chose release, an unfilled
 * shift is re-priced at market `releaseHours` before it starts (72-168, set by the platform).
 * Pure rules only; services/clinicRate.ts applies them.
 */

const HOUR = 3_600_000;
export const CLINIC_RATE_RELEASE_RANGE = { min: 72, max: 168 } as const;

const clampHours = (h: number) => Math.min(CLINIC_RATE_RELEASE_RANGE.max, Math.max(CLINIC_RATE_RELEASE_RANGE.min, Math.round(h)));

export function clinicRateReleaseAt(startsAt: Date, releaseHours: number): Date {
  return new Date(+startsAt - clampHours(releaseHours) * HOUR);
}

/** A clinic-set rate can only be posted while the release time is still ahead. */
export function clinicRateAllowed(now: Date, startsAt: Date, releaseHours: number): boolean {
  return +clinicRateReleaseAt(startsAt, releaseHours) > +now;
}

export type ClinicRatePrice =
  | { ok: true; clinicPriceCents: number; providerPayCents: number; platformCents: number; floorCents: number }
  | { ok: false; reason: string; floorCents: number };

const dollars = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`;

/** Validate the clinic's price and split it like the market rate (same provider share). */
export function clinicRatePrice(market: { clinicPriceCents: number; providerPayCents: number }, requestedCents: number, minPercent: number): ClinicRatePrice {
  const floorCents = Math.ceil((market.clinicPriceCents * minPercent) / 100 / 100) * 100;
  if (!Number.isFinite(requestedCents) || requestedCents % 100 !== 0) return { ok: false, reason: "Enter a whole-dollar amount.", floorCents };
  if (requestedCents < floorCents) return { ok: false, reason: `Your rate must be at least ${dollars(floorCents)} (${minPercent}% of the market price).`, floorCents };
  if (requestedCents >= market.clinicPriceCents) return { ok: false, reason: `That's at or above the market price of ${dollars(market.clinicPriceCents)}. Post at market instead and we'll fill it for you.`, floorCents };
  const providerPayCents = Math.floor((requestedCents * market.providerPayCents) / market.clinicPriceCents);
  return { ok: true, clinicPriceCents: requestedCents, providerPayCents, platformCents: requestedCents - providerPayCents, floorCents };
}

const money = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

/** The exact terms the clinic accepts; stored with the shift as the receipt. */
export function clinicRateTerms(i: {
  brandName: string;
  clinicPriceCents: number;
  marketPriceCents: number;
  floorPercent: number;
  release: boolean;
  releaseAt: Date | null;
  releaseHours: number;
  timeZone: string;
  message: string;
}): string {
  const when = i.releaseAt
    ? i.releaseAt.toLocaleString("en-US", { timeZone: i.timeZone, weekday: "short", month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })
    : "";
  const lines = [
    `Clinic-set rate: ${money(i.clinicPriceCents)} for coverage (market price for this shift: ${money(i.marketPriceCents)}; minimum ${i.floorPercent}% of market).`,
    "This shift is not filled automatically. Providers may apply at your rate and you choose who to confirm.",
    i.release
      ? `If no provider is confirmed by ${when} (${i.releaseHours} hours before the start), the shift will be released to ${i.brandName} at market rates, priced at that time, including any short-notice premium, and filled the usual way.`
      : "This shift will not be released to market rates. If no provider applies and is confirmed at your rate, it may go unfilled.",
    `The release window is set by ${i.brandName} between 72 and 168 hours before the start and may change with volume and season; the time shown here is the one that applies to this shift.`,
    "Mileage, lodging (if needed) and extra visits are added as usual. Deposits, cancellations and all other terms of the Clinic Platform Agreement apply.",
  ];
  if (i.message.trim()) lines.push(`Note: ${i.message.trim()}`);
  return lines.join("\n");
}
