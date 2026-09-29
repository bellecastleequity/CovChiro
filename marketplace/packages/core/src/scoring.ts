import type { MatchingWeights } from "@cm/config";

/** Candidate scoring (SPEC §7.3). Pure; the caller persists the breakdown for the match-run log. */

export interface ScoreInput {
  doctorId: string;
  driveMinutes: number | null;
  doctorMaxDriveMinutes: number;
  overnightEligible: boolean;
  doctorTechniqueIds: string[];
  shiftPreferredTechniqueIds: string[];
  locationTechniqueIds: string[];
  completedShifts: number;
  lateCancels: number;
  noShows: number;
  ratingSum: number;
  ratingCount: number;
  clinicFavoritedDoctor: boolean;
  doctorFavoritedClinic: boolean;
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
  technique: number;
  reliability: number;
  rating: number;
  relationship: number;
  newDoctor: number;
}

export interface Scored {
  doctorId: string;
  score: number;
  components: ScoreBreakdown;
}

const clamp01 = (n: number) => Math.min(1, Math.max(0, n));

export function driveComponent(i: Pick<ScoreInput, "driveMinutes" | "doctorMaxDriveMinutes" | "overnightEligible">, platformMax: number): number {
  const maxAllowed = Math.min(i.doctorMaxDriveMinutes, platformMax);
  if (i.driveMinutes === null) return i.overnightEligible ? 0.1 : 0;
  if (i.driveMinutes > maxAllowed) return i.overnightEligible ? 0.1 : 0;
  return clamp01(1 - i.driveMinutes / maxAllowed);
}

export function techniqueComponent(i: Pick<ScoreInput, "doctorTechniqueIds" | "shiftPreferredTechniqueIds" | "locationTechniqueIds">): number {
  const have = new Set(i.doctorTechniqueIds);
  if (i.shiftPreferredTechniqueIds.length) {
    return i.shiftPreferredTechniqueIds.filter((t) => have.has(t)).length / i.shiftPreferredTechniqueIds.length;
  }
  if (!i.doctorTechniqueIds.length || !i.locationTechniqueIds.length) return 0.5;
  return Math.min(1, i.locationTechniqueIds.filter((t) => have.has(t)).length / 3);
}

export function reliabilityComponent(i: Pick<ScoreInput, "completedShifts" | "lateCancels" | "noShows">): number {
  const c = i.completedShifts;
  return (c + 5) / (c + 5 + 2 * i.lateCancels + 5 * i.noShows);
}

export function ratingComponent(i: Pick<ScoreInput, "ratingSum" | "ratingCount">, platformMean: number): number {
  const C = 5;
  const avg = (C * platformMean + i.ratingSum) / (C + i.ratingCount);
  return clamp01((avg - 1) / 4);
}

export function relationshipComponent(i: Pick<ScoreInput, "clinicFavoritedDoctor" | "doctorFavoritedClinic" | "pastCompletedShiftsTogether">): number {
  return clamp01(
    0.6 * (i.clinicFavoritedDoctor ? 1 : 0) + 0.2 * (i.doctorFavoritedClinic ? 1 : 0) + 0.05 * Math.min(i.pastCompletedShiftsTogether, 4),
  );
}

export function scoreCandidate(i: ScoreInput, ctx: ScoreContext): Scored {
  const components: ScoreBreakdown = {
    drive: driveComponent(i, ctx.platformMaxDriveMinutes),
    technique: techniqueComponent(i),
    reliability: reliabilityComponent(i),
    rating: ratingComponent(i, ctx.platformMeanRating),
    relationship: relationshipComponent(i),
    newDoctor: i.completedShifts < 3 ? 1 : 0,
  };
  const w = ctx.weights;
  const score =
    w.drive * components.drive +
    w.technique * components.technique +
    w.reliability * components.reliability +
    w.rating * components.rating +
    w.relationship * components.relationship +
    w.newDoctor * components.newDoctor;
  return { doctorId: i.doctorId, score: Math.round(score * 1e6) / 1e6, components };
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

/**
 * Sort by score desc, then: earlier application → fewer shifts this month →
 * shorter drive → seeded random.
 */
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
    return seededRank(shiftId, a.doctorId) - seededRank(shiftId, b.doctorId);
  });
}
