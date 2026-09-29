import type { MatchingWeights } from "@cm/config";

/**
 * Candidate scoring (SPEC §7.3 as revised by Addendum 01 §7.2). Pure; the
 * caller persists the breakdown for the match-run log. Everything
 * profession-specific (rating, "worked together", new-provider boost) is
 * computed for the shift's profession; reliability stays global.
 */

export interface ScoreInput {
  providerId: string;
  driveMinutes: number | null;
  providerMaxDriveMinutes: number;
  overnightEligible: boolean;
  /** Provider's skills in the shift's profession plus cross-profession skills. */
  providerSkillIds: string[];
  shiftPreferredSkillIds: string[];
  locationSkillIds: string[];
  /** Global reliability record. */
  completedShifts: number;
  lateCancels: number;
  noShows: number;
  /** Overall ratings across professions. */
  ratingSum: number;
  ratingCount: number;
  /** Ratings in the shift's profession. */
  professionRatingSum: number;
  professionRatingCount: number;
  /** Completed shifts in the shift's profession (new-provider boost is per profession). */
  completedShiftsInProfession: number;
  clinicFavoritedProvider: boolean;
  providerFavoritedClinic: boolean;
  /** Past completed shifts with this clinic in the same profession. */
  pastCompletedShiftsTogether: number;
  /** Tie-breaker inputs. */
  appliedAt: Date | null;
  shiftsThisMonth: number;
}

export interface ScoreContext {
  weights: MatchingWeights;
  platformMaxDriveMinutes: number;
  platformMeanRating: number;
}

export interface ScoreBreakdown {
  drive: number;
  skills: number;
  reliability: number;
  rating: number;
  relationship: number;
  newProvider: number;
}

export interface Scored {
  providerId: string;
  score: number;
  components: ScoreBreakdown;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));
const PRIOR = 5;

export function driveComponent(i: Pick<ScoreInput, "driveMinutes" | "providerMaxDriveMinutes" | "overnightEligible">, platformMax: number): number {
  const maxAllowed = Math.min(i.providerMaxDriveMinutes, platformMax);
  if (i.driveMinutes === null || i.driveMinutes > maxAllowed) return i.overnightEligible ? 0.1 : 0;
  return clamp01(1 - i.driveMinutes / maxAllowed);
}

export function skillsComponent(i: Pick<ScoreInput, "providerSkillIds" | "shiftPreferredSkillIds" | "locationSkillIds">): number {
  const have = new Set(i.providerSkillIds);
  if (i.shiftPreferredSkillIds.length) {
    return i.shiftPreferredSkillIds.filter((t) => have.has(t)).length / i.shiftPreferredSkillIds.length;
  }
  if (!i.providerSkillIds.length || !i.locationSkillIds.length) return 0.5;
  return Math.min(1, i.locationSkillIds.filter((t) => have.has(t)).length / 3);
}

export function reliabilityComponent(i: Pick<ScoreInput, "completedShifts" | "lateCancels" | "noShows">): number {
  const c = i.completedShifts;
  return (c + 5) / (c + 5 + 2 * i.lateCancels + 5 * i.noShows);
}

function bayes(sum: number, count: number, mean: number): number {
  return (PRIOR * mean + sum) / (PRIOR + count);
}

/**
 * Profession rating when there are ≥3 ratings in that profession; otherwise
 * the overall rating, pulled 10% of the way back toward the platform mean if
 * it's above it (a provider new to a profession shouldn't ride a rating
 * earned in another).
 */
export function ratingComponent(
  i: Pick<ScoreInput, "ratingSum" | "ratingCount" | "professionRatingSum" | "professionRatingCount">,
  platformMean: number,
): number {
  let avg: number;
  if (i.professionRatingCount >= 3) avg = bayes(i.professionRatingSum, i.professionRatingCount, platformMean);
  else {
    avg = bayes(i.ratingSum, i.ratingCount, platformMean);
    if (avg > platformMean) avg -= 0.1 * (avg - platformMean);
  }
  return clamp01((avg - 1) / 4);
}

export function relationshipComponent(i: Pick<ScoreInput, "clinicFavoritedProvider" | "providerFavoritedClinic" | "pastCompletedShiftsTogether">): number {
  return clamp01(
    0.6 * (i.clinicFavoritedProvider ? 1 : 0) + 0.2 * (i.providerFavoritedClinic ? 1 : 0) + 0.05 * Math.min(i.pastCompletedShiftsTogether, 4),
  );
}

export function scoreCandidate(i: ScoreInput, ctx: ScoreContext): Scored {
  const components: ScoreBreakdown = {
    drive: driveComponent(i, ctx.platformMaxDriveMinutes),
    skills: skillsComponent(i),
    reliability: reliabilityComponent(i),
    rating: ratingComponent(i, ctx.platformMeanRating),
    relationship: relationshipComponent(i),
    newProvider: i.completedShiftsInProfession < 3 ? 1 : 0,
  };
  const w = ctx.weights;
  const score =
    w.drive * components.drive +
    w.skills * components.skills +
    w.reliability * components.reliability +
    w.rating * components.rating +
    w.relationship * components.relationship +
    w.newProvider * components.newProvider;
  return { providerId: i.providerId, score: Math.round(score * 1e6) / 1e6, components };
}

/** Deterministic PRNG seeded by shift id, for the final tie-breaker. */
export function seededRank(seed: string, id: string): number {
  let h = 2166136261;
  for (const ch of seed + ":" + id) {
    h ^= ch.charCodeAt(0);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

/** Sort by score desc, then: earlier application → fewer shifts this month → shorter drive → seeded random. */
export function rankCandidates(inputs: ScoreInput[], ctx: ScoreContext, shiftId: string): (Scored & { input: ScoreInput })[] {
  const scored = inputs.map((input) => ({ ...scoreCandidate(input, ctx), input }));
  return scored.sort((a, b) => {
    if (b.score !== a.score) return b.score - a.score;
    const aa = a.input.appliedAt?.getTime() ?? Infinity;
    const ba = b.input.appliedAt?.getTime() ?? Infinity;
    if (aa !== ba) return aa - ba;
    if (a.input.shiftsThisMonth !== b.input.shiftsThisMonth) return a.input.shiftsThisMonth - b.input.shiftsThisMonth;
    const ad = a.input.driveMinutes ?? Infinity;
    const bd = b.input.driveMinutes ?? Infinity;
    if (ad !== bd) return ad - bd;
    return seededRank(shiftId, a.providerId) - seededRank(shiftId, b.providerId);
  });
}
