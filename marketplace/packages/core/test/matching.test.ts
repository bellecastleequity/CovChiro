import { describe, expect, it } from "vitest";
import { validateSetting, weightsFor } from "@cm/config";
import {
  driveComponent, rankCandidates, ratingComponent, reliabilityComponent, relationshipComponent, scoreCandidate, skillsComponent,
  selectionDeadline, favoritesWindowEnd, tierForLeadTime, minPostingLeadOk, type ScoreInput,
} from "../src";
import { d, S } from "./fixtures";

const ctx = { weights: S["matching.weights"], platformMaxDriveMinutes: 180, platformMeanRating: 4.5 };
const input = (over: Partial<ScoreInput> = {}): ScoreInput => ({
  providerId: "a", driveMinutes: 45, providerMaxDriveMinutes: 90, overnightEligible: false, providerSkillIds: ["t1", "t2"],
  shiftPreferredSkillIds: [], locationSkillIds: ["t1"], completedShifts: 10, lateCancels: 0, noShows: 0, ratingSum: 45,
  ratingCount: 10, professionRatingSum: 45, professionRatingCount: 10, completedShiftsInProfession: 10, clinicFavoritedProvider: false, providerFavoritedClinic: false, pastCompletedShiftsTogether: 0, appliedAt: null, shiftsThisMonth: 0, ...over,
});

describe("score components", () => {
  it("drive", () => {
    expect(driveComponent({ driveMinutes: 45, providerMaxDriveMinutes: 90, overnightEligible: false }, 180)).toBe(0.5);
    expect(driveComponent({ driveMinutes: 200, providerMaxDriveMinutes: 300, overnightEligible: true }, 180)).toBe(0.1);
    expect(driveComponent({ driveMinutes: 0, providerMaxDriveMinutes: 90, overnightEligible: false }, 180)).toBe(1);
  });
  it("skills", () => {
    expect(skillsComponent({ providerSkillIds: ["a"], shiftPreferredSkillIds: ["a", "b"], locationSkillIds: [] })).toBe(0.5);
    expect(skillsComponent({ providerSkillIds: ["a", "b", "c"], shiftPreferredSkillIds: [], locationSkillIds: ["a", "b", "c", "d"] })).toBe(1);
    expect(skillsComponent({ providerSkillIds: [], shiftPreferredSkillIds: [], locationSkillIds: ["a"] })).toBe(0.5);
  });
  it("reliability prior", () => {
    expect(reliabilityComponent({ completedShifts: 0, lateCancels: 0, noShows: 0 })).toBe(1);
    expect(reliabilityComponent({ completedShifts: 0, lateCancels: 1, noShows: 0 })).toBeCloseTo(5 / 7);
    expect(reliabilityComponent({ completedShifts: 5, lateCancels: 0, noShows: 1 })).toBeCloseTo(10 / 15);
  });
  it("bayesian rating uses the profession's ratings when there are ≥3", () => {
    expect(ratingComponent({ ratingSum: 0, ratingCount: 0, professionRatingSum: 0, professionRatingCount: 0 }, 4.5)).toBeCloseTo(0.875);
    expect(ratingComponent({ ratingSum: 0, ratingCount: 0, professionRatingSum: 15, professionRatingCount: 3 }, 4.5)).toBeCloseTo(((5 * 4.5 + 15) / 8 - 1) / 4);
  });
  it("new to a profession: overall rating discounted 10% of its distance above the mean", () => {
    const overall = (5 * 4.5 + 50) / 15; // 4.833
    const discounted = overall - 0.1 * (overall - 4.5);
    expect(ratingComponent({ ratingSum: 50, ratingCount: 10, professionRatingSum: 10, professionRatingCount: 2 }, 4.5)).toBeCloseTo((discounted - 1) / 4);
    // below-mean ratings are not boosted
    const low = (5 * 4.5 + 20) / 15;
    expect(ratingComponent({ ratingSum: 20, ratingCount: 10, professionRatingSum: 0, professionRatingCount: 0 }, 4.5)).toBeCloseTo((low - 1) / 4);
  });
  it("relationship clamps", () => {
    expect(relationshipComponent({ clinicFavoritedProvider: true, providerFavoritedClinic: true, pastCompletedShiftsTogether: 10 })).toBe(1);
    expect(relationshipComponent({ clinicFavoritedProvider: false, providerFavoritedClinic: true, pastCompletedShiftsTogether: 2 })).toBeCloseTo(0.3);
  });
  it("score in [0,1]; new-provider boost is per profession", () => {
    const s = scoreCandidate(input({ completedShifts: 40, completedShiftsInProfession: 1 }), ctx);
    expect(s.components.newProvider).toBe(1);
    expect(scoreCandidate(input(), ctx).components.newProvider).toBe(0);
    expect(s.score).toBeGreaterThan(0);
    expect(s.score).toBeLessThanOrEqual(1);
  });
  it("weights must sum to 1", () => {
    expect(validateSetting("matching.weights", { ...S["matching.weights"], drive: 0.5 }).ok).toBe(false);
    expect(validateSetting("matching.weights", S["matching.weights"]).ok).toBe(true);
    expect(validateSetting("matching.weightsByProfession", { LMT: { ...S["matching.weights"], drive: 0.9 } }).ok).toBe(false);
    const s2 = { ...S, "matching.weightsByProfession": { LMT: { drive: 0.5, skills: 0.1, reliability: 0.1, rating: 0.1, relationship: 0.1, newProvider: 0.1 } } };
    expect(weightsFor(s2, "LMT").drive).toBe(0.5);
    expect(weightsFor(s2, "DC")).toEqual(S["matching.weights"]);
  });
});

describe("tie-breakers", () => {
  it("score → application time → shiftsThisMonth → drive → seeded random", () => {
    const same = { driveMinutes: 45 };
    const r1 = rankCandidates([input({ providerId: "late", appliedAt: d("2026-10-02"), ...same }), input({ providerId: "early", appliedAt: d("2026-10-01"), ...same })], ctx, "s");
    expect(r1.map((x) => x.providerId)).toEqual(["early", "late"]);
    const r2 = rankCandidates([input({ providerId: "busy", shiftsThisMonth: 5 }), input({ providerId: "free", shiftsThisMonth: 1 })], ctx, "s");
    expect(r2[0].providerId).toBe("free");
    const a = rankCandidates([input({ providerId: "x" }), input({ providerId: "y" })], ctx, "shiftA").map((x) => x.providerId);
    const b = rankCandidates([input({ providerId: "y" }), input({ providerId: "x" })], ctx, "shiftA").map((x) => x.providerId);
    expect(a).toEqual(b); // deterministic regardless of input order
  });
});

describe("deadlines table", () => {
  const tiers = S["matching.deadlineTiers"];
  const posted = d("2026-10-01T12:00:00Z");
  it("≥7 days → +24h, 4h offers", () => {
    const r = selectionDeadline(tiers, posted, d("2026-10-10T12:00:00Z"));
    expect(r.deadline).toEqual(d("2026-10-02T12:00:00Z"));
    expect(r.tier.offerWindowMinutes).toBe(240);
  });
  it("2–7 days → +6h, 2h offers", () => {
    const r = selectionDeadline(tiers, posted, d("2026-10-04T12:00:00Z"));
    expect(r.deadline).toEqual(d("2026-10-01T18:00:00Z"));
    expect(r.tier.offerWindowMinutes).toBe(120);
  });
  it("<48h → +1h, 30 min parallel offers", () => {
    const r = selectionDeadline(tiers, posted, d("2026-10-02T20:00:00Z"));
    expect(r.deadline).toEqual(d("2026-10-01T13:00:00Z"));
    expect(r.tier).toMatchObject({ offerWindowMinutes: 30, parallelOffers: 3 });
  });
  it("capped so 3 cascade rounds fit before start − 2h", () => {
    // 3.5h lead: latest = start − 2h − 90m = posted + 0h → deadline = posted
    const r = selectionDeadline(tiers, posted, d("2026-10-01T15:30:00Z"));
    expect(r.deadline).toEqual(posted);
    expect(tierForLeadTime(tiers, 1000).selectionWindowHours).toBe(24);
  });
  it("favorites window only with ≥48h lead and an eligible favorite", () => {
    expect(favoritesWindowEnd(posted, d("2026-10-10T12:00:00Z"), 1, 2)).toEqual(d("2026-10-01T14:00:00Z"));
    expect(favoritesWindowEnd(posted, d("2026-10-10T12:00:00Z"), 0, 2)).toBeNull();
    expect(favoritesWindowEnd(posted, d("2026-10-02T12:00:00Z"), 3, 2)).toBeNull();
    expect(minPostingLeadOk(posted, d("2026-10-01T13:00:00Z"))).toBe(false);
  });
});
