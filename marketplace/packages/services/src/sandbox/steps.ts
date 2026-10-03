import { DateTime } from "luxon";
import { DomainError } from "@cm/core";
import { prisma } from "@cm/db";
import { createMultiDay, createForProviders, applyToAllDays, confirmForAllDays } from "../bookings";
import { getSettings, type Actor } from "../context";
import { setBlock, setFavorite } from "../favorites";
import { requestHire } from "../hiring";
import { autoCompleteDue, openDispute, recomputeStats, startDueShifts, submitRating } from "../lifecycle";
import { openThread, sendMessage } from "../messaging";
import { releaseDuePayouts } from "../payouts";
import { createPromo } from "../promo";
import { changeShift } from "../shiftChanges";
import { applyToShift, cancelAssignment, cancelShiftByClinic, createShift, inviteProviders, quoteForClinic, selectApplicant, type ShiftInputT } from "../shifts";
import { proposeStanding, respondStanding } from "../standing";
import { createRequest } from "../support";
import { punch } from "../timeclock";
import { approveAsClinic } from "../timeclock";
import { confirmVisitsAsClinic, reportVisitsAsClinic, submitVisits, volumeSweep } from "../volume";
import { configure, createCast, loadCast, wipe, type Cast, type CastClinic, type CastProvider } from "./cast";
import { APPLY_NOTES, CLINIC_REVIEWS, PROVIDER_REVIEWS, SHIFT_NOTES } from "./data";
import { atTime, realNow, restamp, travel } from "./time";

export const ZONE = "America/New_York";
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

/** Shift options a step can ask for. */
export interface Extras {
  instantBook?: boolean;
  lodging?: boolean;
  minYears?: number;
  required?: string[];
  preferred?: string[];
  promo?: string;
  notes?: string;
}

/** One unit of demo-building work. Days are offsets from today (Eastern), hours are local clock hours. */
export type Spec =
  | { k: "wipe" }
  | { k: "config" }
  | { k: "cast" }
  | { k: "promo"; code: string }
  | { k: "history"; c: string; p: string; day: number; start: number; end: number; patients: number; visits: number; outcome: "paid" | "signoff" | "countDispute" | "dispute"; loc?: number }
  | { k: "open"; c: string; day: number; start: number; end: number; patients: number | null; applicants?: string[]; invite?: string[]; x?: Extras; loc?: number }
  | { k: "booked"; c: string; p: string; day: number; start: number; end: number; patients: number | null; via: "apply" | "invite"; x?: Extras; loc?: number; message?: boolean }
  | { k: "multiday"; c: string; days: number[]; start: number; end: number; p?: string }
  | { k: "multiProvider"; c: string; day: number; start: number; end: number; n: number; confirm: string[] }
  | { k: "standing"; c: string; p: string; weekday: number; startsInDays: number; accept: boolean }
  | { k: "clinicRate"; c: string; day: number; start: number; end: number; pct: number; release: boolean; applicants?: string[] }
  | { k: "draft"; c: string; day: number; start: number; end: number }
  | { k: "cancelled"; c: string; day: number; start: number; end: number; p?: string }
  | { k: "change"; c: string; p: string; day: number; start: number; end: number; newStart: number; newEnd: number }
  | { k: "emergency"; c: string; p: string }
  /** p "auto" = the provider who has worked there most (a favorite needs a completed shift together). */
  | { k: "hire"; c: string; p: string }
  | { k: "favorite"; c: string; p: string; block?: boolean; rank?: number }
  | { k: "support"; who: string; side: "clinic" | "provider"; subject: string; body: string }
  /** Plan the forward shifts from what exists at that point (the runner expands it). */
  | { k: "topup" }
  | { k: "finish" };

export const SPEC_LABEL: Record<Spec["k"], string> = {
  wipe: "Clearing old demo data",
  config: "Test-site settings",
  cast: "Creating clinics and providers",
  promo: "Promo code",
  history: "Past shift (worked and paid)",
  open: "Open shift",
  booked: "Booked shift",
  multiday: "Multi-day booking",
  multiProvider: "Several providers, same day",
  standing: "Standing booking",
  clinicRate: "Clinic-set rate shift",
  draft: "Draft shift",
  cancelled: "Cancelled shift",
  change: "Shift change waiting for the provider",
  emergency: "Emergency cover",
  hire: "Direct-hire request",
  favorite: "Favorite / block",
  support: "Support request",
  topup: "Planning the next 37 days",
  finish: "Finishing up",
};

const pick = <T,>(xs: readonly T[], n: number) => xs[Math.abs(n) % xs.length];

/** Midnight Eastern, `offset` days from today. */
export const etDay = (offset: number, now = realNow()) => DateTime.fromMillis(now, { zone: ZONE }).startOf("day").plus({ days: offset });
const at = (d: DateTime, hour: number) => d.set({ hour: Math.floor(hour), minute: Math.round((hour % 1) * 60) }).toJSDate();

function clinicOf(cast: Cast, key: string): CastClinic {
  const c = cast.clinics.get(key);
  if (!c) throw new DomainError("NOT_FOUND", `Demo clinic ${key} is missing`);
  return c;
}
function providerOf(cast: Cast, key: string): CastProvider {
  const p = cast.providers.get(key);
  if (!p) throw new DomainError("NOT_FOUND", `Demo provider ${key} is missing`);
  return p;
}

function input(c: CastClinic, loc: number | undefined, startsAt: Date, endsAt: Date, patients: number | null, x: Extras = {}, seed = 0): ShiftInputT {
  return {
    locationId: c.locationIds[(loc ?? 0) % c.locationIds.length],
    professionCode: "DC",
    startsAt,
    endsAt,
    expectedPatients: patients,
    notes: x.notes ?? pick(SHIFT_NOTES, seed),
    instantBook: x.instantBook ?? false,
    lodgingAllowed: x.lodging ?? false,
    ...(x.minYears !== undefined ? { minYearsExperience: x.minYears } : {}),
    ...(x.promo ? { promoCode: x.promo } : {}),
  };
}

async function withSkills(i: ShiftInputT, x: Extras = {}) {
  if (!x.required?.length && !x.preferred?.length) return i;
  const skills = await prisma.skill.findMany({ where: { professionCode: "DC", name: { in: [...(x.required ?? []), ...(x.preferred ?? [])] } } });
  return {
    ...i,
    requiredSkillIds: skills.filter((s) => x.required?.includes(s.name)).map((s) => s.id),
    preferredSkillIds: skills.filter((s) => x.preferred?.includes(s.name)).map((s) => s.id),
  };
}

const liveAssignment = (shiftId: string) => prisma.assignment.findFirstOrThrow({ where: { shiftId, status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] } } });

/** Book a provider: they apply (or are invited and accept), the clinic confirms. */
async function book(c: CastClinic, p: CastProvider, shiftId: string, via: "apply" | "invite", seed: number) {
  if (via === "invite") {
    const { offerIds } = await inviteProviders(c.actor, shiftId, [p.id]);
    const { respondToOffer } = await import("../shifts");
    await respondToOffer(p.actor, offerIds[0], true);
    // Accepted invitations settle once no higher-ranked invitee is still open.
    const { settleInvites } = await import("../shifts");
    await settleInvites(shiftId);
    if (!(await prisma.assignment.findFirst({ where: { shiftId, providerId: p.id, status: "CONFIRMED" } }))) await selectApplicant(c.actor, shiftId, p.id);
  } else {
    await applyToShift(p.actor, shiftId, { commit: true, note: pick(APPLY_NOTES, seed) });
    // Instant book / On Call can confirm on applying; otherwise the clinic picks them.
    if (!(await prisma.assignment.findFirst({ where: { shiftId, providerId: p.id, status: "CONFIRMED" } }))) await selectApplicant(c.actor, shiftId, p.id);
  }
}

/** A shift worked "back then": booked a week ahead, clocked, counted, signed off, completed, rated and paid. */
async function history(cast: Cast, s: Extract<Spec, { k: "history" }>, seed: number) {
  const c = clinicOf(cast, s.c);
  const p = providerOf(cast, s.p);
  const d = etDay(s.day);
  const start = at(d, s.start);
  const end = at(d, s.end);
  const loc = await prisma.clinicLocation.findUniqueOrThrow({ where: { id: c.locationIds[(s.loc ?? 0) % c.locationIds.length] } });
  const bookedAt = +start - (6 + (seed % 5)) * DAY + 9 * HOUR;
  /** Run one action at a moment, then date the rows it made to that moment. */
  const step = async (when: number, fn: () => Promise<unknown>) => {
    travel(when);
    const mark = realNow();
    await fn();
    await restamp(mark, new Date(when));
  };
  await atTime(bookedAt, async () => {
    let shiftId = "";
    await step(bookedAt, async () => {
      shiftId = (await createShift(c.actor, input(c, s.loc, start, end, s.patients, {}, seed), { post: true })).shiftId;
    });
    await step(bookedAt + 2 * HOUR + (seed % 7) * 11 * MIN, () => applyToShift(p.actor, shiftId, { commit: true, note: pick(APPLY_NOTES, seed) }));
    await step(bookedAt + 5 * HOUR, () => selectApplicant(c.actor, shiftId, p.id));
    const a = await liveAssignment(shiftId);
    const jitter = (seed % 9) - 4;
    await step(+start - (10 - jitter) * MIN, () => punch(p.actor, a.id, "IN", { lat: loc.lat + 0.0002, lng: loc.lng - 0.0001, accuracyM: 12 }));
    await step(+start + MIN, () => startDueShifts(new Date()));
    const mid = +start + (+end - +start) / 2;
    await step(mid - 15 * MIN, () => punch(p.actor, a.id, "BREAK_START"));
    await step(mid + 15 * MIN, () => punch(p.actor, a.id, "BREAK_END"));
    await step(+end + (3 + (seed % 6)) * MIN, () => punch(p.actor, a.id, "OUT"));
    await step(+end + 12 * MIN, () => submitVisits(p.actor, a.id, s.visits));
    if (s.outcome === "signoff") return;
    await step(+end + 55 * MIN, () => approveAsClinic(c.actor, a.id, { approverName: c.ownerName, approverTitle: "Owner" }));
    if (s.outcome === "countDispute") {
      await step(+end + 65 * MIN, () => reportVisitsAsClinic(c.actor, a.id, Math.max(0, s.visits - 7), "Our schedule shows fewer visits that day."));
    } else {
      await step(+end + 65 * MIN, () => confirmVisitsAsClinic(c.actor, a.id));
    }
    await step(+end + 3 * HOUR, async () => {
      await autoCompleteDue(new Date());
      await volumeSweep(new Date());
    });
    if (s.outcome === "dispute") await step(+end + 20 * HOUR, () => openDispute(c.actor, a.id, "The provider left about 45 minutes early and two patients were rescheduled."));
    await step(+end + 26 * HOUR, async () => {
      await submitRating(c.actor, a.id, { stars: s.outcome === "dispute" ? 3 : 4 + (seed % 2), categories: {}, comment: pick(CLINIC_REVIEWS, seed) }).catch(() => undefined);
      await submitRating(p.actor, a.id, { stars: 4 + ((seed + 1) % 2), categories: {}, comment: pick(PROVIDER_REVIEWS, seed) }).catch(() => undefined);
    });
    await step(+end + 3 * DAY + 2 * HOUR, () => releaseDuePayouts(new Date()));
  });
}

async function clinicRateShift(cast: Cast, s: Extract<Spec, { k: "clinicRate" }>, seed: number) {
  const c = clinicOf(cast, s.c);
  const d = etDay(s.day);
  const base = input(c, 0, at(d, s.start), at(d, s.end), 24, {}, seed);
  const q = await quoteForClinic(c.actor, base);
  const r = (q as { clinicRate?: { available: boolean; unavailableReason: string | null; marketCents: number; floorCents: number; releaseHours: number; releaseAt: string | null } }).clinicRate;
  if (!r?.available) throw new DomainError("CONFLICT", `Clinic-set rate isn't available: ${r?.unavailableReason ?? "no quote"}`);
  let price = Math.round((r.marketCents * s.pct) / 100 / 100) * 100;
  price = Math.min(Math.max(price, r.floorCents), r.marketCents - 100);
  const { shiftId } = await createShift(c.actor, { ...base, clinicRate: { priceCents: price, release: s.release, releaseAt: r.releaseAt, releaseHours: r.releaseHours, accepted: true } }, { post: true });
  for (const [i, key] of (s.applicants ?? []).entries()) await applyToShift(providerOf(cast, key).actor, shiftId, { commit: true, note: pick(APPLY_NOTES, seed + i) });
}

/** Execute one step. Throws on failure (the runner records it and moves on). */
export async function runSpec(s: Spec, seed: number, admin: Actor): Promise<string | void> {
  switch (s.k) {
    case "wipe":
      return `${await wipe()} tables cleared`;
    case "config":
      return configure();
    case "cast":
      return createCast(admin);
    case "finish":
      return finish();
    case "topup":
      return;
    default:
      break;
  }
  const cast = await loadCast();
  switch (s.k) {
    case "promo": {
      const exists = await prisma.promoCode.findFirst({ where: { code: s.code } });
      if (!exists) await createPromo(admin, { code: s.code, kind: "PERCENT", value: 20, description: "Demo: 20% off a clinic's first shift", maxUsesPerClinic: 1, firstShiftOnly: false });
      return;
    }
    case "history":
      return history(cast, s, seed);
    case "open": {
      const c = clinicOf(cast, s.c);
      const d = etDay(s.day);
      const { shiftId } = await createShift(c.actor, await withSkills(input(c, s.loc, at(d, s.start), at(d, s.end), s.patients, s.x, seed), s.x), { post: true });
      for (const [i, key] of (s.applicants ?? []).entries()) {
        await applyToShift(providerOf(cast, key).actor, shiftId, { commit: true, note: pick(APPLY_NOTES, seed + i) }).catch(() => undefined);
      }
      if (s.invite?.length) await inviteProviders(c.actor, shiftId, s.invite.map((k) => providerOf(cast, k).id));
      return;
    }
    case "booked": {
      const c = clinicOf(cast, s.c);
      const p = providerOf(cast, s.p);
      const d = etDay(s.day);
      const { shiftId } = await createShift(c.actor, await withSkills(input(c, s.loc, at(d, s.start), at(d, s.end), s.patients, s.x, seed), s.x), { post: true });
      await book(c, p, shiftId, s.via, seed);
      if (s.message) {
        const t = await openThread(c.actor, { shiftId, providerId: p.id });
        await sendMessage(c.actor, t.id, `Thanks for taking this one! You'll have room 2, and we're expecting about ${s.patients ?? 25} visits.`);
        await sendMessage(p.actor, t.id, "Sounds great. I'll be there 15 minutes early.");
      }
      return;
    }
    case "multiday": {
      const c = clinicOf(cast, s.c);
      const { shiftIds } = await createMultiDay(c.actor, s.days.map((o) => input(c, 0, at(etDay(o), s.start), at(etDay(o), s.end), 26, { notes: "Doctor away for a conference: cover all days if you can." }, seed)), { post: true });
      if (s.p) {
        const p = providerOf(cast, s.p);
        await applyToAllDays(p.actor, shiftIds[0], { commit: true, note: "I can cover every day." });
        await confirmForAllDays(c.actor, shiftIds[0], p.id);
      }
      return;
    }
    case "multiProvider": {
      const c = clinicOf(cast, s.c);
      const d = etDay(s.day);
      const { shiftIds } = await createForProviders(c.actor, [input(c, 0, at(d, s.start), at(d, s.end), 30, { notes: "Grand-opening event: we need two doctors." }, seed)], s.n, { post: true });
      for (const [i, key] of s.confirm.entries()) if (shiftIds[i]) await book(c, providerOf(cast, key), shiftIds[i], "apply", seed + i);
      return;
    }
    case "standing": {
      const c = clinicOf(cast, s.c);
      const p = providerOf(cast, s.p);
      await proposeStanding(c.actor, { providerId: p.id, locationId: c.locationIds[0], professionCode: "DC", weekdays: [s.weekday], startTime: "08:00", endTime: "17:00", startsOn: etDay(s.startsInDays).toISODate()!, endsOn: null, notes: "Every week while our associate is on reduced hours." });
      const b = await prisma.standingBooking.findFirstOrThrow({ where: { clinicOrgId: c.orgId, providerId: p.id, status: "PROPOSED" }, orderBy: { createdAt: "desc" } });
      if (s.accept) await respondStanding(p.actor, b.id, true);
      return;
    }
    case "clinicRate":
      return clinicRateShift(cast, s, seed);
    case "draft": {
      const c = clinicOf(cast, s.c);
      const d = etDay(s.day);
      await createShift(c.actor, input(c, 0, at(d, s.start), at(d, s.end), 20, { notes: "Draft: still checking the date with our doctor." }, seed), { post: false });
      return;
    }
    case "cancelled": {
      const c = clinicOf(cast, s.c);
      const d = etDay(s.day);
      const { shiftId } = await createShift(c.actor, input(c, 0, at(d, s.start), at(d, s.end), 22, {}, seed), { post: true });
      if (s.p) await book(c, providerOf(cast, s.p), shiftId, "apply", seed);
      await cancelShiftByClinic(c.actor, shiftId, "Our doctor's trip was postponed, so we don't need coverage after all.");
      return;
    }
    case "change": {
      const c = clinicOf(cast, s.c);
      const p = providerOf(cast, s.p);
      const d = etDay(s.day);
      const { shiftId } = await createShift(c.actor, input(c, 0, at(d, s.start), at(d, s.end), 24, {}, seed), { post: true });
      await book(c, p, shiftId, "apply", seed);
      await changeShift(c.actor, shiftId, { startsAt: at(d, s.newStart), endsAt: at(d, s.newEnd), message: "Our morning team meeting moved; could you start later?" });
      return;
    }
    case "emergency": {
      const c = clinicOf(cast, s.c);
      const p = providerOf(cast, s.p);
      // Inside the late-cancel window: tomorrow 8 AM (less than 24 h away once it's past 8 AM), else later today.
      const now = DateTime.fromMillis(realNow(), { zone: ZONE });
      const start = now.hour >= 8 ? now.startOf("day").plus({ days: 1, hours: 8 }) : DateTime.max(now.startOf("day").plus({ hours: 8 }), now.plus({ hours: 2 }).startOf("hour"));
      const { shiftId } = await createShift(c.actor, input(c, 0, start.toJSDate(), start.plus({ hours: 8 }).toJSDate(), 28, { notes: "Doctor out sick." }, seed), { post: true });
      await book(c, p, shiftId, "apply", seed);
      const a = await liveAssignment(shiftId);
      await cancelAssignment(p.actor, a.id, "Family emergency, so sorry.", { by: "PROVIDER" });
      return;
    }
    case "hire": {
      const c = clinicOf(cast, s.c);
      await requestHire(c.actor, { providerId: s.p === "auto" ? await regular(c, 0, cast) : providerOf(cast, s.p).id, positionType: "PART_TIME", message: "We'd love to bring them on two days a week.", callbackPhone: "+14075550199", callbackTimes: "Weekdays after 2 PM" });
      return;
    }
    case "favorite": {
      const c = clinicOf(cast, s.c);
      const id = s.p === "auto" ? await regular(c, s.rank ?? 0, cast) : providerOf(cast, s.p).id;
      if (s.block) await setBlock(c.actor, id, true, "Demo: ran late twice");
      else await setFavorite(c.actor, id, true);
      return;
    }
    case "support": {
      const actor = s.side === "clinic" ? clinicOf(cast, s.who).actor : providerOf(cast, s.who).actor;
      const topics = (await getSettings())["support.topics"];
      await createRequest(actor, { topic: topics[0], subject: s.subject, body: s.body });
      return;
    }
  }
}

/** The bot provider with the most completed shifts at this clinic (rank 0 = most). */
async function regular(c: CastClinic, rank: number, cast: Cast) {
  const bots = new Set([...cast.providers.values()].filter((p) => !p.yours).map((p) => p.id));
  const rows = await prisma.assignment.groupBy({ by: ["providerId"], where: { status: "COMPLETED", shift: { location: { clinicOrgId: c.orgId } } }, _count: { _all: true } });
  const ranked = rows.filter((r) => bots.has(r.providerId)).sort((a, b) => b._count._all - a._count._all);
  const hit = ranked[rank] ?? ranked[0];
  if (!hit) throw new DomainError("NOT_FOUND", "No provider has worked there yet");
  return hit.providerId;
}

/** Outbox from the build is noise: clear it; old notifications read; stats fresh; stamp the build. */
async function finish() {
  await prisma.sandboxMessage.deleteMany({});
  await prisma.notification.updateMany({ where: { createdAt: { lt: new Date(realNow() - 36 * HOUR) }, readAt: null }, data: { readAt: new Date() } });
  for (const p of await prisma.provider.findMany({ select: { id: true } })) await recomputeStats(p.id).catch(() => undefined);
  const now = new Date();
  await prisma.setting.upsert({ where: { key: "sandbox.builtAt" }, create: { key: "sandbox.builtAt", value: now.toISOString(), updatedAt: now }, update: { value: now.toISOString(), updatedAt: now } });
}
