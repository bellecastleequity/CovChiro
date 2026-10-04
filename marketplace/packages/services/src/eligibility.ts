import { agreementCurrent } from "./agreements";
import {
  DomainError,
  evaluateEligibility,
  NATIONAL_CREDENTIAL,
  paidHours,
  parseAttestation,
  travelEstimate,
  type EligibilityOptions,
  type EligibilityResult,
  type PairFacts,
  type ProviderFacts,
  type ShiftFacts,
} from "@cm/core";
import type { SettingsMap } from "@cm/config";
import { Prisma } from "@cm/db";
import { geoProvider, type DriveResult } from "@cm/integrations";
import { getSettings, type Db } from "./context";

/**
 * THE eligibility implementation (INV-1 profession + state, INV-3, INV-8,
 * F0–F10). Every path that shows, notifies, offers, selects or assigns a
 * provider calls `assertProviderEligibleForShift` or `getEligibleProviders`.
 * Both evaluate with @cm/core `evaluateEligibility`; the set version only
 * adds an SQL prefilter (F1/F2 and a generous straight-line distance bound)
 * that can never admit someone the pure function would reject, and never
 * rejects someone it would admit. tests/invariants asserts they agree.
 */

export interface LoadedShift {
  facts: ShiftFacts;
  clinicOrgId: string;
  locationId: string;
  location: { lat: number; lng: number; timeZone: string };
  lodgingCapCentsPerNight: number | null;
  status: string;
}

export async function loadShift(db: Db, shiftId: string): Promise<LoadedShift> {
  const s = (await loadShifts(db, [shiftId])).get(shiftId);
  if (!s) throw new DomainError("NOT_FOUND", "Shift not found");
  return s;
}

/** Several shifts in a handful of queries (config and skills fetched once per profession + state). */
export async function loadShifts(db: Db, shiftIds: string[]): Promise<Map<string, LoadedShift>> {
  const out = new Map<string, LoadedShift>();
  if (!shiftIds.length) return out;
  const rows = await db.shift.findMany({ where: { id: { in: shiftIds } }, include: { location: true } });
  if (!rows.length) return out;
  const maxDaySpan = (await getSettings(db))["pricing.maxDaySpanMinutes"];
  const combos = [...new Map(rows.map((r) => [`${r.professionCode}|${r.state}`, { professionCode: r.professionCode, state: r.state }])).values()];
  const professionCodes = [...new Set(rows.map((r) => r.professionCode))];
  const states = [...new Set(rows.map((r) => r.state))];
  const skillIds = [...new Set(rows.flatMap((r) => [...r.requiredSkillIds, ...r.preferredSkillIds]))];
  const [pscs, stateCfgs, professions, skills] = await Promise.all([
    db.professionStateConfig.findMany({ where: { OR: combos } }),
    db.stateConfig.findMany({ where: { state: { in: states } } }),
    db.profession.findMany({ where: { code: { in: professionCodes } } }),
    skillIds.length ? db.skill.findMany({ where: { id: { in: skillIds } }, include: { stateRules: { where: { OR: combos } } } }) : Promise.resolve([]),
  ]);
  for (const s of rows) {
    const psc = pscs.find((x) => x.professionCode === s.professionCode && x.state === s.state);
    const stateCfg = stateCfgs.find((x) => x.state === s.state);
    const profession = professions.find((x) => x.code === s.professionCode);
    const mine = new Set([...s.requiredSkillIds, ...s.preferredSkillIds]);
    out.set(s.id, {
      clinicOrgId: s.location.clinicOrgId,
      locationId: s.locationId,
      location: { lat: s.location.lat, lng: s.location.lng, timeZone: s.location.timeZone },
      lodgingCapCentsPerNight: s.lodgingCapCentsPerNight,
      status: s.status,
      facts: {
        id: s.id,
        professionCode: s.professionCode,
        state: s.state,
        startsAt: s.startsAt,
        endsAt: s.endsAt,
        requiredSkillIds: s.requiredSkillIds,
        minYearsExperience: s.minYearsExperience,
        lodgingAllowed: s.lodgingAllowed,
        maxTravelBudgetCents: s.maxTravelBudgetCents,
        pay: s.durationTier ? { durationTier: s.durationTier, providerPayCents: s.providerPayCents, billableHours: Math.max(0.01, paidHours((+s.endsAt - +s.startsAt) / 3_600_000, s.lunchMinutes, maxDaySpan)) } : undefined,
        supervisionAttestation: s.supervisionAttestedAt ? parseAttestation(s.supervisionAttestation) : null,
        config: {
          enabled: !!psc?.enabled,
          stateEnabled: !!stateCfg?.enabled,
          nationalCredentialAccepted: !!psc && psc.alternativeCredentialAllowed && !psc.licensedAtStateLevel,
          supervisionRequired: psc?.supervisionRequired ?? profession?.requiresSupervisionDefault ?? false,
          supervisingProfessionCodes: psc?.supervisingProfessionCodes?.length ? psc.supervisingProfessionCodes : (profession?.defaultSupervisingProfessionCodes ?? []),
          malpracticeMinOccurrenceCents: psc?.malpracticeMinOccurrenceCents ?? profession?.defaultMalpracticeMinOccurrenceCents ?? 0,
          malpracticeMinAggregateCents: psc?.malpracticeMinAggregateCents ?? profession?.defaultMalpracticeMinAggregateCents ?? 0,
        },
        skills: skills
          .filter((k) => mine.has(k.id))
          .map((k) => ({
            id: k.id,
            requiresCertification: k.requiresCertification,
            scopeSensitive: k.scopeSensitive,
            allowedInScope: k.stateRules.some((r) => r.professionCode === s.professionCode && r.state === s.state && r.allowed),
          })),
      },
    });
  }
  return out;
}

export interface LoadedProvider {
  facts: ProviderFacts;
  homeLat: number | null;
  homeLng: number | null;
  userId: string;
  displayName: string;
  /** The shift behind each `facts.busy` entry (same order). */
  busyShiftIds: string[];
}

export async function loadProviders(db: Db, providerIds: string[], excludeShiftId?: string): Promise<Map<string, LoadedProvider>> {
  if (!providerIds.length) return new Map();
  const rows = await db.provider.findMany({
    where: { id: { in: providerIds } },
    include: {
      licenses: true,
      malpractice: true,
      skills: true,
      professions: true,
      availability: true,
      blackouts: true,
      openDates: true,
      payFloors: true,
      assignments: {
        where: { status: { in: ["CONFIRMED", "IN_PROGRESS"] }, ...(excludeShiftId ? { shiftId: { not: excludeShiftId } } : {}) },
        select: { shiftId: true, startsAt: true, endsAt: true, bufferMinutes: true },
      },
    },
  });
  const out = new Map<string, LoadedProvider>();
  for (const p of rows) {
    out.set(p.id, {
      userId: p.userId,
      displayName: p.displayName,
      homeLat: p.homeLat,
      homeLng: p.homeLng,
      busyShiftIds: p.assignments.map((a) => a.shiftId),
      facts: {
        id: p.id,
        status: p.status,
        professions: p.professions.map((x) => ({ professionCode: x.professionCode, status: x.status, yearsInPractice: x.yearsInPractice })),
        payoutsEnabled: p.stripePayoutsEnabled,
        agreementCurrent: agreementCurrent("PROVIDER", p.agreementSignedAt, p.agreementVersion),
        licenses: p.licenses.map((l) => ({ professionCode: l.professionCode, state: l.state, status: l.status, expiresAt: l.expiresAt })),
        malpractice: p.malpractice.map((m) => ({
          status: m.status,
          expiresAt: m.expiresAt,
          perOccurrenceCents: m.perOccurrenceCents,
          aggregateCents: m.aggregateCents,
          coveredProfessionCodes: m.coveredProfessionCodes,
        })),
        skills: p.skills.map((s) => ({ skillId: s.skillId, certificationStatus: s.certificationStatus, certificationExpiresAt: s.certificationExpiresAt })),
        maxDriveMinutes: p.maxDriveMinutes,
        willingOvernight: p.willingOvernight,
        availabilityRules: p.availability.map((r) => ({ weekday: r.weekday, startMin: r.startMin, endMin: r.endMin, timeZone: r.timeZone })),
        openDates: p.openDates.map((o) => ({ start: +o.startsAt, end: +o.endsAt })),
        blackouts: p.blackouts.map((b) => ({ start: +b.startsAt, end: +b.endsAt })),
        busy: p.assignments.map((a) => ({ start: +a.startsAt - a.bufferMinutes * 60_000, end: +a.endsAt + a.bufferMinutes * 60_000 })),
        payFloors: p.payFloors.map((f) => ({ professionCode: f.professionCode, minHalfDayCents: f.minHalfDayCents, minFullDayCents: f.minFullDayCents, minHourlyCents: f.minHourlyCents, includeMileage: f.includeMileage })),
      },
    });
  }
  return out;
}

// ---------------- drive times (cached) ----------------

const DRIVE_TTL = 30 * 86_400_000;
const driveCache = new Map<string, { at: number; v: DriveResult | null }>();

export async function driveTimes(
  origins: { key: string; lat: number | null; lng: number | null }[],
  dest: { locationId: string; lat: number; lng: number },
  arriveBy: Date,
): Promise<Map<string, DriveResult | null>> {
  const out = new Map<string, DriveResult | null>();
  const hour = Math.floor(+arriveBy / 3_600_000);
  const need: { key: string; cacheKey: string; lat: number; lng: number }[] = [];
  for (const o of origins) {
    if (o.lat === null || o.lng === null) {
      out.set(o.key, null);
      continue;
    }
    // Home coordinates are in the key, so an address change invalidates it.
    const cacheKey = `${o.key}:${o.lat.toFixed(4)},${o.lng.toFixed(4)}:${dest.locationId}:${hour}`;
    const hit = driveCache.get(cacheKey);
    if (hit && Date.now() - hit.at < DRIVE_TTL) out.set(o.key, hit.v);
    else need.push({ key: o.key, cacheKey, lat: o.lat, lng: o.lng });
  }
  for (let i = 0; i < need.length; i += 25) {
    const batch = need.slice(i, i + 25);
    const res = await geoProvider().driveMatrix(batch, dest, arriveBy);
    batch.forEach((b, j) => {
      driveCache.set(b.cacheKey, { at: Date.now(), v: res[j] ?? null });
      out.set(b.key, res[j] ?? null);
    });
  }
  return out;
}

// ---------------- pair facts ----------------

export function eligibilityOptions(s: SettingsMap, extra: Partial<EligibilityOptions> = {}): EligibilityOptions {
  return { travelBufferExtraMinutes: s["matching.travelBufferExtraMinutes"], lodgingMaxDriveMinutes: s["pricing.lodgingMaxDriveMinutes"], ...extra };
}

async function pairFactsFor(db: Db, shift: LoadedShift, providerIds: string[], drives: Map<string, DriveResult | null>, s: SettingsMap) {
  const [blocks, declines] = await Promise.all([
    db.block.findMany({
      where: {
        OR: [
          { fromType: "CLINIC", fromId: shift.clinicOrgId, toType: "PROVIDER", toId: { in: providerIds } },
          { fromType: "PROVIDER", fromId: { in: providerIds }, toType: "CLINIC", toId: shift.clinicOrgId },
        ],
      },
    }),
    db.offer.findMany({ where: { shiftId: shift.facts.id, providerId: { in: providerIds }, status: "DECLINED" }, select: { providerId: true } }),
  ]);
  const blocked = new Set(blocks.map((b) => (b.fromType === "CLINIC" ? b.toId : b.fromId)));
  const declined = new Set(declines.map((d) => d.providerId));
  const out = new Map<string, PairFacts>();
  for (const id of providerIds) {
    const drive = drives.get(id) ?? null;
    const travel = drive
      ? travelEstimate(drive, { lodgingAllowed: shift.facts.lodgingAllowed, lodgingCapCentsPerNight: shift.lodgingCapCentsPerNight }, s)
      : { totalCents: 0, mileageCents: 0, lodgingEstimateCents: 0, nights: 0 };
    out.set(id, { driveMinutes: drive?.minutes ?? null, travelEstimateCents: travel.totalCents, mileageCents: travel.mileageCents, blocked: blocked.has(id), previouslyDeclined: declined.has(id) });
  }
  return out;
}

export interface Evaluated {
  providerId: string;
  provider: LoadedProvider;
  pair: PairFacts;
  drive: DriveResult | null;
  result: EligibilityResult;
}

// ---------------- single check ----------------

export async function evaluateProviderForShift(
  db: Db,
  providerId: string,
  shiftOrId: string | LoadedShift,
  extra: Partial<EligibilityOptions> = {},
): Promise<Evaluated & { shift: LoadedShift }> {
  const s = await getSettings(db);
  const shift = typeof shiftOrId === "string" ? await loadShift(db, shiftOrId) : shiftOrId;
  const providers = await loadProviders(db, [providerId], shift.facts.id);
  const provider = providers.get(providerId);
  if (!provider) throw new DomainError("NOT_FOUND", "Provider not found");
  const arrive = shift.facts.startsAt;
  const drives = extra.credentialsOnly
    ? new Map<string, DriveResult | null>()
    : await driveTimes([{ key: providerId, lat: provider.homeLat, lng: provider.homeLng }], { locationId: shift.locationId, ...shift.location }, arrive);
  const pair = (await pairFactsFor(db, shift, [providerId], drives, s)).get(providerId)!;
  const result = evaluateEligibility(provider.facts, shift.facts, pair, eligibilityOptions(s, extra));
  return { providerId, provider, pair, drive: drives.get(providerId) ?? null, result, shift };
}

/**
 * One provider against many shifts (the provider board): the same inputs and the
 * same pure evaluation as `evaluateProviderForShift` for each shift, loaded in a
 * few queries instead of a dozen per shift. tests/invariants asserts they agree.
 */
export async function evaluateProviderForShifts(
  db: Db,
  providerId: string,
  shiftIds: string[],
  extra: Partial<EligibilityOptions> = {},
): Promise<Map<string, Evaluated & { shift: LoadedShift }>> {
  const out = new Map<string, Evaluated & { shift: LoadedShift }>();
  if (!shiftIds.length) return out;
  const s = await getSettings(db);
  const [shifts, providers] = await Promise.all([loadShifts(db, shiftIds), loadProviders(db, [providerId])]);
  const provider = providers.get(providerId);
  if (!provider) throw new DomainError("NOT_FOUND", "Provider not found");
  const list = shiftIds.map((id) => shifts.get(id)).filter((x): x is LoadedShift => !!x);
  const origin = [{ key: providerId, lat: provider.homeLat, lng: provider.homeLng }];
  const drives = new Map<string, DriveResult | null>();
  if (!extra.credentialsOnly) {
    for (let i = 0; i < list.length; i += 8) {
      const chunk = list.slice(i, i + 8);
      const res = await Promise.all(chunk.map((sh) => driveTimes(origin, { locationId: sh.locationId, ...sh.location }, sh.facts.startsAt)));
      chunk.forEach((sh, j) => drives.set(sh.facts.id, res[j].get(providerId) ?? null));
    }
  }
  const clinicIds = [...new Set(list.map((sh) => sh.clinicOrgId))];
  const [blocks, declines] = await Promise.all([
    db.block.findMany({
      where: {
        OR: [
          { fromType: "CLINIC", fromId: { in: clinicIds }, toType: "PROVIDER", toId: providerId },
          { fromType: "PROVIDER", fromId: providerId, toType: "CLINIC", toId: { in: clinicIds } },
        ],
      },
    }),
    db.offer.findMany({ where: { shiftId: { in: list.map((sh) => sh.facts.id) }, providerId, status: "DECLINED" }, select: { shiftId: true } }),
  ]);
  const blockedClinics = new Set(blocks.map((b) => (b.fromType === "CLINIC" ? b.fromId : b.toId)));
  const declined = new Set(declines.map((d) => d.shiftId));
  const opts = eligibilityOptions(s, extra);
  for (const shift of list) {
    const drive = drives.get(shift.facts.id) ?? null;
    const travel = drive
      ? travelEstimate(drive, { lodgingAllowed: shift.facts.lodgingAllowed, lodgingCapCentsPerNight: shift.lodgingCapCentsPerNight }, s)
      : { totalCents: 0, mileageCents: 0, lodgingEstimateCents: 0, nights: 0 };
    const pair: PairFacts = {
      driveMinutes: drive?.minutes ?? null,
      travelEstimateCents: travel.totalCents,
      mileageCents: travel.mileageCents,
      blocked: blockedClinics.has(shift.clinicOrgId),
      previouslyDeclined: declined.has(shift.facts.id),
    };
    // As in the single check, the provider's own booking on this shift doesn't make them busy for it.
    const facts = { ...provider.facts, busy: provider.facts.busy.filter((_, i) => provider.busyShiftIds[i] !== shift.facts.id) };
    const result = evaluateEligibility(facts, shift.facts, pair, opts);
    out.set(shift.facts.id, { providerId, provider: { ...provider, facts }, pair, drive, result, shift });
  }
  return out;
}

/** Throws DomainError (LICENSE_STATE_MISMATCH, LICENSE_PROFESSION_MISMATCH, …) when not eligible. */
export async function assertProviderEligibleForShift(db: Db, providerId: string, shiftId: string, extra: Partial<EligibilityOptions> = {}) {
  const ev = await evaluateProviderForShift(db, providerId, shiftId, extra);
  if (!ev.result.eligible) {
    const first = ev.result.failures[0];
    throw new DomainError(first.code, first.message, { failures: ev.result.failures });
  }
  return ev;
}

// ---------------- set-based ----------------

/** Per profession, the states that accept a national registry credential instead of a state license (A5). */
export async function nationalCredentialStates(db: Db): Promise<Record<string, string[]>> {
  const rows = await db.professionStateConfig.findMany({
    where: { alternativeCredentialAllowed: true, licensedAtStateLevel: false },
    select: { professionCode: true, state: true },
    orderBy: { state: "asc" },
  });
  const out: Record<string, string[]> = {};
  for (const r of rows) (out[r.professionCode] ??= []).push(r.state);
  return out;
}

/**
 * SQL prefilter: F1 (profession + state license) and F2 (malpractice) exactly
 * as the pure function defines them, then a straight-line distance bound
 * (maxDriveMinutes × 1.2 miles) for providers who can't take lodging.
 */
async function prefilterIds(db: Db, shift: LoadedShift, distanceMultiplier: number, distanceMultiplierAll = 1, lodgingMaxDriveMinutes = 240): Promise<string[]> {
  const f = shift.facts;
  if (!f.config.enabled || !f.config.stateEnabled) return []; // F0 fails for everyone
  const rows = await db.$queryRaw<{ id: string }[]>(Prisma.sql`
    SELECT p.id FROM "Provider" p
    WHERE EXISTS (
      SELECT 1 FROM "License" l
      WHERE l."providerId" = p.id AND l."professionCode" = ${f.professionCode}
        AND (l.state = ${f.state} OR (${f.config.nationalCredentialAccepted} AND l.state = ${NATIONAL_CREDENTIAL}))
        AND l.status = 'VERIFIED' AND l."expiresAt" > ${f.endsAt}
    )
    AND EXISTS (
      SELECT 1 FROM "MalpracticePolicy" m
      WHERE m."providerId" = p.id AND ${f.professionCode} = ANY(m."coveredProfessionCodes")
        AND m.status = 'VERIFIED' AND m."expiresAt" > ${f.endsAt}
        AND m."perOccurrenceCents" >= ${f.config.malpracticeMinOccurrenceCents}
        AND m."aggregateCents" >= ${f.config.malpracticeMinAggregateCents}
    )
    AND (
      (p."willingOvernight" AND ${f.lodgingAllowed} AND p."homeGeo" IS NOT NULL AND ST_DWithin(
            p."homeGeo",
            ST_SetSRID(ST_MakePoint(${shift.location.lng}, ${shift.location.lat}), 4326)::geography,
            ${lodgingMaxDriveMinutes}::float8 * 1.2 * 1609.344))
      OR (p."homeGeo" IS NOT NULL AND ST_DWithin(
            p."homeGeo",
            ST_SetSRID(ST_MakePoint(${shift.location.lng}, ${shift.location.lat}), 4326)::geography,
            p."maxDriveMinutes" * GREATEST(CASE WHEN p."willingOvernight" THEN ${distanceMultiplier}::float8 ELSE 1 END, ${distanceMultiplierAll}::float8) * 1.2 * 1609.344))
    )
  `);
  return rows.map((r) => r.id);
}

export interface EligibleSet {
  eligible: Evaluated[];
  /** Survivors of the SQL prefilter that failed a later filter (for the match-run log). */
  excluded: Evaluated[];
  prefilteredOut: number;
}

export async function getEligibleProviders(db: Db, shiftOrId: string | LoadedShift, extra: Partial<EligibilityOptions> = {}): Promise<EligibleSet> {
  const s = await getSettings(db);
  const shift = typeof shiftOrId === "string" ? await loadShift(db, shiftOrId) : shiftOrId;
  const ids = await prefilterIds(db, shift, extra.distanceMultiplier ?? 1, extra.distanceMultiplierAll ?? 1, extra.lodgingMaxDriveMinutes ?? s["pricing.lodgingMaxDriveMinutes"]);
  const totalWithAnyLicense = await db.provider.count({ where: { licenses: { some: { professionCode: shift.facts.professionCode } } } });
  const providers = await loadProviders(db, ids, shift.facts.id);
  const drives = await driveTimes(
    ids.map((id) => ({ key: id, lat: providers.get(id)!.homeLat, lng: providers.get(id)!.homeLng })),
    { locationId: shift.locationId, ...shift.location },
    shift.facts.startsAt,
  );
  const pairs = await pairFactsFor(db, shift, ids, drives, s);
  const opts = eligibilityOptions(s, extra);
  const eligible: Evaluated[] = [];
  const excluded: Evaluated[] = [];
  for (const id of ids) {
    const provider = providers.get(id)!;
    const pair = pairs.get(id)!;
    const ev = { providerId: id, provider, pair, drive: drives.get(id) ?? null, result: evaluateEligibility(provider.facts, shift.facts, pair, opts) };
    (ev.result.eligible ? eligible : excluded).push(ev);
  }
  return { eligible, excluded, prefilteredOut: Math.max(0, totalWithAnyLicense - ids.length) };
}
