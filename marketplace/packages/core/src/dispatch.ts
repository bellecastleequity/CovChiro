import type { TierConfig } from "@cm/config";
import { DateTime } from "luxon";
import { HOUR, MINUTE } from "./time";
import { seededRank } from "./scoring";

/**
 * Smart Dispatch & On Call (Addendum 02) — the pure parts. The DB-backed
 * engine in @cm/services calls these; tests drive them with a fixed clock.
 *
 * Match score decides who WINS. Dispatch score decides who is ASKED FIRST.
 */

export type UrgencyTier = "SAME_DAY" | "SHORT" | "NEAR" | "PLANNED";

export function urgencyTier(now: Date, startsAt: Date): UrgencyTier {
  const h = (+startsAt - +now) / HOUR;
  if (h < 12) return "SAME_DAY";
  if (h < 48) return "SHORT";
  if (h < 168) return "NEAR";
  return "PLANNED";
}

/** Wave n (1-based) size = min(wave1 + (n−1)·growth, max), limited by remaining candidates. */
export function waveSize(cfg: Pick<TierConfig, "wave1" | "growth" | "max">, n: number, remaining: number): number {
  return Math.max(0, Math.min(cfg.wave1 + (n - 1) * cfg.growth, cfg.max, remaining));
}

/** Can the provider physically arrive in time? now + drive + buffer ≤ start. */
export function arrivalFeasible(now: Date, driveMinutes: number | null, bufferMinutes: number, startsAt: Date): boolean {
  if (driveMinutes === null) return false;
  return +now + (driveMinutes + bufferMinutes) * MINUTE <= +startsAt;
}

/**
 * Accept-window end, capped so the farthest provider in the wave can still
 * arrive: windowEnd ≤ start − maxDrive − buffer. If that leaves less than
 * minWindow, drop the farthest providers until it doesn't.
 */
export function capWindow<T extends { driveMinutes: number }>(
  now: Date,
  windowMinutes: number,
  startsAt: Date,
  members: T[],
  bufferMinutes: number,
  minWindowMinutes: number,
): { windowEnd: Date; members: T[]; dropped: T[] } {
  const sorted = [...members].sort((a, b) => a.driveMinutes - b.driveMinutes);
  const dropped: T[] = [];
  while (sorted.length) {
    const maxDrive = sorted[sorted.length - 1].driveMinutes;
    const latest = +startsAt - (maxDrive + bufferMinutes) * MINUTE;
    const end = Math.min(+now + windowMinutes * MINUTE, latest);
    if (end - +now >= minWindowMinutes * MINUTE) {
      const keep = new Set(sorted);
      return { windowEnd: new Date(end), members: members.filter((m) => keep.has(m)), dropped };
    }
    dropped.push(sorted.pop()!);
  }
  return { windowEnd: new Date(+now + minWindowMinutes * MINUTE), members: [], dropped };
}

// ---------------- responsiveness (§6) ----------------

export interface ResponseRecord {
  tier: UrgencyTier;
  sentAt: Date;
  respondedAt: Date | null;
  windowMinutes: number;
}

export interface RateCounts {
  n: number;
  hits: number;
}

/** Weighted counts; offers older than `halfWeightDays` count half. A response within the window (accept OR decline) is a hit. */
export function responseCounts(records: ResponseRecord[], now: Date, halfWeightDays = 30): { byTier: Record<UrgencyTier, RateCounts>; overall: RateCounts } {
  const byTier: Record<UrgencyTier, RateCounts> = { SAME_DAY: { n: 0, hits: 0 }, SHORT: { n: 0, hits: 0 }, NEAR: { n: 0, hits: 0 }, PLANNED: { n: 0, hits: 0 } };
  const overall = { n: 0, hits: 0 };
  for (const r of records) {
    const w = +now - +r.sentAt > halfWeightDays * 86_400_000 ? 0.5 : 1;
    const hit = r.respondedAt !== null && +r.respondedAt - +r.sentAt <= r.windowMinutes * MINUTE ? 1 : 0;
    byTier[r.tier].n += w;
    byTier[r.tier].hits += w * hit;
    overall.n += w;
    overall.hits += w * hit;
  }
  return { byTier, overall };
}

/**
 * pRespond(tier) = (a + hits) / (a + b + n). With fewer than 3 offers in the
 * tier, blend with the provider's overall rate (weighted by tier sample size).
 * A new provider starts at a / (a + b) = 0.5.
 */
export function pRespond(tierCounts: RateCounts, overall: RateCounts, prior: { a: number; b: number }): number {
  const beta = (c: RateCounts) => (prior.a + c.hits) / (prior.a + prior.b + c.n);
  if (tierCounts.n >= 3) return beta(tierCounts);
  const w = tierCounts.n / 3;
  return w * beta(tierCounts) + (1 - w) * beta(overall);
}

/** dispatchScore = matchScore × (1 − β + β·pRespond) (+ optional standby courtesy boost). */
export function dispatchScore(matchScore: number, p: number, beta: number, courtesyBoost = 0): number {
  return matchScore * (1 - beta + beta * p) + courtesyBoost;
}

export interface DispatchCandidate {
  providerId: string;
  matchScore: number;
  dispatchScore: number;
  driveMinutes: number;
  shiftsThisMonth: number;
}

/** Order to ask: dispatch score desc → match desc → shorter drive → fewer shifts this month → seeded random. */
export function orderForDispatch<T extends DispatchCandidate>(cands: T[], seed: string): T[] {
  return [...cands].sort(
    (a, b) =>
      b.dispatchScore - a.dispatchScore ||
      b.matchScore - a.matchScore ||
      a.driveMinutes - b.driveMinutes ||
      a.shiftsThisMonth - b.shiftsThisMonth ||
      seededRank(seed, a.providerId) - seededRank(seed, b.providerId),
  );
}

// ---------------- rank-protected award (§5.4) ----------------

export type WaveOfferStatus = "PENDING" | "ACCEPTED_PENDING" | "DECLINED" | "EXPIRED" | "INELIGIBLE" | "NOT_SELECTED" | "WITHDRAWN" | "ACCEPTED";

export interface WaveOffer {
  id: string;
  matchScore: number;
  status: WaveOfferStatus;
  acceptedAt: Date | null;
}

function bestAcceptor(offers: WaveOffer[]): WaveOffer | null {
  const acc = offers.filter((o) => o.status === "ACCEPTED_PENDING");
  if (!acc.length) return null;
  return acc.sort((a, b) => b.matchScore - a.matchScore || +(a.acceptedAt ?? 0) - +(b.acceptedAt ?? 0))[0];
}

/**
 * During an open wave: award the best acceptor only if no offer with a
 * higher match score is still PENDING. Never "first to answer wins".
 */
export function rankProtectedAward(offers: WaveOffer[]): { award: string | null; waitingOn: string[] } {
  const best = bestAcceptor(offers);
  if (!best) return { award: null, waitingOn: [] };
  const higherPending = offers.filter((o) => o.status === "PENDING" && o.matchScore > best.matchScore).map((o) => o.id);
  return higherPending.length ? { award: null, waitingOn: higherPending } : { award: best.id, waitingOn: [] };
}

/** At wave window close (or broadcast hold end): best acceptor wins, regardless of pending. */
export function awardAtClose(offers: WaveOffer[]): string | null {
  return bestAcceptor(offers)?.id ?? null;
}

/** All offers in the wave answered with no acceptor → send the next wave right away. */
export function waveAllDeclined(offers: WaveOffer[]): boolean {
  return offers.length > 0 && offers.every((o) => ["DECLINED", "EXPIRED", "INELIGIBLE", "WITHDRAWN"].includes(o.status));
}

/** Broadcast: the award happens at the earlier of (first accept + hold) and the window end. */
export function broadcastAwardAt(firstAcceptAt: Date | null, holdMinutes: number, windowEnd: Date): Date | null {
  if (!firstAcceptAt) return null;
  return new Date(Math.min(+firstAcceptAt + holdMinutes * MINUTE, +windowEnd));
}

// ---------------- On Call rules (§4) ----------------

export interface OnCallRuleFacts {
  active: boolean;
  pausedUntil: Date | null;
  professionCodes: string[];
  recurringWindows: { weekday: number; startMin: number; endMin: number }[];
  dateWindows: { startsAt: Date; endsAt: Date }[];
  timeZone: string;
  maxDriveMinutes: number;
  minPayHalfDayCents: number | null;
  minPayFullDayCents: number | null;
  minPayHourlyCents: number | null;
  minNoticeMinutes: number;
  maxPerDay: number;
  maxPerWeek: number;
  favoritesOnly: boolean;
  minClinicRating: number | null;
  excludedClinicIds: string[];
  allowOvernight: boolean;
}

export interface OnCallShiftFacts {
  professionCode: string;
  startsAt: Date;
  endsAt: Date;
  durationTier: "HALF_DAY" | "FULL_DAY" | "HOURLY";
  hours: number;
  /** Provider pay excluding mileage/lodging. */
  providerPayCents: number;
  clinicOrgId: string;
  lodgingAllowed: boolean;
}

export interface OnCallContext {
  now: Date;
  driveMinutes: number;
  clinicFavoritedByProvider: boolean;
  clinicRating: number | null;
  onCallShiftsSameDay: number;
  onCallShiftsSameWeek: number;
  /** Overnight means the drive exceeds the provider's normal max and lodging is needed. */
  needsOvernight: boolean;
}

/** Returns null when the rule matches, otherwise the first reason it doesn't. Never widens INV-1 — callers pass only eligible providers. */
export function onCallRuleMismatch(rule: OnCallRuleFacts, shift: OnCallShiftFacts, ctx: OnCallContext): string | null {
  if (!rule.active) return "rule inactive";
  if (rule.pausedUntil && rule.pausedUntil > ctx.now) return "paused";
  if (!rule.professionCodes.includes(shift.professionCode)) return "profession";
  const start = DateTime.fromJSDate(shift.startsAt, { zone: rule.timeZone });
  const end = DateTime.fromJSDate(shift.endsAt, { zone: rule.timeZone });
  const inRecurring = rule.recurringWindows.some((w) => {
    if (start.weekday % 7 !== w.weekday) return false;
    const dayStart = start.startOf("day");
    return +start >= +dayStart.plus({ minutes: w.startMin }) && +end <= +dayStart.plus({ minutes: w.endMin });
  });
  const inDates = rule.dateWindows.some((w) => +shift.startsAt >= +w.startsAt && +shift.endsAt <= +w.endsAt);
  if (!inRecurring && !inDates) return "time window";
  if (ctx.driveMinutes > rule.maxDriveMinutes && !(rule.allowOvernight && shift.lodgingAllowed)) return "drive";
  if (ctx.needsOvernight && !rule.allowOvernight) return "overnight";
  const min =
    shift.durationTier === "HOURLY"
      ? rule.minPayHourlyCents !== null
        ? rule.minPayHourlyCents * shift.hours
        : null
      : shift.durationTier === "HALF_DAY"
        ? rule.minPayHalfDayCents
        : rule.minPayFullDayCents;
  if (min !== null && shift.providerPayCents < min) return "pay";
  if (+shift.startsAt - +ctx.now < rule.minNoticeMinutes * MINUTE) return "notice";
  if (ctx.onCallShiftsSameDay >= rule.maxPerDay) return "daily limit";
  if (ctx.onCallShiftsSameWeek >= rule.maxPerWeek) return "weekly limit";
  if (rule.favoritesOnly && !ctx.clinicFavoritedByProvider) return "favorites only";
  if (rule.minClinicRating !== null && (ctx.clinicRating ?? 0) < rule.minClinicRating) return "clinic rating";
  if (rule.excludedClinicIds.includes(shift.clinicOrgId)) return "excluded clinic";
  return null;
}

/** Plain-language rule summary for the provider dashboard (§4.7). */
export function describeOnCallRule(rule: Pick<OnCallRuleFacts, "professionCodes" | "maxDriveMinutes" | "recurringWindows" | "minPayFullDayCents" | "minPayHalfDayCents" | "minPayHourlyCents" | "maxPerDay">, professionNames: Record<string, string>): string {
  const days = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];
  const t = (m: number) => DateTime.fromObject({ hour: Math.floor(m / 60) % 24, minute: m % 60 }).toFormat("h:mma").toLowerCase();
  const windows = [...new Set(rule.recurringWindows.map((w) => `${t(w.startMin)}–${t(w.endMin)}`))];
  const whichDays = rule.recurringWindows.map((w) => days[w.weekday]).join("/");
  const profs = rule.professionCodes.map((c) => professionNames[c]?.toLowerCase() ?? c).join(" and ");
  const pay = rule.minPayFullDayCents ? `, paying at least $${Math.round(rule.minPayFullDayCents / 100)}/day` : rule.minPayHourlyCents ? `, paying at least $${Math.round(rule.minPayHourlyCents / 100)}/hr` : "";
  return `You'll be auto-booked for ${profs} shifts within ${rule.maxDriveMinutes} min of home${whichDays ? `, ${whichDays} ${windows.join(", ")}` : ""}${pay}. Up to ${rule.maxPerDay} per day.`;
}

// ---------------- quiet hours (§8.5) ----------------

export function inQuietHours(now: Date, timeZone: string, startMin: number, endMin: number): boolean {
  const d = DateTime.fromJSDate(now, { zone: timeZone });
  const m = d.hour * 60 + d.minute;
  if (startMin === endMin) return false;
  return startMin < endMin ? m >= startMin && m < endMin : m >= startMin || m < endMin;
}

// ---------------- SMS replies (§8.3) ----------------

export type SmsReply = { kind: "YES" | "NO"; code: string | null } | { kind: "STOP" } | { kind: "START" } | { kind: "HELP" } | { kind: "UNKNOWN" };

export function parseSmsReply(text: string): SmsReply {
  const t = text.trim().toUpperCase().replace(/[.!]+$/, "");
  if (/^(STOP|STOPALL|UNSUBSCRIBE|CANCEL|END|QUIT)$/.test(t)) return { kind: "STOP" };
  if (/^(START|UNSTOP)$/.test(t)) return { kind: "START" };
  if (/^(HELP|INFO)$/.test(t)) return { kind: "HELP" };
  const m = t.match(/^(YES|Y|ACCEPT|NO|N|DECLINE)(?:\s+#?(\d{4}))?$/);
  if (!m) return { kind: "UNKNOWN" };
  return { kind: /^(YES|Y|ACCEPT)$/.test(m[1]) ? "YES" : "NO", code: m[2] ?? null };
}

/** 4-digit reply code unique among the provider's open offers. */
export function pickReplyCode(taken: Set<string>, rand: () => number = Math.random): string {
  for (let i = 0; i < 100; i++) {
    const c = String(1000 + Math.floor(rand() * 9000));
    if (!taken.has(c)) return c;
  }
  throw new Error("No reply codes available");
}
