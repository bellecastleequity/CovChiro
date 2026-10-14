import { DateTime } from "luxon";
import { z } from "zod";
import { DomainError, standingShiftFits, type StandingPattern } from "@cm/core";
import { prisma } from "@cm/db";
import { agreementCurrent } from "./agreements";
import { assertClinicPhones, clinicPhonesOk } from "./phones";
import { audit, clock, getSettings, requireClinic, type Actor } from "./context";
import { notifyClinic } from "./notify";
import { cancelShiftByClinic, createShift, inviteProviders, postShift, validateShiftInput } from "./shifts";
import { describePattern } from "./standing";

/**
 * Recurring open postings (owner, Oct 2026: staff a practice's afternoon blocks through the site).
 * A clinic sets a weekly pattern once; an hourly sweep posts each matching day
 * recurring.horizonWeeks ahead as an ordinary open shift (rate engine price, normal applications,
 * selection deadline, Smart Dispatch, INV-1 eligibility; the open-states posting gate applies and a
 * day with nobody available waits as a draft that posts itself). Unlike a standing booking it needs
 * no named provider: anyone eligible can take a day. With preferLastProvider, whoever covered the
 * series most recently gets a normal clinic invitation as soon as each day is posted
 * (rank-protected like every invitation). Days closer than recurring.minLeadHours are never posted
 * automatically (keeps them out of the rush window).
 */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
const ISO = /^\d{4}-\d{2}-\d{2}$/;
export const RecurringInput = z
  .object({
    locationId: z.string().min(1),
    professionCode: z.string().min(1),
    weekdays: z.array(z.coerce.number().int().min(1).max(7)).min(1, "Pick at least one day of the week."),
    startTime: z.string().regex(HHMM, "Use a start time like 13:00"),
    endTime: z.string().regex(HHMM, "Use an end time like 17:00"),
    lunchMinutes: z.coerce.number().int().min(0).max(120).default(0),
    lunchStartTime: z.string().regex(HHMM).nullable().optional(),
    expectedPatients: z.coerce.number().int().min(0).max(500).nullable().optional(),
    minYearsExperience: z.coerce.number().int().min(0).max(40).nullable().optional(),
    startsOn: z.string().regex(ISO, "Pick a start date"),
    endsOn: z.string().regex(ISO).nullable().optional(),
    notes: z.string().trim().max(2000).nullable().optional(),
    preferLastProvider: z.boolean().default(true),
  })
  .refine((v) => v.endTime > v.startTime, { message: "The end time must be after the start time.", path: ["endTime"] })
  .refine((v) => !v.endsOn || v.endsOn >= v.startsOn, { message: "The end date must be after the start date.", path: ["endsOn"] })
  .refine((v) => !v.lunchMinutes || (v.lunchStartTime && v.lunchStartTime > v.startTime && v.lunchStartTime < v.endTime), { message: "Pick a lunch start inside the shift hours.", path: ["lunchStartTime"] });
export type RecurringInputT = z.input<typeof RecurringInput>;
/** Editing keeps the location and profession. */
export type RecurringChangeT = Omit<RecurringInputT, "locationId" | "professionCode">;

type Row = Awaited<ReturnType<typeof prisma.recurringPosting.findUniqueOrThrow>>;

const dateOnly = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);
const patternOf = (r: { weekdays: number[]; startTime: string; endTime: string; endsOn: Date | null }): StandingPattern => ({ weekdays: [...r.weekdays].sort(), startTime: r.startTime, endTime: r.endTime, endsOn: r.endsOn ? isoOf(r.endsOn) : null });
/** The sweep acts as whoever set the posting up (like standing bookings). */
const clinicActorFor = (r: { createdById: string; clinicOrgId: string }): Actor => ({ userId: r.createdById, role: "CLINIC_OWNER", providerId: null, clinicOrgId: r.clinicOrgId });
const UNFILLED = ["DRAFT", "OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"] as const;

function day(dayIso: string, r: { startTime: string; endTime: string; lunchMinutes: number; lunchStartTime: string | null }, tz: string) {
  const at = (t: string) => DateTime.fromISO(`${dayIso}T${t}`, { zone: tz }).toJSDate();
  return { startsAt: at(r.startTime), endsAt: at(r.endTime), lunchStartsAt: r.lunchMinutes && r.lunchStartTime ? at(r.lunchStartTime) : null };
}

function nextMatchingDay(fromIso: string, weekdays: number[]) {
  let d = DateTime.fromISO(fromIso);
  for (let i = 0; i < 7 && !weekdays.includes(d.weekday); i++) d = d.plus({ days: 1 });
  return d.toISODate()!;
}

/** Same checks a normal posting gets (profession live in the state, hours, lunch), on the first matching day. */
async function checkPattern(orgId: string, loc: { id: string; timeZone: string }, professionCode: string, fromIso: string, r: { weekdays: number[]; startTime: string; endTime: string; lunchMinutes: number; lunchStartTime: string | null }) {
  // The first day the sweep would actually post (never inside the lead time).
  const lead = DateTime.fromJSDate(clock.now()).setZone(loc.timeZone).plus({ hours: (await getSettings())["recurring.minLeadHours"] }).plus({ days: 1 }).toISODate()!;
  const first = day(nextMatchingDay(fromIso > lead ? fromIso : lead, r.weekdays), r, loc.timeZone);
  try {
    await validateShiftInput(prisma, orgId, { locationId: loc.id, professionCode, startsAt: first.startsAt, endsAt: first.endsAt, requiredSkillIds: [], preferredSkillIds: [], instantBook: false, lodgingAllowed: false, lunchMinutes: r.lunchMinutes, lunchStartsAt: first.lunchStartsAt }, true);
  } catch (e) {
    if (e instanceof DomainError && /supervis/i.test(e.message)) throw new DomainError("VALIDATION", "This profession needs a supervision attestation for each shift here, so post these shifts individually for now.");
    throw e;
  }
}

export async function createRecurring(actor: Actor, raw: RecurringInputT) {
  const orgId = requireClinic(actor);
  await assertClinicPhones(orgId);
  const input = RecurringInput.parse(raw);
  const loc = await prisma.clinicLocation.findFirst({ where: { id: input.locationId, clinicOrgId: orgId, active: true } });
  if (!loc) throw new DomainError("NOT_FOUND", "Location not found");
  const today = DateTime.now().setZone(loc.timeZone).toISODate()!;
  if (input.startsOn < today) throw new DomainError("VALIDATION", "The start date can't be in the past.");
  const fields = {
    weekdays: [...new Set(input.weekdays)].sort(),
    startTime: input.startTime,
    endTime: input.endTime,
    lunchMinutes: input.lunchMinutes,
    lunchStartTime: input.lunchMinutes ? (input.lunchStartTime ?? null) : null,
  };
  await checkPattern(orgId, loc, input.professionCode, input.startsOn, fields);
  const r = await prisma.recurringPosting.create({
    data: {
      clinicOrgId: orgId,
      locationId: loc.id,
      professionCode: input.professionCode,
      ...fields,
      expectedPatients: input.expectedPatients ?? null,
      minYearsExperience: input.minYearsExperience ?? null,
      startsOn: dateOnly(input.startsOn),
      endsOn: input.endsOn ? dateOnly(input.endsOn) : null,
      notes: input.notes || null,
      preferLastProvider: input.preferLastProvider,
      createdById: actor.userId!,
    },
  });
  await audit(prisma, actor, "recurring.created", "RecurringPosting", r.id, null, { pattern: describePattern(r), locationId: loc.id });
  const run = await generateRecurring(r.id);
  return { id: r.id, ...run };
}

async function own(actor: Actor, id: string) {
  const orgId = requireClinic(actor);
  const r = await prisma.recurringPosting.findFirst({ where: { id, clinicOrgId: orgId } });
  if (!r) throw new DomainError("NOT_FOUND", "Recurring posting not found");
  return r;
}

/** Cancels the series' future days nobody has taken yet (no provider, so nothing to charge or pay). */
async function cancelUnfilled(r: Row, keep: (sh: { startsAt: Date; endsAt: Date }) => boolean, reason: string) {
  const shifts = await prisma.shift.findMany({ where: { recurringPostingId: r.id, startsAt: { gt: clock.now() }, status: { in: [...UNFILLED] } } });
  let cancelled = 0;
  for (const sh of shifts.filter((x) => !keep(x))) {
    if (sh.status === "DRAFT") await prisma.shift.update({ where: { id: sh.id }, data: { status: "CANCELLED", cancelledAt: clock.now(), cancelReason: reason } });
    else await cancelShiftByClinic(clinicActorFor(r), sh.id, reason);
    cancelled++;
  }
  return cancelled;
}

/** Edit the pattern. Future days nobody has taken that no longer fit are taken down; booked days always stay. */
export async function updateRecurring(actor: Actor, id: string, raw: RecurringChangeT) {
  const r = await own(actor, id);
  if (r.status === "ENDED") throw new DomainError("CONFLICT", "This recurring posting has ended.");
  const input = RecurringInput.parse({ ...raw, locationId: r.locationId, professionCode: r.professionCode, startsOn: raw.startsOn ?? isoOf(r.startsOn) });
  const loc = await prisma.clinicLocation.findUniqueOrThrow({ where: { id: r.locationId } });
  const today = DateTime.now().setZone(loc.timeZone).toISODate()!;
  if (input.endsOn && input.endsOn < today) throw new DomainError("VALIDATION", "The end date can't be in the past.");
  const fields = {
    weekdays: [...new Set(input.weekdays)].sort(),
    startTime: input.startTime,
    endTime: input.endTime,
    lunchMinutes: input.lunchMinutes,
    lunchStartTime: input.lunchMinutes ? (input.lunchStartTime ?? null) : null,
  };
  const startsOn = input.startsOn > today ? input.startsOn : today;
  await checkPattern(r.clinicOrgId, loc, r.professionCode, startsOn, fields);
  const updated = await prisma.recurringPosting.update({
    where: { id },
    data: { ...fields, startsOn: dateOnly(input.startsOn), endsOn: input.endsOn ? dateOnly(input.endsOn) : null, expectedPatients: input.expectedPatients ?? null, minYearsExperience: input.minYearsExperience ?? null, notes: input.notes || null, preferLastProvider: input.preferLastProvider, generatedThrough: null },
  });
  const p = patternOf(updated);
  const takenDown = await cancelUnfilled(updated, (sh) => sh.startsAt >= dateOnly(input.startsOn) && standingShiftFits(p, loc.timeZone, sh.startsAt, sh.endsAt), "Recurring posting changed");
  await audit(prisma, actor, "recurring.changed", "RecurringPosting", id, patternOf(r), p);
  const run = updated.status === "ACTIVE" ? await generateRecurring(id) : { posted: 0, waiting: 0, invited: 0 };
  return { takenDown, ...run };
}

export async function setRecurringPaused(actor: Actor, id: string, paused: boolean) {
  const r = await own(actor, id);
  if (r.status === "ENDED") throw new DomainError("CONFLICT", "This recurring posting has ended.");
  await prisma.recurringPosting.update({ where: { id }, data: { status: paused ? "PAUSED" : "ACTIVE", generatedThrough: null } });
  await audit(prisma, actor, paused ? "recurring.paused" : "recurring.resumed", "RecurringPosting", id);
  return paused ? { posted: 0, waiting: 0, invited: 0 } : generateRecurring(id);
}

/** Stop posting. Days nobody has taken yet are taken down when asked; booked days stay booked. */
export async function endRecurring(actor: Actor, id: string, takeDownOpen: boolean) {
  const r = await own(actor, id);
  if (r.status === "ENDED") return { takenDown: 0 };
  await prisma.recurringPosting.update({ where: { id }, data: { status: "ENDED", endedAt: clock.now() } });
  const takenDown = takeDownOpen ? await cancelUnfilled(r, () => false, "Recurring posting ended") : 0;
  await audit(prisma, actor, "recurring.ended", "RecurringPosting", id, null, { takenDown });
  return { takenDown };
}

/** Why the clinic can't post right now (the sweep stops and says so), or null. */
async function postingBlocked(orgId: string) {
  const org = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: orgId } });
  if (org.status === "SUSPENDED" || org.status === "DEACTIVATED") return "Your account is suspended, so new shifts can't be posted.";
  if (org.status !== "ACTIVE" || !org.hasPaymentMethod) return "Finish setup (payment method and agreement) so we can post these shifts.";
  if (!agreementCurrent("CLINIC", org.agreementSignedAt, org.agreementVersion)) return "Sign the current Clinic Platform Agreement in Settings so we can keep posting these shifts.";
  if (!clinicPhonesOk(org)) return "Add two phone numbers in Settings so we can keep posting these shifts.";
  const { openChargebackFor } = await import("./chargebacks");
  if (await openChargebackFor(orgId)) return "Posting is paused while a card dispute you opened with your bank is open.";
  return null;
}

/** Whoever covered this series most recently (worked first, else booked). */
async function lastProvider(id: string) {
  for (const status of [["COMPLETED"], ["CONFIRMED", "IN_PROGRESS"]] as const) {
    const a = await prisma.assignment.findFirst({ where: { status: { in: [...status] }, shift: { recurringPostingId: id } }, orderBy: { shift: { startsAt: "desc" } }, select: { providerId: true } });
    if (a) return a.providerId;
  }
  return null;
}

async function recordProblem(r: Row, message: string | null) {
  if ((r.lastError ?? null) === message) return;
  await prisma.recurringPosting.update({ where: { id: r.id }, data: { lastError: message, lastErrorAt: message ? clock.now() : null } });
  if (message) {
    await notifyClinic(prisma, r.clinicOrgId, { template: "recurring_paused", title: "We couldn't post your recurring shifts", body: `${describePattern(r)}: ${message} We'll try again every hour.`, link: "/clinic/recurring" });
  }
}

/** Posts every matching day up to the horizon that doesn't have a shift yet. Idempotent. */
export async function generateRecurring(id: string) {
  const out = { posted: 0, waiting: 0, invited: 0 };
  const r = await prisma.recurringPosting.findUnique({ where: { id } });
  if (!r || r.status !== "ACTIVE") return out;
  const blocked = await postingBlocked(r.clinicOrgId);
  if (blocked) {
    await recordProblem(r, blocked);
    return out;
  }
  const loc = await prisma.clinicLocation.findUniqueOrThrow({ where: { id: r.locationId } });
  const s = await getSettings();
  const now = DateTime.fromJSDate(clock.now()).setZone(loc.timeZone);
  const earliest = +clock.now() + s["recurring.minLeadHours"] * 3_600_000;
  let d = DateTime.max(now.startOf("day"), DateTime.fromISO(isoOf(r.startsOn), { zone: loc.timeZone }), r.generatedThrough ? DateTime.fromISO(isoOf(r.generatedThrough), { zone: loc.timeZone }).plus({ days: 1 }) : DateTime.fromMillis(0))!;
  let last = now.plus({ weeks: s["recurring.horizonWeeks"] }).startOf("day");
  if (r.endsOn) last = DateTime.min(last, DateTime.fromISO(isoOf(r.endsOn), { zone: loc.timeZone }))!;
  // One posted shift per local day: a day that already has one (any hours) is skipped.
  const existing = await prisma.shift.findMany({ where: { recurringPostingId: id, status: { not: "CANCELLED" }, startsAt: { gte: d.toJSDate() } }, select: { startsAt: true } });
  const have = new Set(existing.map((x) => DateTime.fromJSDate(x.startsAt, { zone: loc.timeZone }).toISODate()));
  const actor = clinicActorFor(r);
  const prefer = r.preferLastProvider ? await lastProvider(id) : null;
  let through = d.minus({ days: 1 });
  for (; d <= last; d = d.plus({ days: 1 })) {
    const iso = d.toISODate()!;
    const occ = day(iso, r, loc.timeZone);
    // Too close to post automatically: leave it for a later run only if it can still qualify (it can't), so just move on.
    if (+occ.startsAt < earliest) { through = d; continue; }
    if (!r.weekdays.includes(d.weekday) || have.has(iso)) { through = d; continue; }
    let shiftId: string;
    try {
      ({ shiftId } = await createShift(actor, { locationId: r.locationId, professionCode: r.professionCode, startsAt: occ.startsAt, endsAt: occ.endsAt, lunchMinutes: r.lunchMinutes, lunchStartsAt: occ.lunchStartsAt, expectedPatients: r.expectedPatients, minYearsExperience: r.minYearsExperience ?? undefined, notes: r.notes }, { post: false }));
    } catch (e) {
      await recordProblem(r, (e as Error).message);
      break;
    }
    await prisma.shift.update({ where: { id: shiftId }, data: { recurringPostingId: id } });
    try {
      await postShift(actor, shiftId);
    } catch (e) {
      if (e instanceof DomainError && e.code === "NO_PROVIDER_AVAILABLE") {
        // Saved as a waiting draft that posts itself once a provider can take it (open-states gate).
        out.waiting++;
        through = d;
        continue;
      }
      await prisma.shift.delete({ where: { id: shiftId } }).catch(() => undefined);
      await recordProblem(r, (e as Error).message);
      break;
    }
    out.posted++;
    through = d;
    if (prefer) {
      const ok = await inviteProviders(actor, shiftId, [prefer]).then(() => true, () => false);
      if (ok) out.invited++;
    }
  }
  if (+through >= +DateTime.fromISO(isoOf(r.startsOn), { zone: loc.timeZone })) {
    await prisma.recurringPosting.update({ where: { id }, data: { generatedThrough: dateOnly(through.toISODate()!) } });
  }
  if (through >= last) await recordProblem(r, null);
  return out;
}

/** Hourly: keep every active recurring posting posted out to the horizon. */
export async function recurringSweep() {
  const ids = await prisma.recurringPosting.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  let posted = 0;
  for (const { id } of ids) posted += (await generateRecurring(id).catch(() => ({ posted: 0 }))).posted;
  return posted;
}

export async function clinicRecurring(actor: Actor) {
  const orgId = requireClinic(actor);
  const rows = await prisma.recurringPosting.findMany({ where: { clinicOrgId: orgId }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] });
  const [locs, shifts] = await Promise.all([
    prisma.clinicLocation.findMany({ where: { id: { in: rows.map((r) => r.locationId) } }, select: { id: true, name: true, city: true, timeZone: true } }),
    prisma.shift.findMany({
      where: { recurringPostingId: { in: rows.map((r) => r.id) }, startsAt: { gte: clock.now() }, status: { not: "CANCELLED" } },
      orderBy: { startsAt: "asc" },
      select: { id: true, recurringPostingId: true, startsAt: true, status: true, waitingForProviderSince: true, assignments: { where: { status: { in: ["CONFIRMED", "IN_PROGRESS"] } }, select: { provider: { select: { displayName: true } } } } },
    }),
  ]);
  const l = new Map(locs.map((x) => [x.id, x]));
  const last = new Map<string, string | null>();
  for (const r of rows) {
    const pid = r.preferLastProvider ? await lastProvider(r.id) : null;
    last.set(r.id, pid ? (await prisma.provider.findUnique({ where: { id: pid }, select: { displayName: true } }))?.displayName ?? null : null);
  }
  return rows.map((r) => ({
    ...r,
    pattern: patternOf(r),
    location: l.get(r.locationId)!,
    lastProviderName: last.get(r.id) ?? null,
    upcoming: shifts.filter((x) => x.recurringPostingId === r.id).map((x) => ({ id: x.id, startsAt: x.startsAt, state: x.assignments.length ? ("BOOKED" as const) : x.status === "DRAFT" ? ("WAITING" as const) : ("OPEN" as const), providerName: x.assignments[0]?.provider.displayName ?? null })),
  }));
}
