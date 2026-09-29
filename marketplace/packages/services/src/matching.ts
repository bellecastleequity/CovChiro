import { weightsFor } from "@cm/config";
import { rankCandidates, reliabilityComponent, type ScoreInput } from "@cm/core";
import { getSettings, type Db } from "./context";
import type { Evaluated, LoadedShift } from "./eligibility";

/** Builds scoring inputs for evaluated candidates and ranks them (SPEC §7.3, Addendum §7.2). */

export async function platformMeanRating(db: Db): Promise<number> {
  const agg = await db.rating.aggregate({ where: { raterType: "CLINIC" }, _avg: { stars: true } });
  return agg._avg.stars ?? 4.5;
}

type RatingMap = Record<string, { sum: number; count: number }>;

export async function rankEvaluated(db: Db, shift: LoadedShift, evaluated: Evaluated[]) {
  if (!evaluated.length) return [];
  const s = await getSettings(db);
  const ids = evaluated.map((e) => e.providerId);
  const prof = shift.facts.professionCode;
  const shiftRow = await db.shift.findUniqueOrThrow({ where: { id: shift.facts.id }, select: { preferredSkillIds: true } });
  const [stats, favs, together, apps, locSkills, skillRows, mean] = await Promise.all([
    db.providerStats.findMany({ where: { providerId: { in: ids } } }),
    db.favorite.findMany({
      where: {
        OR: [
          { fromType: "CLINIC", fromId: shift.clinicOrgId, toType: "PROVIDER", toId: { in: ids } },
          { fromType: "PROVIDER", fromId: { in: ids }, toType: "CLINIC", toId: shift.clinicOrgId },
        ],
      },
    }),
    db.assignment.groupBy({
      by: ["providerId"],
      where: { providerId: { in: ids }, status: "COMPLETED", professionCode: prof, shift: { location: { clinicOrgId: shift.clinicOrgId } } },
      _count: true,
    }),
    db.application.findMany({ where: { shiftId: shift.facts.id, providerId: { in: ids } }, select: { providerId: true, createdAt: true } }),
    db.locationSkill.findMany({ where: { locationId: shift.locationId }, select: { skillId: true } }),
    db.providerSkill.findMany({
      where: { providerId: { in: ids }, skill: { OR: [{ professionCode: prof }, { professionCode: null }] } },
      select: { providerId: true, skillId: true },
    }),
    platformMeanRating(db),
  ]);
  const statsBy = new Map(stats.map((x) => [x.providerId, x]));
  const togetherBy = new Map(together.map((t) => [t.providerId, t._count]));
  const appliedBy = new Map(apps.map((a) => [a.providerId, a.createdAt]));
  const skillsBy = new Map<string, string[]>();
  for (const r of skillRows) skillsBy.set(r.providerId, [...(skillsBy.get(r.providerId) ?? []), r.skillId]);

  const inputs: ScoreInput[] = evaluated.map((e) => {
    const st = statsBy.get(e.providerId);
    const byProf = ((st?.ratingByProfession ?? {}) as RatingMap)[prof] ?? { sum: 0, count: 0 };
    const completedByProf = ((st?.completedByProfession ?? {}) as Record<string, number>)[prof] ?? 0;
    return {
      providerId: e.providerId,
      driveMinutes: e.drive?.minutes ?? null,
      providerMaxDriveMinutes: e.provider.facts.maxDriveMinutes,
      overnightEligible: e.provider.facts.willingOvernight && shift.facts.lodgingAllowed,
      providerSkillIds: skillsBy.get(e.providerId) ?? [],
      shiftPreferredSkillIds: shiftRow.preferredSkillIds,
      locationSkillIds: locSkills.map((l) => l.skillId),
      completedShifts: st?.completedShifts ?? 0,
      lateCancels: st?.lateCancels ?? 0,
      noShows: st?.noShows ?? 0,
      ratingSum: st?.ratingSum ?? 0,
      ratingCount: st?.ratingCount ?? 0,
      professionRatingSum: byProf.sum,
      professionRatingCount: byProf.count,
      completedShiftsInProfession: completedByProf,
      clinicFavoritedProvider: favs.some((f) => f.fromType === "CLINIC" && f.toId === e.providerId),
      providerFavoritedClinic: favs.some((f) => f.fromType === "PROVIDER" && f.fromId === e.providerId),
      pastCompletedShiftsTogether: togetherBy.get(e.providerId) ?? 0,
      appliedAt: appliedBy.get(e.providerId) ?? null,
      shiftsThisMonth: st?.shiftsThisMonth ?? 0,
    };
  });
  const ranked = rankCandidates(inputs, { weights: weightsFor(s, prof), platformMaxDriveMinutes: s["matching.maxDriveMinutes"], platformMeanRating: mean }, shift.facts.id);
  const evBy = new Map(evaluated.map((e) => [e.providerId, e]));
  return ranked.map((r) => ({
    ...r,
    evaluated: evBy.get(r.providerId)!,
    reliability: reliabilityComponent(r.input),
    ratingAvg: r.input.professionRatingCount ? r.input.professionRatingSum / r.input.professionRatingCount : r.input.ratingCount ? r.input.ratingSum / r.input.ratingCount : null,
    ratingCount: r.input.professionRatingCount || r.input.ratingCount,
    newToPlatform: r.input.completedShifts < 3,
    workedHereBefore: r.input.pastCompletedShiftsTogether > 0,
    favorite: r.input.clinicFavoritedProvider,
  }));
}

/** Persist a match-run log: every candidate's score breakdown or why they were filtered. */
export async function logMatchRun(db: Db, shiftId: string, reason: string, ranked: Awaited<ReturnType<typeof rankEvaluated>>, excluded: Evaluated[], prefilteredOut: number) {
  await db.matchRun.create({
    data: {
      shiftId,
      reason,
      results: {
        eligible: ranked.map((r) => ({ providerId: r.providerId, score: r.score, components: { ...r.components }, driveMinutes: r.input.driveMinutes })),
        excluded: excluded.map((e) => ({ providerId: e.providerId, failures: e.result.failures.map((f) => ({ ...f })) })),
        prefilteredOut,
      },
    },
  });
}
