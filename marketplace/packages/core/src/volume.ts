/**
 * Volume pricing (Addendum 03 as decided by the owner, docs/migrations/addendum-03-plan.md §8).
 *
 * A shift is priced by the visits the clinic expects: LIGHT or BUSY, each with a visit
 * ceiling on its rate card. After the day, visits past the DECLARED tier's ceiling plus a grace
 * buffer cost a flat amount per visit (clinic) and pay a flat amount per visit (provider). There is
 * no re-tiering and no new-patient weighting, and the price never drops below what was declared.
 * Premiums multiply the tier base only, never the per-visit overage.
 */

import type { SettingsMap } from "@cm/config";

export type VolumeTier = "LIGHT" | "BUSY";
export const VOLUME_TIERS: VolumeTier[] = ["LIGHT", "BUSY"];
export const VOLUME_TIER_LABEL: Record<VolumeTier, string> = { LIGHT: "Light", BUSY: "Busy" };

export interface VolumeCard {
  tier: VolumeTier;
  visitCeiling: number;
  clinicPriceCents: number;
  providerPayCents: number;
  overageClinicCentsPerVisit: number;
  overageProviderCentsPerVisit: number;
}

/** Smallest tier whose ceiling holds the visits; above every ceiling = the top tier. */
export function tierForVisits(visits: number, cards: Pick<VolumeCard, "tier" | "visitCeiling">[]): VolumeTier {
  const sorted = [...cards].sort((a, b) => a.visitCeiling - b.visitCeiling);
  if (!sorted.length) throw new Error("No volume rate cards");
  return (sorted.find((c) => visits <= c.visitCeiling) ?? sorted[sorted.length - 1]).tier;
}

/** Problems with a region × profession × duration set of volume cards (null = fine). */
export function validateVolumeCards(cards: VolumeCard[]): string | null {
  for (const t of VOLUME_TIERS) if (!cards.some((c) => c.tier === t)) return `Add the ${VOLUME_TIER_LABEL[t]} tier.`;
  const [l, b] = VOLUME_TIERS.map((t) => cards.find((c) => c.tier === t)!);
  if (!(l.visitCeiling < b.visitCeiling)) return "The Light visit ceiling must be below Busy.";
  if (!(l.clinicPriceCents < b.clinicPriceCents)) return "The Light clinic price must be below Busy.";
  for (const c of [l, b]) {
    if (c.providerPayCents > c.clinicPriceCents) return `${VOLUME_TIER_LABEL[c.tier]}: provider pay can't be more than the clinic price.`;
    if (c.overageProviderCentsPerVisit > c.overageClinicCentsPerVisit) return `${VOLUME_TIER_LABEL[c.tier]}: per-visit provider pay can't be more than the clinic's per-visit price.`;
  }
  return null;
}

export function volumeOverage(i: { declaredCeiling: number; finalVisits: number; graceVisits: number; clinicPerVisit: number; providerPerVisit: number }) {
  const overageVisits = Math.max(0, Math.floor(i.finalVisits) - i.declaredCeiling - Math.max(0, i.graceVisits));
  return { overageVisits, clinicCents: overageVisits * i.clinicPerVisit, providerCents: overageVisits * i.providerPerVisit };
}

export interface Reconciliation {
  declaredTier: VolumeTier;
  finalTier: VolumeTier;
  finalVisits: number | null;
  allowedVisits: number;
  overageVisits: number;
  overageClinicCents: number;
  overageProviderCents: number;
  clinicFinalCents: number;
  providerFinalCents: number;
}

/**
 * Final coverage price/pay for a volume-priced shift. `quoted` is what was quoted at posting
 * (tier base with premiums and overtime); travel and promos are handled outside, unchanged.
 */
export function reconcileVolume(i: {
  declaredTier: VolumeTier;
  declaredCard: Pick<VolumeCard, "visitCeiling" | "overageClinicCentsPerVisit" | "overageProviderCentsPerVisit">;
  quoted: { clinicPriceCents: number; providerPayCents: number };
  finalVisits: number | null;
  graceVisits: number;
}): Reconciliation {
  const o =
    i.finalVisits == null
      ? { overageVisits: 0, clinicCents: 0, providerCents: 0 }
      : volumeOverage({ declaredCeiling: i.declaredCard.visitCeiling, finalVisits: i.finalVisits, graceVisits: i.graceVisits, clinicPerVisit: i.declaredCard.overageClinicCentsPerVisit, providerPerVisit: i.declaredCard.overageProviderCentsPerVisit });
  return {
    declaredTier: i.declaredTier,
    finalTier: i.declaredTier,
    finalVisits: i.finalVisits,
    allowedVisits: i.declaredCard.visitCeiling + Math.max(0, i.graceVisits),
    overageVisits: o.overageVisits,
    overageClinicCents: o.clinicCents,
    overageProviderCents: o.providerCents,
    clinicFinalCents: i.quoted.clinicPriceCents + o.clinicCents,
    providerFinalCents: i.quoted.providerPayCents + o.providerCents,
  };
}

/**
 * Provider's count vs the clinic's. No clinic answer = the provider's count stands. Within the
 * tolerance = average rounded down. Beyond it = DISPUTED, settled for now at the lower count
 * (the undisputed amount) until an admin sets the final count.
 */
export function countOutcome(providerVisits: number, clinicVisits: number | null, tolerance: number): { kind: "PROVIDER" | "AGREED" | "SPLIT" | "DISPUTED"; finalVisits: number } {
  if (clinicVisits == null) return { kind: "PROVIDER", finalVisits: providerVisits };
  if (clinicVisits === providerVisits) return { kind: "AGREED", finalVisits: providerVisits };
  if (Math.abs(clinicVisits - providerVisits) <= tolerance) return { kind: "SPLIT", finalVisits: Math.floor((clinicVisits + providerVisits) / 2) };
  return { kind: "DISPUTED", finalVisits: Math.min(clinicVisits, providerVisits) };
}

export function medianVisits(counts: number[]): number | null {
  if (!counts.length) return null;
  const s = [...counts].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : Math.round((s[m - 1] + s[m]) / 2);
}

/** Posting hint when the location's last N actual counts all beat the declared tier's ceiling. Never blocks. */
export function underDeclareWarning(declaredVisits: number, declaredCeiling: number, recentActual: number[], n: number): string | null {
  const last = recentActual.slice(0, n);
  if (n <= 0 || last.length < n || declaredVisits > declaredCeiling || !last.every((v) => v > declaredCeiling)) return null;
  const avg = Math.round(last.reduce((a, v) => a + v, 0) / last.length);
  return `Your recent coverage days averaged ${avg} visits. Declaring fewer may reduce provider interest, and visits past the tier are billed per visit.`;
}

/** Provider minimum pay (F12). Overage is never counted; mileage only when the provider asks. */
export interface PayFloor {
  professionCode: string;
  minHalfDayCents: number | null;
  minFullDayCents: number | null;
  minHourlyCents: number | null;
  includeMileage: boolean;
}

export function payFloorProblem(
  floors: PayFloor[] | undefined,
  shift: { professionCode: string; durationTier: "HALF_DAY" | "FULL_DAY" | "HOURLY"; providerPayCents: number; billableHours: number },
  mileageCents: number,
): string | null {
  const f = floors?.find((x) => x.professionCode === shift.professionCode);
  if (!f) return null;
  const extra = f.includeMileage ? mileageCents : 0;
  if (shift.durationTier === "HOURLY") {
    if (f.minHourlyCents == null || shift.billableHours <= 0) return null;
    const perHour = (shift.providerPayCents + extra) / shift.billableHours;
    return perHour >= f.minHourlyCents ? null : "Pays less than your minimum hourly rate";
  }
  const min = shift.durationTier === "HALF_DAY" ? f.minHalfDayCents : f.minFullDayCents;
  if (min == null) return null;
  return shift.providerPayCents + extra >= min ? null : `Pays less than your ${shift.durationTier === "HALF_DAY" ? "half-day" : "full-day"} minimum`;
}

type VolumeSettings = Pick<
  SettingsMap,
  | "pricing.volumeLightVisitsFullDay"
  | "pricing.volumeBusyVisitsFullDay"
  | "pricing.volumeLightVisitsHalfDay"
  | "pricing.volumeBusyVisitsHalfDay"
  | "pricing.volumeGraceVisits"
  | "pricing.volumeOverageClinicCents"
  | "pricing.volumeOverageProviderCents"
>;

/** Visit limits per tier for a duration, from Settings (Busy is kept above Light). */
export function volumeCeilings(s: VolumeSettings, durationTier: "HALF_DAY" | "FULL_DAY"): Record<VolumeTier, number> {
  const half = durationTier === "HALF_DAY";
  const light = half ? s["pricing.volumeLightVisitsHalfDay"] : s["pricing.volumeLightVisitsFullDay"];
  const busy = half ? s["pricing.volumeBusyVisitsHalfDay"] : s["pricing.volumeBusyVisitsFullDay"];
  return { LIGHT: light, BUSY: Math.max(busy, light + 1) };
}

/** What a shift keeps from posting time: its tier's limit, grace and per-visit amounts. */
export interface VolumeTerms {
  ceiling: number;
  grace: number;
  overageClinicCents: number;
  overageProviderCents: number;
}

export function volumeTermsFor(s: VolumeSettings, durationTier: "HALF_DAY" | "FULL_DAY", tier: VolumeTier): VolumeTerms {
  const clinic = s["pricing.volumeOverageClinicCents"];
  return {
    ceiling: volumeCeilings(s, durationTier)[tier],
    grace: s["pricing.volumeGraceVisits"],
    overageClinicCents: clinic,
    overageProviderCents: Math.min(clinic, s["pricing.volumeOverageProviderCents"]),
  };
}

export function parseVolumeTerms(j: unknown): VolumeTerms | null {
  if (!j || typeof j !== "object") return null;
  const o = j as Record<string, unknown>;
  const n = (k: string) => (typeof o[k] === "number" && Number.isFinite(o[k]) ? (o[k] as number) : null);
  const ceiling = n("ceiling"), grace = n("grace"), c = n("overageClinicCents"), p = n("overageProviderCents");
  return ceiling == null || grace == null || c == null || p == null ? null : { ceiling, grace, overageClinicCents: c, overageProviderCents: p };
}

/** Reconcile from a shift's stored terms. */
export function reconcileWithTerms(tier: VolumeTier, terms: VolumeTerms, quoted: { clinicPriceCents: number; providerPayCents: number }, finalVisits: number | null): Reconciliation {
  return reconcileVolume({
    declaredTier: tier,
    declaredCard: { visitCeiling: terms.ceiling, overageClinicCentsPerVisit: terms.overageClinicCents, overageProviderCentsPerVisit: terms.overageProviderCents },
    quoted,
    finalVisits,
    graceVisits: terms.grace,
  });
}

/** Clinic-facing one-liner for the posting screen and confirmation. */
export function volumeRuleText(tier: VolumeTier, terms: VolumeTerms, fmt: (c: number) => string): string {
  const upTo = terms.ceiling + terms.grace;
  return `${VOLUME_TIER_LABEL[tier]} day covers up to ${upTo} visits${terms.grace ? ` (${terms.ceiling} + ${terms.grace} grace)` : ""}. Each visit past that adds ${fmt(terms.overageClinicCents)}.`;
}
