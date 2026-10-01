import { createHash, randomBytes } from "node:crypto";
import { brand, tierConfigFor, type TierConfig } from "@cm/config";
import {
  arrivalFeasible,
  awardAtClose,
  capWindow,
  dispatchScore,
  DomainError,
  evaluateEligibility,
  inQuietHours,
  onCallRuleMismatch,
  orderForDispatch,
  pickReplyCode,
  rankProtectedAward,
  reliabilityComponent,
  responseCounts,
  pRespond as pRespondFn,
  urgencyTier,
  waveAllDeclined,
  waveSize,
  type OnCallRuleFacts,
  type UrgencyTier,
  type WaveOffer,
} from "@cm/core";
import { prisma, type DispatchTrigger, type Offer, type SelectionMethod, type Wave } from "@cm/db";
import { smsProvider, textingEnabled } from "@cm/integrations";
import { confirmInTx } from "./confirm";
import { audit, clock, getSettings, lockShift, requireClinic, requireProvider, SYSTEM, type Actor, type Db } from "./context";
import { Effects } from "./effects";
import { eligibilityOptions, getEligibleProviders, loadProviders, loadShift, type Evaluated } from "./eligibility";
import { rankEvaluated } from "./matching";
import { absoluteUrl, notify, notifyAdmins, notifyClinic } from "./notify";
import { notifyEligibleProvidersOfShift } from "./shifts";

/**
 * Smart Dispatch & On Call (Addendum 02).
 *
 *  - Every candidate list starts with getEligibleProviders (INV-1/3/8 and all
 *    hard filters). Nothing here can add a provider it excludes.
 *  - Match score decides who wins; dispatch score decides who is asked first.
 *  - Awards are rank-protected: never "first to answer wins".
 *  - Every mutation runs in a transaction holding the per-shift advisory lock;
 *    confirmations go through confirmInTx (SPEC §7.8).
 *  - Timers are due-item sweeps (tickDispatch) so they survive restarts.
 */

const SELECTABLE = ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"] as const;
const sha256 = (s: string) => createHash("sha256").update(s).digest("hex");

async function inShiftTx<T>(shiftId: string, fn: (db: Db, effects: Effects) => Promise<T>): Promise<T> {
  const effects = new Effects();
  const r = await prisma.$transaction(
    async (db) => {
      await lockShift(db, shiftId);
      return fn(db, effects);
    },
    { timeout: 60_000, maxWait: 20_000 },
  );
  await effects.run();
  return r;
}

// ======================================================================
// Start
// ======================================================================

export async function startDispatch(shiftId: string, trigger: DispatchTrigger, actor: Actor = SYSTEM): Promise<{ dispatchId: string | null; state: string }> {
  return inShiftTx(shiftId, async (db, effects) => {
    const now = clock.now();
    const shift = await db.shift.findUniqueOrThrow({ where: { id: shiftId } });
    if (!SELECTABLE.includes(shift.status as never)) return { dispatchId: null, state: `shift ${shift.status.toLowerCase()}` };
    if (shift.startsAt <= now) return { dispatchId: null, state: "shift started" };
    const active = await db.dispatch.findFirst({ where: { shiftId, status: "ACTIVE" } });
    if (active) return { dispatchId: active.id, state: "already active" };
    const hasStandby = trigger === "BACKFILL" && (await db.standbyEntry.count({ where: { shiftId } })) > 0;
    const d = await db.dispatch.create({
      data: { shiftId, trigger, tierAtStart: urgencyTier(now, shift.startsAt), stage: hasStandby ? "STANDBY" : "ON_CALL_CHECK", startedAt: now },
    });
    if (shift.status !== "CASCADING") await db.shift.update({ where: { id: shiftId }, data: { status: "CASCADING", cascadeStartedAt: now } });
    await audit(db, actor, "dispatch.started", "Shift", shiftId, null, { dispatchId: d.id, trigger, tier: d.tierAtStart });
    await advanceInTx(db, d.id, effects);
    const after = await db.dispatch.findUniqueOrThrow({ where: { id: d.id } });
    return { dispatchId: d.id, state: after.status };
  });
}

// ======================================================================
// Advance: standby → On Call check → waves → broadcast → exhausted
// ======================================================================

async function advanceInTx(db: Db, dispatchId: string, effects: Effects): Promise<void> {
  for (let guard = 0; guard < 12; guard++) {
    const d = await db.dispatch.findUniqueOrThrow({ where: { id: dispatchId }, include: { shift: true, waves: { where: { closedAt: null } } } });
    if (d.status !== "ACTIVE") return;
    if (!SELECTABLE.includes(d.shift.status as never)) {
      await db.dispatch.update({ where: { id: d.id }, data: { status: d.shift.status === "CONFIRMED" ? "FILLED" : "CANCELLED", stage: "DONE", endedAt: clock.now() } });
      return;
    }
    if (d.waves.length) return; // an open wave is running; its close/responses drive the next step
    const s = await getSettings(db);
    const now = clock.now();
    const tier = urgencyTier(now, d.shift.startsAt);
    const cfg = tierConfigFor(s, tier, d.shift.professionCode);

    if (d.stage === "STANDBY") {
      const sent = await sendStandbyWave(db, d.id, effects);
      if (sent) return;
      await db.dispatch.update({ where: { id: d.id }, data: { stage: "ON_CALL_CHECK" } });
      continue;
    }
    if (d.stage === "ON_CALL_CHECK") {
      const filled = await onCallCheck(db, d.id, effects);
      if (filled) return;
      await db.dispatch.update({ where: { id: d.id }, data: { stage: "WAVES" } });
      continue;
    }
    if (d.stage === "WAVES") {
      // Emergency cover asks everyone at once.
      if (d.shift.emergencyAt || d.currentWave >= cfg.wavesBeforeBroadcast) {
        await db.dispatch.update({ where: { id: d.id }, data: { stage: "BROADCAST" } });
        continue;
      }
      const sent = await sendWave(db, d.id, tier, cfg, false, effects);
      if (sent) return;
      // Nobody left to ask in waves: go straight to broadcast (which will exhaust if empty).
      await db.dispatch.update({ where: { id: d.id }, data: { stage: "BROADCAST" } });
      continue;
    }
    if (d.stage === "BROADCAST") {
      const alreadyBroadcast = await db.wave.count({ where: { dispatchId: d.id, isBroadcast: true } });
      if (d.shift.emergencyAt) {
        // Each unanswered broadcast raises the rescue bonus a step and re-texts everyone (new pay).
        const steps = s["emergency.bonusStepsPercent"];
        if (alreadyBroadcast < steps.length) {
          if (alreadyBroadcast > 0) await raiseRescueBonus(db, d.shiftId, steps[alreadyBroadcast]);
          const sent = await sendWave(db, d.id, tier, cfg, true, effects, { reoffer: alreadyBroadcast > 0 });
          if (sent) return;
        }
        await exhaust(db, d.id, effects);
        return;
      }
      if (!alreadyBroadcast) {
        const sent = await sendWave(db, d.id, tier, cfg, true, effects);
        if (sent) return;
      }
      await exhaust(db, d.id, effects);
      return;
    }
    return;
  }
}

/** Rescue bonus comes out of the platform margin: provider pay rises, the clinic price doesn't. */
export function rescuePay(basePayCents: number, percent: number, clinicPriceCents: number, promoDiscountCents: number) {
  return Math.min(Math.round(basePayCents * (1 + percent / 100)), Math.max(0, clinicPriceCents - promoDiscountCents));
}

async function raiseRescueBonus(db: Db, shiftId: string, percent: number) {
  const sh = await db.shift.findUniqueOrThrow({ where: { id: shiftId } });
  const base = sh.emergencyBasePayCents ?? sh.providerPayCents;
  const pay = rescuePay(base, percent, sh.clinicPriceCents, sh.promoDiscountCents);
  await db.shift.update({ where: { id: shiftId }, data: { emergencyBonusPercent: percent, providerPayCents: pay } });
  await audit(db, SYSTEM, "emergency.bonus_raised", "Shift", shiftId, { percent: sh.emergencyBonusPercent, providerPayCents: sh.providerPayCents }, { percent, providerPayCents: pay });
}

async function exhaust(db: Db, dispatchId: string, effects: Effects) {
  const now = clock.now();
  const d = await db.dispatch.update({ where: { id: dispatchId }, data: { status: "EXHAUSTED", stage: "DONE", endedAt: now }, include: { shift: { include: { location: true } } } });
  if (d.shift.status === "CASCADING") await db.shift.update({ where: { id: d.shiftId }, data: { status: "OPEN" } });
  await audit(db, SYSTEM, "dispatch.exhausted", "Shift", d.shiftId, null, { dispatchId });
  effects.add(async () => {
    await notifyClinic(prisma, d.shift.location.clinicOrgId, {
      template: "dispatch_exhausted",
      title: "We haven't found coverage yet",
      body: "Every eligible provider has been asked. Boost the rate to widen the search to more providers — licensure requirements never change.",
      link: `/clinic/shifts/${d.shiftId}`,
      ctaLabel: "Boost and search again",
      sms: true,
    });
    await notifyAdmins(prisma, d.shift.emergencyAt
      ? { template: "emergency_exhausted", title: "Emergency cover: nobody has accepted yet", body: `Every eligible provider has been texted at the top rescue bonus (+${d.shift.emergencyBonusPercent}%). Try calling from the emergency screen.`, link: `/admin/emergencies/${d.shiftId}`, sms: true }
      : { template: "dispatch_exhausted_admin", title: "Dispatch exhausted", body: `Shift ${d.shiftId} (${d.shift.professionCode}, ${d.shift.state})`, link: `/admin/shifts/${d.shiftId}`, email: false });
  });
}

// ======================================================================
// Candidates (§5.1–5.2)
// ======================================================================

interface Candidate {
  providerId: string;
  userId: string;
  matchScore: number;
  dispatchScore: number;
  pRespond: number;
  driveMinutes: number;
  shiftsThisMonth: number;
  evaluated: Evaluated;
  applicationId: string | null;
}

async function buildCandidates(db: Db, dispatchId: string, tier: UrgencyTier, cfg: TierConfig, opts: { includeAlreadyOffered?: boolean } = {}): Promise<Candidate[]> {
  const s = await getSettings(db);
  const now = clock.now();
  const d = await db.dispatch.findUniqueOrThrow({ where: { id: dispatchId }, include: { shift: true } });
  const shift = await loadShift(db, d.shiftId);
  // 1. The shared eligibility function — always first.
  const set = await getEligibleProviders(db, shift, {
    ...(d.shift.boosted ? { distanceMultiplier: 1.5 } : {}),
    ...(d.shift.emergencyAt ? { distanceMultiplierAll: s["emergency.driveMultiplier"] } : {}),
  });
  if (!set.eligible.length) return [];
  const ranked = await rankEvaluated(db, shift, set.eligible);
  const ids = ranked.map((r) => r.providerId);
  const dayAgo = new Date(+now - 86_400_000);
  const [providers, offeredHere, offersToday, pending, responsiveness, recentStandby, apps] = await Promise.all([
    db.provider.findMany({ where: { id: { in: ids } }, select: { id: true, userId: true, snoozedUntil: true, quietHoursStart: true, quietHoursEnd: true, urgentDuringQuietHours: true, homeTimeZone: true } }),
    db.offer.findMany({ where: { dispatchId, providerId: { in: ids } }, select: { providerId: true } }),
    db.offer.groupBy({ by: ["providerId"], where: { providerId: { in: ids }, createdAt: { gte: dayAgo }, source: { in: ["DISPATCH", "BROADCAST", "STANDBY"] } }, _count: true }),
    db.offer.groupBy({ by: ["providerId"], where: { providerId: { in: ids }, status: "PENDING", expiresAt: { gt: now } }, _count: true }),
    db.providerResponsiveness.findMany({ where: { providerId: { in: ids }, tier } }),
    db.standbyEntry.findMany({ where: { providerId: { in: ids }, createdAt: { gte: new Date(+now - s["dispatch.standbyCourtesyDays"] * 86_400_000) } }, select: { providerId: true } }),
    db.application.findMany({ where: { shiftId: d.shiftId, status: "ACTIVE", providerId: { in: ids } }, select: { id: true, providerId: true } }),
  ]);
  // Whoever cancelled, lapsed or didn't show on this shift (or the one it replaces) isn't asked again.
  const dropped = new Set(
    (await db.assignment.findMany({
      where: { shiftId: { in: [d.shiftId, ...(d.shift.rescueOfShiftId ? [d.shift.rescueOfShiftId] : [])] }, status: { in: ["CANCELLED", "NO_SHOW", "LICENSE_LAPSED"] } },
      select: { providerId: true },
    })).map((x) => x.providerId),
  );
  const pBy = new Map(providers.filter((p) => !dropped.has(p.id)).map((p) => [p.id, p]));
  const offered = new Set(offeredHere.map((o) => o.providerId));
  const todayBy = new Map(offersToday.map((o) => [o.providerId, o._count]));
  const pendingBy = new Map(pending.map((o) => [o.providerId, o._count]));
  const pr = new Map(responsiveness.map((r) => [r.providerId, r.pRespond]));
  const boosted = new Set(recentStandby.map((x) => x.providerId));
  const appBy = new Map(apps.map((a) => [a.providerId, a.id]));
  const prior = s["responsiveness.prior"];
  const out: Candidate[] = [];
  for (const r of ranked) {
    const p = pBy.get(r.providerId);
    if (!p) continue;
    const drive = r.evaluated.drive?.minutes ?? null;
    const isApplicant = appBy.has(r.providerId);
    // 2. Exclusions (applicants skip fatigue/quiet filters — they already said yes).
    if (!opts.includeAlreadyOffered && offered.has(r.providerId)) continue;
    if (!isApplicant) {
      if (p.snoozedUntil && p.snoozedUntil > now) continue;
      if ((todayBy.get(p.id) ?? 0) >= s["dispatch.maxOffersPerProviderPerDay"]) continue;
      if ((pendingBy.get(p.id) ?? 0) >= s["dispatch.maxConcurrentPendingOffers"]) continue;
      const urgent = tier === "SAME_DAY" || tier === "SHORT";
      if (inQuietHours(now, p.homeTimeZone, p.quietHoursStart, p.quietHoursEnd) && !(urgent && p.urgentDuringQuietHours)) continue;
    }
    // 3. Arrival feasibility.
    if (!arrivalFeasible(now, drive, s["dispatch.arrivalBufferMinutes"], d.shift.startsAt)) continue;
    const p0 = pr.get(p.id) ?? prior.a / (prior.a + prior.b);
    out.push({
      providerId: r.providerId,
      userId: p.userId,
      matchScore: r.score,
      pRespond: p0,
      dispatchScore: dispatchScore(r.score, p0, cfg.beta, boosted.has(p.id) ? s["dispatch.standbyCourtesyBoost"] : 0),
      driveMinutes: drive ?? 0,
      shiftsThisMonth: r.input.shiftsThisMonth,
      evaluated: r.evaluated,
      applicationId: appBy.get(r.providerId) ?? null,
    });
  }
  if (d.bestMatchAtStart === null && out.length) {
    await db.dispatch.update({ where: { id: dispatchId }, data: { bestMatchAtStart: Math.max(...out.map((c) => c.matchScore)) } });
  }
  return orderForDispatch(out, d.shiftId);
}

// ======================================================================
// Waves (§5.3–5.5)
// ======================================================================

async function createOffers(
  db: Db,
  d: { id: string; shiftId: string },
  wave: Wave,
  members: Candidate[],
  source: "DISPATCH" | "BROADCAST" | "STANDBY",
  tier: UrgencyTier,
  windowMinutes: number,
  effects: Effects,
  acceptedApplicants: Candidate[] = [],
) {
  const now = clock.now();
  const shift = await db.shift.findUniqueOrThrow({ where: { id: d.shiftId }, include: { location: { include: { clinicOrg: true } } } });
  const s = await getSettings(db);
  const clinicRating = await db.rating.aggregate({ where: { raterType: "PROVIDER", revealedAt: { not: null }, assignment: { shift: { location: { clinicOrgId: shift.location.clinicOrgId } } } }, _avg: { stars: true } });
  for (const m of [...members, ...acceptedApplicants]) {
    const isApp = acceptedApplicants.includes(m);
    const open = await db.offer.findMany({ where: { providerId: m.providerId, status: { in: ["PENDING", "ACCEPTED_PENDING"] }, replyCode: { not: null } }, select: { replyCode: true } });
    const token = randomBytes(18).toString("base64url");
    const code = pickReplyCode(new Set(open.map((o) => o.replyCode!)));
    const smsFirst = tier === "SAME_DAY" || tier === "SHORT";
    const offer = await db.offer.create({
      data: {
        shiftId: d.shiftId,
        providerId: m.providerId,
        source,
        dispatchId: d.id,
        waveId: wave.id,
        tier,
        windowMinutes,
        expiresAt: wave.windowEndsAt,
        matchScore: m.matchScore,
        dispatchScore: m.dispatchScore,
        pRespondAtSend: m.pRespond,
        replyCode: code,
        linkTokenHash: sha256(token),
        channelsSent: isApp ? [] : smsFirst ? ["SMS", "IN_APP"] : ["EMAIL", "IN_APP"],
        status: isApp ? "ACCEPTED_PENDING" : "PENDING",
        acceptedAt: isApp ? now : null,
        respondedAt: isApp ? now : null,
        applicationId: m.applicationId,
        createdAt: now,
      },
    });
    if (isApp) continue;
    const mileage = m.evaluated.drive ? Math.round((s["pricing.mileageRoundTrip"] ? 2 : 1) * m.evaluated.drive.miles * s["pricing.mileageRateCentsPerMile"]) : 0;
    const zone = (await db.provider.findUniqueOrThrow({ where: { id: m.providerId }, select: { homeTimeZone: true } })).homeTimeZone;
    const sameDay = new Date(shift.startsAt).toLocaleDateString("en-US", { timeZone: zone }) === now.toLocaleDateString("en-US", { timeZone: zone });
    const day = sameDay ? "TODAY" : shift.startsAt.toLocaleDateString("en-US", { timeZone: zone, weekday: "short", month: "short", day: "numeric" });
    const t = (x: Date) => x.toLocaleTimeString("en-US", { timeZone: zone, hour: "numeric", minute: "2-digit" }).replace(":00", "").replace(" AM", "a").replace(" PM", "p");
    const prof = await db.profession.findUnique({ where: { code: shift.professionCode } });
    const rating = clinicRating._avg.stars ? ` Clinic rated ${clinicRating._avg.stars.toFixed(1)}.` : "";
    const link = absoluteUrl(`/o/${token}`);
    const urgent = shift.emergencyBonusPercent > 0 ? `URGENT — includes +${shift.emergencyBonusPercent}% rescue bonus. ` : "";
    const body = `${brand().name}: ${urgent}${prof?.displayName ?? shift.professionCode} coverage ${day} ${t(shift.startsAt)}–${t(shift.endsAt)}, ${shift.location.city} ${shift.state} (${m.driveMinutes} min away). Pay $${(shift.providerPayCents / 100).toFixed(0)} + $${(mileage / 100).toFixed(0)} mileage.${rating}\nAccept: ${link} or reply YES ${code} / NO ${code}\nOffer closes ${t(wave.windowEndsAt)}.`;
    effects.add(async () => {
      const user = await prisma.user.findUniqueOrThrow({ where: { id: m.userId } });
      const provider = await prisma.provider.findUniqueOrThrow({ where: { id: m.providerId } });
      let sent = false;
      if (smsFirst && user.phone && user.phoneVerifiedAt && provider.smsConsentAt) sent = await smsProvider().send(user.phone, body).catch(() => false);
      await notify(prisma, m.userId, {
        template: "dispatch_offer",
        title: `${day === "TODAY" ? "Today" : day}: ${prof?.displayName ?? ""} shift in ${shift.location.city} — respond by ${t(wave.windowEndsAt)}`,
        body: body.split("\n")[0],
        link: `/o/${token}`,
        ctaLabel: "Accept or decline",
        email: !smsFirst || !sent,
      });
      if (!sent && smsFirst) await prisma.offer.update({ where: { id: offer.id }, data: { channelsSent: ["EMAIL", "IN_APP"] } });
    });
  }
}

async function sendWave(db: Db, dispatchId: string, tier: UrgencyTier, cfg: TierConfig, broadcast: boolean, effects: Effects, opts: { reoffer?: boolean } = {}): Promise<boolean> {
  const s = await getSettings(db);
  const now = clock.now();
  const d = await db.dispatch.findUniqueOrThrow({ where: { id: dispatchId }, include: { shift: true } });
  const cands = await buildCandidates(db, dispatchId, tier, cfg, { includeAlreadyOffered: opts.reoffer });
  const number = d.currentWave + 1;
  // Existing active applications count as wave-1 acceptances (§5.6).
  const applicants = number === 1 || broadcast ? cands.filter((c) => c.applicationId) : [];
  const pool = cands.filter((c) => !c.applicationId);
  const want = broadcast ? pool.length : waveSize(cfg, number, pool.length);
  if (want === 0 && applicants.length === 0) return false;
  const windowMin = d.shift.emergencyAt ? s["emergency.stepMinutes"] : broadcast ? cfg.broadcastWindowMin : cfg.windowMin;
  const capped = capWindow(now, windowMin, d.shift.startsAt, pool.slice(0, want), s["dispatch.arrivalBufferMinutes"], s["dispatch.minWindowMinutes"]);
  if (!capped.members.length && !applicants.length) return false;
  const wave = await db.wave.create({
    data: { dispatchId, number, isBroadcast: broadcast, tier, sentAt: now, windowEndsAt: capped.windowEnd },
  });
  await db.dispatch.update({ where: { id: dispatchId }, data: { currentWave: number, stage: broadcast ? "BROADCAST" : "WAVES" } });
  await createOffers(db, d, wave, capped.members, broadcast ? "BROADCAST" : "DISPATCH", tier, windowMin, effects, applicants);
  await audit(db, SYSTEM, broadcast ? "dispatch.broadcast" : "dispatch.wave", "Shift", d.shiftId, null, { wave: number, size: capped.members.length, applicants: applicants.length, windowEndsAt: capped.windowEnd, tier });
  await evaluateWaveInTx(db, wave.id, effects);
  return true;
}

async function sendStandbyWave(db: Db, dispatchId: string, effects: Effects): Promise<boolean> {
  const s = await getSettings(db);
  const now = clock.now();
  const d = await db.dispatch.findUniqueOrThrow({ where: { id: dispatchId }, include: { shift: true } });
  const tier = urgencyTier(now, d.shift.startsAt);
  const entries = await db.standbyEntry.findMany({ where: { shiftId: d.shiftId } });
  if (!entries.length) return false;
  // Standby providers are re-checked for eligibility (Addendum 02 §15 #4).
  const cands = (await buildCandidates(db, dispatchId, tier, tierConfigFor(s, tier, d.shift.professionCode))).filter((c) => entries.some((e) => e.providerId === c.providerId));
  if (!cands.length) return false;
  const windowMin = tier === "SAME_DAY" ? s["dispatch.standbyWindowMin"].SAME_DAY : s["dispatch.standbyWindowMin"].other;
  const byMatch = [...cands].sort((a, b) => b.matchScore - a.matchScore);
  const capped = capWindow(now, windowMin, d.shift.startsAt, byMatch, s["dispatch.arrivalBufferMinutes"], s["dispatch.minWindowMinutes"]);
  if (!capped.members.length) return false;
  const number = d.currentWave + 1;
  const wave = await db.wave.create({ data: { dispatchId, number, isStandby: true, tier, sentAt: now, windowEndsAt: capped.windowEnd } });
  await db.dispatch.update({ where: { id: dispatchId }, data: { currentWave: number } });
  await createOffers(db, d, wave, capped.members, "STANDBY", tier, windowMin, effects);
  await audit(db, SYSTEM, "dispatch.standby_wave", "Shift", d.shiftId, null, { size: capped.members.length });
  return true;
}

// ======================================================================
// Award logic
// ======================================================================

function methodFor(wave: Wave): SelectionMethod {
  return wave.isStandby ? "STANDBY" : wave.isBroadcast ? "DISPATCH_BROADCAST" : "DISPATCH_WAVE";
}

/** Try to confirm; on failure (race, lapse, conflict) roll back to a savepoint and mark the offer INELIGIBLE. */
async function tryAward(db: Db, offer: Offer, method: SelectionMethod, effects: Effects, graceMinutes?: number): Promise<string | null> {
  const mark = effects.mark();
  await db.$executeRawUnsafe("SAVEPOINT award");
  try {
    const id = await confirmInTx(db, SYSTEM, offer.shiftId, offer.providerId, method, effects, { acceptedOfferId: offer.id.startsWith("oncall:") ? undefined : offer.id, graceMinutes });
    await db.$executeRawUnsafe("RELEASE SAVEPOINT award");
    return id;
  } catch (e) {
    await db.$executeRawUnsafe("ROLLBACK TO SAVEPOINT award");
    effects.rollback(mark);
    if (!offer.id.startsWith("oncall:")) {
      await db.offer.update({ where: { id: offer.id }, data: { status: "INELIGIBLE", respondedAt: clock.now() } });
      const provider = await db.provider.findUniqueOrThrow({ where: { id: offer.providerId } });
      effects.add(() => notify(prisma, provider.userId, { template: "offer_unavailable", title: "This shift is no longer available to you", body: e instanceof DomainError ? e.message : "Your eligibility changed.", email: false, sms: true }));
    }
    return null;
  }
}

/** Rank-protected check for an open wave (§5.4). Broadcast waves only start their hold timer. */
async function evaluateWaveInTx(db: Db, waveId: string, effects: Effects): Promise<void> {
  for (let guard = 0; guard < 50; guard++) {
    const wave = await db.wave.findUniqueOrThrow({ where: { id: waveId }, include: { offers: true, dispatch: true } });
    if (wave.closedAt || wave.dispatch.status !== "ACTIVE") return;
    const s = await getSettings(db);
    if (wave.isBroadcast) {
      const first = wave.offers.filter((o) => o.acceptedAt).sort((a, b) => +a.acceptedAt! - +b.acceptedAt!)[0];
      if (first && !wave.holdEndsAt) {
        const cfg = tierConfigFor(s, wave.tier, (await db.shift.findUniqueOrThrow({ where: { id: wave.dispatch.shiftId } })).professionCode);
        const hold = new Date(Math.min(+first.acceptedAt! + cfg.broadcastHoldMin * 60_000, +wave.windowEndsAt));
        await db.wave.update({ where: { id: wave.id }, data: { holdEndsAt: hold } });
      }
      return;
    }
    const offers: WaveOffer[] = wave.offers.map((o) => ({ id: o.id, matchScore: o.matchScore, status: o.status as WaveOffer["status"], acceptedAt: o.acceptedAt }));
    const { award } = rankProtectedAward(offers);
    if (award) {
      const offer = wave.offers.find((o) => o.id === award)!;
      const ok = await tryAward(db, offer, methodFor(wave), effects);
      if (ok) return;
      continue; // that acceptor became ineligible — re-check the next one
    }
    if (waveAllDeclined(offers)) {
      await db.wave.update({ where: { id: wave.id }, data: { closedAt: clock.now() } });
      await advanceInTx(db, wave.dispatchId, effects); // next wave immediately
    }
    return;
  }
}

/** Close a wave at window end (or broadcast hold end): best acceptor wins; otherwise expire and move on. */
async function closeWaveInTx(db: Db, waveId: string, effects: Effects) {
  const now = clock.now();
  const s = await getSettings(db);
  for (let guard = 0; guard < 50; guard++) {
    const wave = await db.wave.findUniqueOrThrow({ where: { id: waveId }, include: { offers: true, dispatch: true } });
    if (wave.closedAt) return;
    if (wave.dispatch.status !== "ACTIVE") {
      await db.wave.update({ where: { id: wave.id }, data: { closedAt: now } });
      return;
    }
    const best = awardAtClose(wave.offers.map((o) => ({ id: o.id, matchScore: o.matchScore, status: o.status as WaveOffer["status"], acceptedAt: o.acceptedAt })));
    if (best) {
      const ok = await tryAward(db, wave.offers.find((o) => o.id === best)!, methodFor(wave), effects);
      if (ok) {
        await db.wave.update({ where: { id: wave.id }, data: { closedAt: now } });
        return;
      }
      continue;
    }
    // No acceptors: expire pending offers (they stay revivable) and count ignored offers for fatigue.
    const ignored = wave.offers.filter((o) => o.status === "PENDING");
    await db.offer.updateMany({ where: { waveId: wave.id, status: "PENDING" }, data: { status: "EXPIRED" } });
    for (const o of ignored) {
      const p = await db.provider.update({ where: { id: o.providerId }, data: { consecutiveIgnoredOffers: { increment: 1 } } });
      if (p.consecutiveIgnoredOffers >= s["dispatch.autoSnoozeAfterIgnored"]) {
        await db.provider.update({ where: { id: p.id }, data: { snoozedUntil: new Date(+now + 86_400_000), consecutiveIgnoredOffers: 0 } });
        effects.add(() => notify(prisma, p.userId, { template: "auto_snoozed", title: "We paused offers for 24 hours", body: "You missed several offers in a row, so we paused new offers for 24 hours. Tap to resume anytime.", link: "/provider/oncall", ctaLabel: "Resume offers", sms: true }));
      }
    }
    await db.wave.update({ where: { id: wave.id }, data: { closedAt: now } });
    if (wave.isStandby) await db.dispatch.update({ where: { id: wave.dispatchId }, data: { stage: "ON_CALL_CHECK" } });
    await advanceInTx(db, wave.dispatchId, effects);
    return;
  }
}

/**
 * Close the dispatch when the shift is filled by ANY path (award, clinic
 * pick, admin assign, On Call). Other offers → NOT_SELECTED; other
 * acceptors → standby (§7). Called from confirmInTx.
 */
export async function settleDispatchOnFill(db: Db, shiftId: string, providerId: string, method: SelectionMethod, acceptedOfferId: string | null, effects: Effects) {
  const now = clock.now();
  const d = await db.dispatch.findFirst({ where: { shiftId, status: "ACTIVE" } });
  const acceptors = await db.offer.findMany({ where: { shiftId, status: "ACCEPTED_PENDING", providerId: { not: providerId } } });
  await db.offer.updateMany({ where: { shiftId, status: { in: ["PENDING", "ACCEPTED_PENDING", "EXPIRED"] }, id: acceptedOfferId ? { not: acceptedOfferId } : undefined }, data: { status: "NOT_SELECTED", respondedAt: now } });
  if (d) {
    await db.dispatch.update({ where: { id: d.id }, data: { status: "FILLED", stage: "DONE", endedAt: now, filledOfferId: acceptedOfferId, filledVia: method, filledProviderId: providerId } });
    await db.wave.updateMany({ where: { dispatchId: d.id, closedAt: null }, data: { closedAt: now } });
  }
  if (acceptors.length) {
    const s = await getSettings(db);
    const shift = await loadShift(db, shiftId);
    const loaded = await loadProviders(db, acceptors.map((a) => a.providerId), shiftId);
    for (const a of acceptors) {
      const p = loaded.get(a.providerId);
      if (!p) continue;
      // Only still-eligible providers join standby (the DB trigger enforces this too).
      const r = evaluateEligibility(p.facts, shift.facts, { driveMinutes: 0, travelEstimateCents: 0, blocked: false, previouslyDeclined: false }, eligibilityOptions(s, { credentialsOnly: true }));
      if (!r.eligible) continue;
      await db.standbyEntry.upsert({ where: { shiftId_providerId: { shiftId, providerId: a.providerId } }, create: { shiftId, providerId: a.providerId, matchScore: a.matchScore, createdAt: now }, update: { matchScore: a.matchScore } });
      effects.add(() =>
        notify(prisma, p.userId, {
          template: "standby",
          title: "This shift was filled by another provider",
          body: "You're on standby — if it reopens, you'll be first in line. Thanks for accepting.",
          link: "/provider/offers",
          email: false,
          sms: true,
        }),
      );
    }
  }
}

// ======================================================================
// Responses: link, SMS, app (§5.4, §5.6, §8)
// ======================================================================

export type RespondState = "CONFIRMED" | "NEXT_IN_LINE" | "DECLINED" | "INELIGIBLE" | "FILLED" | "CLOSED" | "ALREADY";

export async function respondToDispatchOffer(offerId: string, accept: boolean, channel: "APP" | "LINK" | "SMS"): Promise<{ state: RespondState; message: string; assignmentId?: string; decideBy?: Date }> {
  const offer0 = await prisma.offer.findUniqueOrThrow({ where: { id: offerId } });
  return inShiftTx(offer0.shiftId, async (db, effects) => {
    const now = clock.now();
    const offer = await db.offer.findUniqueOrThrow({ where: { id: offerId }, include: { dispatch: true, wave: true } });
    if (!offer.dispatch || !offer.wave) throw new DomainError("NOT_FOUND", "Offer not found");
    await db.provider.update({ where: { id: offer.providerId }, data: { consecutiveIgnoredOffers: 0 } });
    if (offer.status === "ACCEPTED") {
      const a = await db.assignment.findFirst({ where: { shiftId: offer.shiftId, providerId: offer.providerId, status: { in: ["CONFIRMED", "IN_PROGRESS"] } } });
      return { state: "ALREADY", message: "You're confirmed for this shift.", assignmentId: a?.id };
    }
    if (offer.dispatch.status !== "ACTIVE" || ["NOT_SELECTED", "WITHDRAWN"].includes(offer.status)) {
      return { state: "FILLED", message: "This shift has been filled. Thanks for responding — you'll hear about the next one." };
    }
    if (offer.status === "DECLINED") return { state: "ALREADY", message: "You declined this shift." };
    if (offer.status === "INELIGIBLE") return { state: "INELIGIBLE", message: "This shift is no longer available to you." };
    if (offer.status === "ACCEPTED_PENDING") return { state: "NEXT_IN_LINE", message: "You're next in line.", decideBy: offer.wave.windowEndsAt };

    if (!accept) {
      await db.offer.update({ where: { id: offer.id }, data: { status: "DECLINED", respondedAt: now } });
      await audit(db, SYSTEM, "offer.declined", "Offer", offer.id, { status: offer.status }, { status: "DECLINED", channel });
      await evaluateWaveInTx(db, offer.waveId!, effects);
      effects.add(() => recomputeResponsiveness(offer.providerId));
      return { state: "DECLINED", message: "Thanks for letting us know — declining quickly helps us find coverage faster." };
    }

    // Revived late acceptance joins the CURRENT wave with its original match score (§5.6).
    let waveId = offer.waveId!;
    let revived = false;
    if (offer.status === "EXPIRED" || offer.wave.closedAt) {
      const current = await db.wave.findFirst({ where: { dispatchId: offer.dispatchId!, closedAt: null }, orderBy: { number: "desc" } });
      revived = true;
      if (current) waveId = current.id;
    }
    // Eligibility re-check (INV-1 etc.) — the DB trigger also re-checks on the status change.
    const { evaluateProviderForShift } = await import("./eligibility");
    const ev = await evaluateProviderForShift(db, offer.providerId, offer.shiftId);
    if (!ev.result.eligible) {
      await db.offer.update({ where: { id: offer.id }, data: { status: "INELIGIBLE", respondedAt: now } });
      await evaluateWaveInTx(db, offer.waveId!, effects);
      return { state: "INELIGIBLE", message: "This shift is no longer available to you." };
    }
    await db.offer.update({ where: { id: offer.id }, data: { status: "ACCEPTED_PENDING", acceptedAt: now, respondedAt: now, waveId, revived } });
    await audit(db, SYSTEM, "offer.accepted_pending", "Offer", offer.id, { status: offer.status }, { channel, revived });
    effects.add(() => recomputeResponsiveness(offer.providerId));
    const wave = await db.wave.findUniqueOrThrow({ where: { id: waveId } });
    if (wave.closedAt) {
      // No open wave (between stages): the best acceptor can be confirmed now.
      const id = await tryAward(db, { ...offer, waveId }, methodFor(wave), effects);
      return id ? { state: "CONFIRMED", message: "You're confirmed!", assignmentId: id } : { state: "INELIGIBLE", message: "This shift is no longer available to you." };
    }
    await evaluateWaveInTx(db, waveId, effects);
    const after = await db.offer.findUniqueOrThrow({ where: { id: offer.id } });
    if (after.status === "ACCEPTED") {
      const a = await db.assignment.findFirst({ where: { shiftId: offer.shiftId, providerId: offer.providerId, status: "CONFIRMED" } });
      return { state: "CONFIRMED", message: "You're confirmed! Details and arrival notes are in the app.", assignmentId: a?.id };
    }
    if (after.status === "INELIGIBLE") return { state: "INELIGIBLE", message: "This shift is no longer available to you." };
    const decideBy = wave.isBroadcast ? (await db.wave.findUniqueOrThrow({ where: { id: waveId } })).holdEndsAt ?? wave.windowEndsAt : wave.windowEndsAt;
    return { state: "NEXT_IN_LINE", message: `You're next in line. You'll know by ${decideBy.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}.`, decideBy };
  });
}

export async function offerByToken(token: string) {
  const offer = await prisma.offer.findUnique({
    where: { linkTokenHash: sha256(token) },
    include: { dispatch: true, wave: true, provider: true, shift: { include: { location: { include: { clinicOrg: true } } } } },
  });
  if (!offer) return null;
  if (!offer.openedAt) await prisma.offer.update({ where: { id: offer.id }, data: { openedAt: clock.now() } });
  return offer;
}

/** Accept/decline from the signed link — the token alone authorizes this one offer (§8.2). */
export async function respondByToken(token: string, accept: boolean) {
  const offer = await prisma.offer.findUnique({ where: { linkTokenHash: sha256(token) }, include: { dispatch: true } });
  if (!offer) throw new DomainError("NOT_FOUND", "This link is invalid.");
  if (offer.dispatch && offer.dispatch.status !== "ACTIVE" && offer.status !== "ACCEPTED") return { state: "FILLED" as RespondState, message: "This shift has been filled." };
  return respondToDispatchOffer(offer.id, accept, "LINK");
}

/** Inbound SMS (§8.3). Returns the reply text. Never accepts a bare "YES". */
export async function handleInboundSms(fromPhone: string, text: string): Promise<string> {
  const { parseSmsReply } = await import("@cm/core");
  const b = brand();
  const user = await prisma.user.findFirst({ where: { phone: fromPhone, phoneVerifiedAt: { not: null } }, include: { provider: true } });
  const r = parseSmsReply(text);
  if (r.kind === "STOP") {
    if (user?.provider) await prisma.provider.update({ where: { id: user.provider.id }, data: { smsConsentAt: null } });
    return `${b.name}: You're unsubscribed from texts. Reply START to resubscribe.`;
  }
  if (r.kind === "START") {
    if (user?.provider) await prisma.provider.update({ where: { id: user.provider.id }, data: { smsConsentAt: clock.now() } });
    return `${b.name}: Texts are back on. Reply STOP to opt out.`;
  }
  if (r.kind === "HELP") return `${b.name}: Reply YES <code> or NO <code> to answer a shift offer. Help: ${b.supportEmail}. Reply STOP to opt out.`;
  if (!user?.provider) return `${b.name}: We couldn't match this number to a provider account.`;
  const open = await prisma.offer.findMany({
    where: { providerId: user.provider.id, dispatchId: { not: null }, status: { in: ["PENDING", "EXPIRED", "ACCEPTED_PENDING"] }, dispatch: { status: "ACTIVE" } },
    include: { shift: { include: { location: true } } },
  });
  if (r.kind === "UNKNOWN") return `${b.name}: Sorry, we didn't understand. Reply YES <code> or NO <code>.`;
  if (!r.code) {
    const pending = open.filter((o) => o.status === "PENDING");
    if (pending.length === 1) {
      const o = pending[0];
      return `${b.name}: Reply ${r.kind} ${o.replyCode} to ${r.kind === "YES" ? "accept" : "decline"} the ${o.shift.startsAt.toLocaleTimeString("en-US", { timeZone: user.provider.homeTimeZone, hour: "numeric", minute: "2-digit" })} ${o.shift.location.city} shift.`;
    }
    return `${b.name}: Please include the 4-digit code, e.g. ${r.kind} 1234.`;
  }
  const offer = open.find((o) => o.replyCode === r.code) ?? (await prisma.offer.findFirst({ where: { providerId: user.provider.id, replyCode: r.code }, orderBy: { createdAt: "desc" } }));
  if (!offer) return `${b.name}: Code ${r.code} doesn't match an open offer.`;
  const res = await respondToDispatchOffer(offer.id, r.kind === "YES", "SMS");
  return `${b.name}: ${res.message}`;
}

// ======================================================================
// Applications during an active dispatch (§5.6)
// ======================================================================

export async function applicationAsAcceptance(shiftId: string, providerId: string, applicationId: string) {
  return inShiftTx(shiftId, async (db, effects) => {
    const d = await db.dispatch.findFirst({ where: { shiftId, status: "ACTIVE" } });
    if (!d) return null;
    const existing = await db.offer.findFirst({ where: { dispatchId: d.id, providerId } });
    const wave = await db.wave.findFirst({ where: { dispatchId: d.id, closedAt: null }, orderBy: { number: "desc" } });
    if (existing) {
      if (["PENDING", "EXPIRED"].includes(existing.status)) {
        await db.offer.update({ where: { id: existing.id }, data: { status: "ACCEPTED_PENDING", acceptedAt: clock.now(), respondedAt: clock.now(), applicationId, ...(wave ? { waveId: wave.id } : {}) } });
      }
    } else if (wave) {
      const s = await getSettings(db);
      const cands = await buildCandidates(db, d.id, wave.tier, tierConfigFor(s, wave.tier), { includeAlreadyOffered: true });
      const me = cands.find((c) => c.providerId === providerId);
      if (!me) return null;
      await createOffers(db, d, wave, [], wave.isBroadcast ? "BROADCAST" : "DISPATCH", wave.tier, 0, effects, [{ ...me, applicationId }]);
    }
    if (wave) await evaluateWaveInTx(db, wave.id, effects);
    return d.id;
  });
}

// ======================================================================
// On Call (§4)
// ======================================================================

export function ruleFacts(r: {
  active: boolean; pausedUntil: Date | null; professionCodes: string[]; recurringWindows: unknown; dateWindows: unknown; timeZone: string; maxDriveMinutes: number;
  minPayHalfDayCents: number | null; minPayFullDayCents: number | null; minPayHourlyCents: number | null; minNoticeMinutes: number; maxPerDay: number; maxPerWeek: number;
  favoritesOnly: boolean; minClinicRating: number | null; excludedClinicIds: string[]; allowOvernight: boolean;
}): OnCallRuleFacts {
  return {
    ...r,
    recurringWindows: (r.recurringWindows as OnCallRuleFacts["recurringWindows"]) ?? [],
    dateWindows: ((r.dateWindows as { startsAt: string; endsAt: string }[]) ?? []).map((w) => ({ startsAt: new Date(w.startsAt), endsAt: new Date(w.endsAt) })),
  };
}

/** Is this provider allowed to use On Call right now? (§4.3) */
export async function onCallEligibility(db: Db, providerId: string): Promise<{ ok: boolean; reasons: string[] }> {
  const s = await getSettings(db);
  const p = await db.provider.findUniqueOrThrow({ where: { id: providerId }, include: { user: true, stats: true } });
  const reasons: string[] = [];
  if (!s["features.onCallEnabled"]) reasons.push("On Call isn't available yet");
  if (p.status !== "ACTIVE" || !p.stripePayoutsEnabled) reasons.push("Finish your profile and payout setup");
  // Texts are how On Call reaches people fast; in email-only mode (no texting set up) it's not required.
  if (textingEnabled() && (!p.user.phoneVerifiedAt || !p.smsConsentAt)) reasons.push("Verify your mobile number and allow texts");
  const st = p.stats ?? { completedShifts: 0, lateCancels: 0, noShows: 0 };
  if (st.completedShifts < s["oncall.minCompletedShifts"]) reasons.push(`Complete at least ${s["oncall.minCompletedShifts"]} shift(s) first`);
  if (reliabilityComponent(st) < s["oncall.minReliability"]) reasons.push("Reliability is below the On Call minimum");
  if (p.oncallPausedReason) reasons.push(p.oncallPausedReason);
  return { ok: reasons.length === 0, reasons };
}

async function onCallContext(db: Db, providerId: string, shift: { startsAt: Date; clinicOrgId: string }, driveMinutes: number, zone: string) {
  const { DateTime } = await import("luxon");
  const day = DateTime.fromJSDate(shift.startsAt, { zone });
  const [sameDay, sameWeek, fav, rating] = await Promise.all([
    db.assignment.count({ where: { providerId, selectionMethod: "ON_CALL_AUTO", status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] }, startsAt: { gte: day.startOf("day").toJSDate(), lt: day.endOf("day").toJSDate() } } }),
    db.assignment.count({ where: { providerId, selectionMethod: "ON_CALL_AUTO", status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] }, startsAt: { gte: day.startOf("week").toJSDate(), lt: day.endOf("week").toJSDate() } } }),
    db.favorite.count({ where: { fromType: "PROVIDER", fromId: providerId, toType: "CLINIC", toId: shift.clinicOrgId } }),
    db.rating.aggregate({ where: { raterType: "PROVIDER", revealedAt: { not: null }, assignment: { shift: { location: { clinicOrgId: shift.clinicOrgId } } } }, _avg: { stars: true } }),
  ]);
  return { sameDay, sameWeek, fav: fav > 0, rating: rating._avg.stars ?? null };
}

/** Providers whose On Call rules match this shift (eligible ones only), best match first. */
export async function onCallMatches(db: Db, shiftId: string): Promise<{ providerId: string; userId: string; matchScore: number; ruleId: string }[]> {
  const now = clock.now();
  const s = await getSettings(db);
  if (!s["features.onCallEnabled"]) return [];
  const shift = await db.shift.findUniqueOrThrow({ where: { id: shiftId }, include: { location: true } });
  const loaded = await loadShift(db, shiftId);
  const set = await getEligibleProviders(db, loaded); // INV-1 first — rules can never widen it (§15 #2)
  if (!set.eligible.length) return [];
  const rules = await db.onCallRule.findMany({ where: { providerId: { in: set.eligible.map((e) => e.providerId) }, active: true }, include: { provider: true } });
  if (!rules.length) return [];
  const ranked = await rankEvaluated(db, loaded, set.eligible.filter((e) => rules.some((r) => r.providerId === e.providerId)));
  const out = [];
  for (const r of ranked) {
    const prov = rules.find((x) => x.providerId === r.providerId)!.provider;
    if (prov.snoozedUntil && prov.snoozedUntil > now) continue;
    if (!(await onCallEligibility(db, r.providerId)).ok) continue;
    const drive = r.evaluated.drive?.minutes ?? null;
    if (!arrivalFeasible(now, drive, s["dispatch.arrivalBufferMinutes"], shift.startsAt)) continue;
    const ctx = await onCallContext(db, r.providerId, { startsAt: shift.startsAt, clinicOrgId: shift.location.clinicOrgId }, drive ?? 0, prov.homeTimeZone);
    const hours = (+shift.endsAt - +shift.startsAt) / 3_600_000;
    const matched = rules
      .filter((x) => x.providerId === r.providerId)
      .find(
        (rule) =>
          onCallRuleMismatch(
            ruleFacts(rule),
            { professionCode: shift.professionCode, startsAt: shift.startsAt, endsAt: shift.endsAt, durationTier: shift.durationTier ?? "FULL_DAY", hours, providerPayCents: shift.providerPayCents, clinicOrgId: shift.location.clinicOrgId, lodgingAllowed: shift.lodgingAllowed },
            { now, driveMinutes: drive ?? 0, clinicFavoritedByProvider: ctx.fav, clinicRating: ctx.rating, onCallShiftsSameDay: ctx.sameDay, onCallShiftsSameWeek: ctx.sameWeek, needsOvernight: (drive ?? 0) > prov.maxDriveMinutes },
          ) === null,
      );
    if (matched) out.push({ providerId: r.providerId, userId: prov.userId, matchScore: r.score, ruleId: matched.id });
  }
  return out.sort((a, b) => b.matchScore - a.matchScore);
}

/** On Call check (§4.4): confirm the best matching On Call provider instantly. */
async function onCallCheck(db: Db, dispatchId: string, effects: Effects): Promise<boolean> {
  const s = await getSettings(db);
  const d = await db.dispatch.findUniqueOrThrow({ where: { id: dispatchId } });
  const matches = await onCallMatches(db, d.shiftId);
  for (const m of matches) {
    const pseudo = { id: `oncall:${m.providerId}`, shiftId: d.shiftId, providerId: m.providerId } as Offer;
    const id = await tryAward(db, pseudo, "ON_CALL_AUTO", effects, s["oncall.graceMinutes"]);
    if (id) {
      await audit(db, SYSTEM, "oncall.auto_confirmed", "Assignment", id, null, { ruleId: m.ruleId, matchScore: m.matchScore });
      effects.add(() =>
        notify(prisma, m.userId, {
          template: "oncall_confirmed",
          title: "On Call: you've been booked",
          body: `You're confirmed for a shift that matches your On Call rules. Can't make it? Cancel within ${s["oncall.graceMinutes"]} minutes with no penalty.`,
          link: `/provider/assignments/${id}`,
          ctaLabel: "View shift",
          sms: true,
        }),
      );
      return true;
    }
  }
  return false;
}

/** No-penalty cancel within the grace period (§4.5). Resumes dispatch instantly. */
export async function onCallGraceCancel(actor: Actor, assignmentId: string) {
  const providerId = requireProvider(actor);
  const s = await getSettings();
  const now = clock.now();
  const a = await prisma.assignment.findFirst({ where: { id: assignmentId, providerId }, include: { shift: { include: { location: true } } } });
  if (!a) throw new DomainError("NOT_FOUND", "Assignment not found");
  if (a.selectionMethod !== "ON_CALL_AUTO" || !a.graceEndsAt || a.graceEndsAt <= now || a.status !== "CONFIRMED") {
    throw new DomainError("CONFLICT", "The no-penalty window for this shift has passed.");
  }
  await prisma.$transaction(async (db) => {
    await lockShift(db, a.shiftId);
    await db.assignment.update({ where: { id: a.id }, data: { status: "CANCELLED", cancelledAt: now, cancelledBy: "PROVIDER", cancelReason: "On Call grace cancel" } });
    await db.payout.updateMany({ where: { assignmentId: a.id, status: { in: ["PENDING", "SCHEDULED"] } }, data: { status: "CANCELLED" } });
    await db.shift.update({ where: { id: a.shiftId }, data: { status: "OPEN" } });
    // Exclude this provider from this shift (F10).
    await db.offer.create({ data: { shiftId: a.shiftId, providerId, source: "DISPATCH", status: "DECLINED", expiresAt: now, respondedAt: now, createdAt: now } });
    await audit(db, actor, "oncall.grace_cancel", "Assignment", a.id, { status: "CONFIRMED" }, { status: "CANCELLED" });
  });
  const { refundAssignment, depositPaidCents } = await import("./payments");
  const dep = await depositPaidCents(a.id);
  if (dep) await refundAssignment(SYSTEM, a.id, dep, "On Call grace cancel");
  const recent = await prisma.auditLog.count({ where: { action: "oncall.grace_cancel", actorUserId: actor.userId, createdAt: { gte: new Date(+now - 30 * 86_400_000) } } });
  if (recent > s["oncall.maxGraceCancels30d"]) {
    await prisma.onCallRule.updateMany({ where: { providerId }, data: { active: false } });
    await prisma.provider.update({ where: { id: providerId }, data: { oncallPausedReason: "On Call was paused after several grace cancellations. Contact support to turn it back on." } });
    await notify(prisma, actor.userId!, { template: "oncall_paused", title: "On Call paused", body: "You've cancelled several On Call bookings within the grace period in the last 30 days, so On Call has been paused.", link: "/provider/oncall", sms: true });
  }
  await notifyClinic(prisma, a.shift.location.clinicOrgId, {
    template: "oncall_grace_cancel",
    title: "Your provider had a conflict — we're already finding another",
    body: "We've reopened your shift and are contacting the next best providers now.",
    link: `/clinic/shifts/${a.shiftId}`,
    sms: true,
  });
  await startDispatch(a.shiftId, "BACKFILL");
}

/** Clinic picks a provider whose On Call rules match (NEAR/PLANNED badge, §4.6): confirmed immediately. */
export async function clinicInstantConfirm(actor: Actor, shiftId: string, providerId: string) {
  const orgId = requireClinic(actor);
  const shift = await prisma.shift.findFirst({ where: { id: shiftId, location: { clinicOrgId: orgId } } });
  if (!shift) throw new DomainError("NOT_FOUND", "Shift not found");
  const s = await getSettings();
  return inShiftTx(shiftId, async (db, effects) => {
    const matches = await onCallMatches(db, shiftId);
    if (!matches.some((m) => m.providerId === providerId)) throw new DomainError("CONFLICT", "That provider's On Call rules no longer match this shift.");
    const id = await confirmInTx(db, actor, shiftId, providerId, "ON_CALL_AUTO", effects, { graceMinutes: s["oncall.graceMinutes"] });
    return { assignmentId: id };
  });
}

// ======================================================================
// Clinic / admin controls
// ======================================================================

export async function findSomeoneNow(actor: Actor, shiftId: string) {
  if (actor.role === "PLATFORM_ADMIN") return startDispatch(shiftId, "ADMIN", actor);
  const orgId = requireClinic(actor);
  const shift = await prisma.shift.findFirst({ where: { id: shiftId, location: { clinicOrgId: orgId } } });
  if (!shift) throw new DomainError("NOT_FOUND", "Shift not found");
  return startDispatch(shiftId, "CLINIC_REQUEST", actor);
}

export async function cancelDispatch(actor: Actor, shiftId: string) {
  if (actor.role !== "PLATFORM_ADMIN") {
    const orgId = requireClinic(actor);
    const shift = await prisma.shift.findFirst({ where: { id: shiftId, location: { clinicOrgId: orgId } } });
    if (!shift) throw new DomainError("NOT_FOUND", "Shift not found");
  }
  await inShiftTx(shiftId, async (db) => {
    const now = clock.now();
    const d = await db.dispatch.findFirst({ where: { shiftId, status: "ACTIVE" } });
    if (!d) return;
    await db.dispatch.update({ where: { id: d.id }, data: { status: "CANCELLED", stage: "DONE", endedAt: now } });
    await db.wave.updateMany({ where: { dispatchId: d.id, closedAt: null }, data: { closedAt: now } });
    await db.offer.updateMany({ where: { dispatchId: d.id, status: { in: ["PENDING", "ACCEPTED_PENDING"] } }, data: { status: "WITHDRAWN", respondedAt: now } });
    await db.shift.update({ where: { id: shiftId }, data: { status: "OPEN" } });
    await audit(db, actor, "dispatch.cancelled", "Shift", shiftId, null, { dispatchId: d.id });
  });
}

/** Exhausted → one-click urgent rate boost: reprice with the BOOST premium and start a new dispatch (§5.7). */
export async function boostAndRedispatch(actor: Actor, shiftId: string) {
  const orgId = actor.role === "PLATFORM_ADMIN" ? null : requireClinic(actor);
  const shift = await prisma.shift.findFirstOrThrow({ where: { id: shiftId, ...(orgId ? { location: { clinicOrgId: orgId } } : {}) } });
  if (shift.boosted) throw new DomainError("CONFLICT", "This shift is already boosted.");
  const { quoteShift } = await import("./pricing");
  const q = await quoteShift(prisma, { locationId: shift.locationId, professionCode: shift.professionCode, startsAt: shift.startsAt, endsAt: shift.endsAt, boosted: true, pricedAt: shift.postedAt ?? clock.now() });
  const discount = Math.min(shift.promoDiscountCents, Math.max(0, q.base.clinicPriceCents - q.base.providerPayCents));
  await prisma.shift.update({ where: { id: shiftId }, data: { boosted: true, clinicPriceCents: q.base.clinicPriceCents, providerPayCents: q.base.providerPayCents, premiumsApplied: q.base.premiums as never, promoDiscountCents: discount } });
  await audit(prisma, actor, "shift.boosted", "Shift", shiftId, { clinicPriceCents: shift.clinicPriceCents, providerPayCents: shift.providerPayCents }, { clinicPriceCents: q.base.clinicPriceCents, providerPayCents: q.base.providerPayCents });
  return startDispatch(shiftId, "RATE_BOOST", actor);
}

/** Live tracker for the clinic (§9): counts and stages, never provider names (except pickable acceptors). */
export async function dispatchStatus(shiftId: string) {
  const d = await prisma.dispatch.findFirst({ where: { shiftId }, orderBy: { startedAt: "desc" }, include: { waves: { orderBy: { number: "asc" }, include: { offers: { include: { provider: { select: { displayName: true } } } } } } } });
  if (!d) return null;
  const current = d.waves.filter((w) => !w.closedAt).at(-1) ?? d.waves.at(-1) ?? null;
  const all = d.waves.flatMap((w) => w.offers);
  return {
    id: d.id,
    status: d.status,
    stage: d.stage,
    trigger: d.trigger,
    startedAt: d.startedAt,
    endedAt: d.endedAt,
    filledVia: d.filledVia,
    wave: current ? { number: current.number, isBroadcast: current.isBroadcast, isStandby: current.isStandby, windowEndsAt: current.windowEndsAt, holdEndsAt: current.holdEndsAt, size: current.offers.length } : null,
    offersSent: all.length,
    accepted: all.filter((o) => o.status === "ACCEPTED_PENDING").length,
    declined: all.filter((o) => o.status === "DECLINED").length,
    acceptedPending: all.filter((o) => o.status === "ACCEPTED_PENDING").map((o) => ({ providerId: o.providerId, displayName: o.provider.displayName, matchScore: o.matchScore })),
  };
}

// ======================================================================
// Responsiveness (§6)
// ======================================================================

export async function recomputeResponsiveness(providerId: string) {
  const s = await getSettings();
  const now = clock.now();
  const offers = await prisma.offer.findMany({
    where: { providerId, tier: { not: null }, createdAt: { gte: new Date(+now - s["responsiveness.lookbackDays"] * 86_400_000) }, source: { in: ["DISPATCH", "BROADCAST", "STANDBY"] }, applicationId: null },
    select: { tier: true, createdAt: true, respondedAt: true, windowMinutes: true, status: true },
  });
  const recs = offers
    .filter((o) => o.status !== "WITHDRAWN" || o.respondedAt)
    .map((o) => ({ tier: o.tier!, sentAt: o.createdAt, respondedAt: o.status === "NOT_SELECTED" && !o.respondedAt ? null : o.respondedAt, windowMinutes: o.windowMinutes ?? 5 }));
  // On Call auto-accepts count as immediate responses.
  const onCall = await prisma.assignment.findMany({ where: { providerId, selectionMethod: "ON_CALL_AUTO", confirmedAt: { gte: new Date(+now - s["responsiveness.lookbackDays"] * 86_400_000) } }, select: { confirmedAt: true, startsAt: true } });
  for (const a of onCall) recs.push({ tier: urgencyTier(a.confirmedAt, a.startsAt), sentAt: a.confirmedAt, respondedAt: a.confirmedAt, windowMinutes: 1 });
  const c = responseCounts(recs, now);
  for (const tier of ["SAME_DAY", "SHORT", "NEAR", "PLANNED"] as UrgencyTier[]) {
    const p = pRespondFn(c.byTier[tier], c.overall, s["responsiveness.prior"]);
    const times = offers.filter((o) => o.tier === tier && o.respondedAt).map((o) => (+o.respondedAt! - +o.createdAt) / 1000).sort((a, b) => a - b);
    const median = times.length ? Math.round(times[Math.floor(times.length / 2)]) : null;
    await prisma.providerResponsiveness.upsert({
      where: { providerId_tier: { providerId, tier } },
      create: { providerId, tier, offers: c.byTier[tier].n, hits: c.byTier[tier].hits, pRespond: p, medianResponseSeconds: median },
      update: { offers: c.byTier[tier].n, hits: c.byTier[tier].hits, pRespond: p, medianResponseSeconds: median },
    });
  }
}

// ======================================================================
// Timers (worker sweeps; idempotent)
// ======================================================================

/** waveClose, broadcastHoldEnd, standbyWindowClose, oncallGraceEnd, snoozeResume — all due items. */
export async function tickDispatch(now = clock.now()) {
  const due = await prisma.wave.findMany({
    where: { closedAt: null, OR: [{ windowEndsAt: { lte: now } }, { holdEndsAt: { lte: now } }] },
    select: { id: true, dispatch: { select: { shiftId: true } } },
  });
  for (const w of due) {
    try {
      await inShiftTx(w.dispatch.shiftId, (db, effects) => closeWaveInTx(db, w.id, effects));
    } catch (e) {
      console.error("waveClose failed", w.id, e);
    }
  }
  // Dispatches with no open wave that are still ACTIVE (e.g. after a restart mid-advance).
  const stalled = await prisma.dispatch.findMany({ where: { status: "ACTIVE", waves: { none: { closedAt: null } } }, select: { id: true, shiftId: true } });
  for (const d of stalled) {
    try {
      await inShiftTx(d.shiftId, (db, effects) => advanceInTx(db, d.id, effects));
    } catch (e) {
      console.error("dispatch advance failed", d.id, e);
    }
  }
  // Grace periods end: nothing to change except the audit trail; clear the field for clarity.
  await prisma.assignment.updateMany({ where: { graceEndsAt: { lte: now } }, data: { graceEndsAt: null } });
  // Snooze resume.
  await prisma.provider.updateMany({ where: { snoozedUntil: { lte: now } }, data: { snoozedUntil: null } });
  // Standby expires when the shift starts.
  await prisma.standbyEntry.deleteMany({ where: { shift: { startsAt: { lte: now } } } });
  return { closedWaves: due.length, advanced: stalled.length };
}

/** Selection deadline (planned shifts, §3): auto-select a qualifying applicant, else dispatch. */
export async function runSelectionDeadlines(now = clock.now()) {
  const s = await getSettings();
  const due = await prisma.shift.findMany({
    where: { status: { in: ["OPEN", "FAVORITES_ONLY", "SELECTING"] }, selectionDeadline: { lte: now }, startsAt: { gt: now }, dispatches: { none: {} } },
    select: { id: true },
  });
  let dispatched = 0;
  let autoSelected = 0;
  for (const { id } of due) {
    const loaded = await loadShift(prisma, id);
    const apps = await prisma.application.findMany({ where: { shiftId: id, status: "ACTIVE" } });
    if (apps.length) {
      const set = await getEligibleProviders(prisma, loaded);
      const eligibleApps = set.eligible.filter((e) => apps.some((a) => a.providerId === e.providerId));
      await prisma.application.updateMany({ where: { shiftId: id, status: "ACTIVE", providerId: { notIn: eligibleApps.map((e) => e.providerId) } }, data: { status: "INELIGIBLE" } });
      const ranked = await rankEvaluated(prisma, loaded, eligibleApps);
      const best = ranked[0];
      if (best && best.score >= s["matching.autoSelectMinScore"]) {
        try {
          const { confirmProvider } = await import("./confirm");
          await confirmProvider(SYSTEM, id, best.providerId, "AUTO_APPLICANT");
          autoSelected++;
          continue;
        } catch {
          /* fall through to dispatch */
        }
      }
    }
    await startDispatch(id, "SELECTION_DEADLINE");
    dispatched++;
  }
  return { dispatched, autoSelected };
}

/** Favorites-only window ends → open to everyone eligible. */
export async function endFavoritesWindows(now = clock.now()) {
  const due = await prisma.shift.findMany({ where: { status: "FAVORITES_ONLY", favoritesWindowEndsAt: { lte: now } }, select: { id: true } });
  for (const { id } of due) {
    await prisma.shift.update({ where: { id }, data: { status: "OPEN" } });
    await notifyEligibleProvidersOfShift(id, "posted").catch(() => 0);
  }
  return due.length;
}

// ======================================================================
// Provider controls: snooze, quiet hours
// ======================================================================

export async function setSnooze(actor: Actor, until: Date | null) {
  const providerId = requireProvider(actor);
  await prisma.provider.update({ where: { id: providerId }, data: { snoozedUntil: until, consecutiveIgnoredOffers: 0 } });
}

export async function setQuietHours(actor: Actor, input: { startMin: number; endMin: number; urgentDuringQuietHours: boolean }) {
  const providerId = requireProvider(actor);
  await prisma.provider.update({ where: { id: providerId }, data: { quietHoursStart: input.startMin, quietHoursEnd: input.endMin, urgentDuringQuietHours: input.urgentDuringQuietHours } });
}
