/**
 * Cost-of-closing comparison (public calculator). Pure arithmetic on the clinic's own numbers:
 * what the days away normally bring in, what share they'd get back by rescheduling, and what
 * coverage costs. Presented as a comparison of their figures, never as a promise of results.
 */
export interface ClosingInput {
  dailyCollections: number;
  days: number;
  coverageCost: number;
  /** 0–100: share of those visits the office would get back later by rescheduling. */
  recoveredPercent: number;
}

export interface ClosingResult {
  /** What those days normally bring in. */
  atStake: number;
  /** Closing: collections not brought in (after any rescheduled visits). */
  closingCost: number;
  /** Staying open: collections on those days minus coverage. */
  openAfterCoverage: number;
  /** Closing: collections that come back later by rescheduling. */
  recovered: number;
  /** Positive = staying open keeps more than closing. */
  difference: number;
  /** Coverage cost as a share of the days' normal collections (0–1). */
  coverageShare: number | null;
  /** Daily collections at which coverage costs the same as closing. */
  breakEvenDaily: number | null;
}

export function closingComparison(i: ClosingInput): ClosingResult {
  const d = Math.max(0, i.dailyCollections);
  const n = Math.max(0, i.days);
  const c = Math.max(0, i.coverageCost);
  const r = Math.min(100, Math.max(0, i.recoveredPercent)) / 100;
  const atStake = d * n;
  const recovered = atStake * r;
  const closingCost = atStake - recovered;
  const openAfterCoverage = atStake - c;
  return {
    atStake,
    closingCost,
    openAfterCoverage,
    recovered,
    difference: openAfterCoverage - recovered,
    coverageShare: atStake > 0 ? c / atStake : null,
    breakEvenDaily: n > 0 && r < 1 ? c / (n * (1 - r)) : null,
  };
}

/**
 * Estimated coverage price for the public calculator: a full day per day away at the
 * Light or Busy price the visit count falls in (same rule as posting), plus extra visits
 * past the Busy ceiling + grace at the clinic's per-visit price. Before premiums and mileage.
 */
export function coverageEstimate(i: {
  visitsPerDay: number;
  days: number;
  lightCents: number;
  busyCents: number;
  lightCeiling: number;
  busyCeiling: number;
  graceVisits: number;
  overagePerVisitCents: number;
}): { tier: "LIGHT" | "BUSY"; perDayCents: number; extraVisitsPerDay: number; totalCents: number } {
  const v = Math.max(0, Math.floor(i.visitsPerDay));
  const tier = v <= i.lightCeiling ? "LIGHT" : "BUSY";
  const extra = Math.max(0, v - i.busyCeiling - i.graceVisits);
  const perDay = (tier === "LIGHT" ? i.lightCents : i.busyCents) + extra * i.overagePerVisitCents;
  return { tier, perDayCents: perDay, extraVisitsPerDay: extra, totalCents: perDay * Math.max(0, i.days) };
}
