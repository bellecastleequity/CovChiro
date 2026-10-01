import { DateTime } from "luxon";
import { z } from "zod";
import { DomainError } from "@cm/core";
import { prisma } from "@cm/db";
import { agreementCurrent } from "./agreements";
import { confirmProvider } from "./confirm";
import { audit, clock, getSettings, requireClinic, requireProvider, type Actor } from "./context";
import { notify, notifyClinic } from "./notify";
import { cancelAssignment, cancelShiftByClinic, createShift, postShift, validateShiftInput } from "./shifts";

/**
 * Standing bookings: the way a clinic and a provider work together on an
 * ongoing basis — through the platform, never around it. The clinic proposes
 * a weekly pattern to a provider it has worked with; once the provider
 * accepts, a sweep books each occurrence a few weeks ahead as an ordinary
 * shift (rate-engine price, deposit, INV-1 eligibility, normal cancellation).
 * If the provider can't take a given day (license, conflict…), that day is
 * posted normally so the clinic still gets cover.
 */

const HHMM = /^([01]\d|2[0-3]):[0-5]\d$/;
export const StandingInput = z
  .object({
    providerId: z.string().min(1),
    locationId: z.string().min(1),
    professionCode: z.string().min(1),
    weekdays: z.array(z.coerce.number().int().min(1).max(7)).min(1, "Pick at least one day of the week."),
    startTime: z.string().regex(HHMM, "Use a start time like 09:00"),
    endTime: z.string().regex(HHMM, "Use an end time like 17:00"),
    startsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Pick a start date"),
    endsOn: z.string().regex(/^\d{4}-\d{2}-\d{2}$/).nullable().optional(),
    notes: z.string().trim().max(1000).nullable().optional(),
  })
  .refine((v) => v.endTime > v.startTime, { message: "The end time must be after the start time.", path: ["endTime"] })
  .refine((v) => !v.endsOn || v.endsOn >= v.startsOn, { message: "The end date must be after the start date.", path: ["endsOn"] });
export type StandingInputT = z.input<typeof StandingInput>;

const DAY = ["", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat", "Sun"];
export const describePattern = (b: { weekdays: number[]; startTime: string; endTime: string }) =>
  `${[...b.weekdays].sort().map((d) => DAY[d]).join(", ")} · ${fmtTime(b.startTime)}–${fmtTime(b.endTime)}`;
const fmtTime = (t: string) => DateTime.fromFormat(t, "HH:mm").toFormat("h:mm a");
const dateOnly = (iso: string) => new Date(`${iso}T00:00:00Z`);
const isoOf = (d: Date) => d.toISOString().slice(0, 10);

function occurrence(dayIso: string, startTime: string, endTime: string, tz: string) {
  const startsAt = DateTime.fromISO(`${dayIso}T${startTime}`, { zone: tz });
  const endsAt = DateTime.fromISO(`${dayIso}T${endTime}`, { zone: tz });
  return { startsAt: startsAt.toJSDate(), endsAt: endsAt.toJSDate() };
}

/** The clinic acting, for the sweep: whoever proposed the standing booking. */
const clinicActorFor = (b: { createdById: string; clinicOrgId: string }): Actor => ({ userId: b.createdById, role: "CLINIC_OWNER", providerId: null, clinicOrgId: b.clinicOrgId });

export async function proposeStanding(actor: Actor, raw: StandingInputT) {
  const orgId = requireClinic(actor);
  const input = StandingInput.parse(raw);
  const loc = await prisma.clinicLocation.findFirst({ where: { id: input.locationId, clinicOrgId: orgId, active: true } });
  if (!loc) throw new DomainError("NOT_FOUND", "Location not found");
  const provider = await prisma.provider.findUnique({ where: { id: input.providerId } });
  if (!provider) throw new DomainError("NOT_FOUND", "Provider not found");
  const worked = await prisma.assignment.count({ where: { providerId: provider.id, status: "COMPLETED", shift: { location: { clinicOrgId: orgId } } } });
  if (!worked) throw new DomainError("FORBIDDEN", "You can set up a standing booking with a provider after completing a shift together.");
  const blocked = await prisma.block.count({ where: { fromType: "CLINIC", fromId: orgId, toType: "PROVIDER", toId: provider.id } });
  if (blocked) throw new DomainError("FORBIDDEN", "Unblock this provider first.");
  const today = DateTime.now().setZone(loc.timeZone).toISODate()!;
  if (input.startsOn < today) throw new DomainError("VALIDATION", "The start date can't be in the past.");
  // Same checks a normal posting gets (profession enabled in the state, supervision…), on the first day.
  const firstDay = nextMatchingDay(input.startsOn, input.weekdays);
  const first = occurrence(firstDay, input.startTime, input.endTime, loc.timeZone);
  try {
    await validateShiftInput(prisma, orgId, { locationId: loc.id, professionCode: input.professionCode, startsAt: first.startsAt, endsAt: first.endsAt, requiredSkillIds: [], preferredSkillIds: [], instantBook: false, lodgingAllowed: false }, true);
  } catch (e) {
    if (e instanceof DomainError && /supervis/i.test(e.message)) throw new DomainError("VALIDATION", "This profession needs a supervision attestation for each shift here, so post these shifts individually for now.");
    throw e;
  }
  const open = await prisma.standingBooking.count({ where: { clinicOrgId: orgId, providerId: provider.id, locationId: loc.id, status: { in: ["PROPOSED", "ACTIVE"] } } });
  if (open) throw new DomainError("CONFLICT", "You already have a standing booking (or proposal) with this provider at this location.");
  const b = await prisma.standingBooking.create({
    data: {
      clinicOrgId: orgId,
      locationId: loc.id,
      providerId: provider.id,
      professionCode: input.professionCode,
      weekdays: [...new Set(input.weekdays)].sort(),
      startTime: input.startTime,
      endTime: input.endTime,
      startsOn: dateOnly(input.startsOn),
      endsOn: input.endsOn ? dateOnly(input.endsOn) : null,
      notes: input.notes ?? null,
      createdById: actor.userId!,
    },
  });
  const org = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: orgId } });
  await notify(prisma, provider.userId, {
    template: "standing_proposed",
    title: `${org.displayName} would like you on a standing booking`,
    body: `${describePattern(b)} at ${loc.name}, ${loc.city}, starting ${DateTime.fromISO(input.startsOn).toFormat("MMM d")}${input.endsOn ? ` until ${DateTime.fromISO(input.endsOn).toFormat("MMM d")}` : ""}. Each shift is booked and paid through the platform at the usual rate.`,
    link: "/provider/standing",
    ctaLabel: "Review",
  });
  await audit(prisma, actor, "standing.proposed", "StandingBooking", b.id, null, { providerId: provider.id });
  return b;
}

function nextMatchingDay(fromIso: string, weekdays: number[]) {
  let d = DateTime.fromISO(fromIso);
  for (let i = 0; i < 7 && !weekdays.includes(d.weekday); i++) d = d.plus({ days: 1 });
  return d.toISODate()!;
}

export async function respondStanding(actor: Actor, id: string, accept: boolean) {
  const providerId = requireProvider(actor);
  const b = await prisma.standingBooking.findFirst({ where: { id, providerId, status: "PROPOSED" } });
  if (!b) throw new DomainError("NOT_FOUND", "Standing booking not found");
  await prisma.standingBooking.update({ where: { id }, data: { status: accept ? "ACTIVE" : "DECLINED", respondedAt: clock.now() } });
  const provider = await prisma.provider.findUniqueOrThrow({ where: { id: providerId } });
  await notifyClinic(prisma, b.clinicOrgId, {
    template: accept ? "standing_accepted" : "standing_declined",
    title: accept ? `${provider.displayName} accepted your standing booking` : `${provider.displayName} declined your standing booking`,
    body: accept ? `${describePattern(b)}. We'll book each shift ${(await getSettings())["standing.horizonWeeks"]} weeks ahead and let you know if any day needs other cover.` : "You can still book them shift by shift.",
    link: "/clinic/standing",
  });
  await audit(prisma, actor, accept ? "standing.accepted" : "standing.declined", "StandingBooking", id);
  if (accept) await generateStanding(id);
}

/** Clinic withdraws a proposal, or either side ends an active standing booking with notice. */
export async function endStanding(actor: Actor, id: string, reason: string) {
  const isProvider = actor.role === "PROVIDER";
  const b = await prisma.standingBooking.findUnique({ where: { id }, include: { shifts: { where: { status: { notIn: ["CANCELLED", "COMPLETED", "UNFILLED"] } }, include: { assignments: { where: { status: { in: ["CONFIRMED"] } } } } } } });
  if (!b || (isProvider ? b.providerId !== requireProvider(actor) : b.clinicOrgId !== requireClinic(actor))) throw new DomainError("NOT_FOUND", "Standing booking not found");
  if (b.status === "PROPOSED" && !isProvider) {
    await prisma.standingBooking.update({ where: { id }, data: { status: "WITHDRAWN", endedAt: clock.now(), endedByType: "CLINIC" } });
    return { cancelled: 0 };
  }
  if (b.status !== "ACTIVE") throw new DomainError("CONFLICT", "This standing booking isn't active.");
  const s = await getSettings();
  const cutoff = new Date(+clock.now() + s["standing.endNoticeDays"] * 86_400_000);
  await prisma.standingBooking.update({ where: { id }, data: { status: "ENDED", endedAt: clock.now(), endedByType: isProvider ? "PROVIDER" : "CLINIC", endedReason: reason.slice(0, 500), endsOn: dateOnly(isoOf(cutoff)) } });
  // Shifts inside the notice period stay booked; later ones are released at no charge to either side.
  let cancelled = 0;
  for (const sh of b.shifts.filter((x) => x.startsAt > cutoff)) {
    const a = sh.assignments[0];
    if (isProvider && a) await cancelAssignment(actor, a.id, "Standing booking ended", { by: "PROVIDER", quiet: true });
    else await cancelShiftByClinic(isProvider ? clinicActorFor(b) : actor, sh.id, "Standing booking ended");
    cancelled++;
  }
  const provider = await prisma.provider.findUniqueOrThrow({ where: { id: b.providerId } });
  const org = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: b.clinicOrgId } });
  const kept = `Shifts through ${cutoff.toLocaleDateString("en-US", { month: "short", day: "numeric" })} stay booked.`;
  if (isProvider) await notifyClinic(prisma, b.clinicOrgId, { template: "standing_ended", title: `${provider.displayName} ended your standing booking`, body: `${describePattern(b)}. ${kept}${reason ? ` Reason: ${reason}` : ""}`, link: "/clinic/standing" });
  else await notify(prisma, provider.userId, { template: "standing_ended", title: `${org.displayName} ended your standing booking`, body: `${describePattern(b)}. ${kept}`, link: "/provider/standing" });
  await audit(prisma, actor, "standing.ended", "StandingBooking", id, null, { cancelled });
  return { cancelled };
}

/** Books every occurrence up to the horizon that doesn't have a shift yet. Idempotent. */
export async function generateStanding(id: string) {
  const b = await prisma.standingBooking.findUnique({ where: { id }, include: { shifts: { select: { startsAt: true } } } });
  if (!b || b.status !== "ACTIVE") return 0;
  const loc = await prisma.clinicLocation.findUniqueOrThrow({ where: { id: b.locationId } });
  // Booking a standing day is posting a shift: the clinic needs the current agreement (the provider's is checked by eligibility).
  const org = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: b.clinicOrgId } });
  if (!agreementCurrent("CLINIC", org.agreementSignedAt, org.agreementVersion)) return 0;
  const s = await getSettings();
  const now = DateTime.fromJSDate(clock.now()).setZone(loc.timeZone);
  // Never book inside the next 24 hours: that's what normal posting / emergency cover is for.
  let day = DateTime.max(now.plus({ days: 1 }).startOf("day"), DateTime.fromISO(isoOf(b.startsOn), { zone: loc.timeZone }), b.generatedThrough ? DateTime.fromISO(isoOf(b.generatedThrough), { zone: loc.timeZone }).plus({ days: 1 }) : DateTime.fromMillis(0))!;
  let last = now.plus({ weeks: s["standing.horizonWeeks"] }).startOf("day");
  if (b.endsOn) last = DateTime.min(last, DateTime.fromISO(isoOf(b.endsOn), { zone: loc.timeZone }))!;
  const have = new Set(b.shifts.map((x) => +x.startsAt));
  const actor = clinicActorFor(b);
  let made = 0;
  for (; day <= last; day = day.plus({ days: 1 })) {
    if (!b.weekdays.includes(day.weekday)) continue;
    const occ = occurrence(day.toISODate()!, b.startTime, b.endTime, loc.timeZone);
    if (have.has(+occ.startsAt) || +occ.startsAt - +clock.now() < 24 * 3_600_000) continue;
    await bookOccurrence(b, actor, occ).catch(() => undefined);
    made++;
  }
  await prisma.standingBooking.update({ where: { id }, data: { generatedThrough: dateOnly(last.toISODate()!) } });
  return made;
}

async function bookOccurrence(b: { id: string; locationId: string; providerId: string; professionCode: string; notes: string | null; clinicOrgId: string }, actor: Actor, occ: { startsAt: Date; endsAt: Date }) {
  const { shiftId } = await createShift(actor, { locationId: b.locationId, professionCode: b.professionCode, startsAt: occ.startsAt, endsAt: occ.endsAt, notes: b.notes, minYearsExperience: 0 }, { post: false });
  // Straight from draft to this provider: no posting, no one else notified.
  await prisma.shift.update({ where: { id: shiftId }, data: { standingBookingId: b.id, status: "OPEN", postedAt: clock.now() } });
  try {
    await confirmProvider(actor, shiftId, b.providerId, "STANDING");
  } catch (e) {
    // The provider can't take this day (license, conflict, time off…): find other cover like any shift.
    await prisma.shift.update({ where: { id: shiftId }, data: { status: "DRAFT", postedAt: null } });
    await postShift(actor, shiftId).catch(() => undefined);
    const provider = await prisma.provider.findUniqueOrThrow({ where: { id: b.providerId } });
    const when = occ.startsAt.toLocaleDateString("en-US", { weekday: "short", month: "short", day: "numeric" });
    await notifyClinic(prisma, b.clinicOrgId, {
      template: "standing_day_open",
      title: `${provider.displayName} can't cover ${when} — we've posted it`,
      body: `Your standing booking couldn't be booked for ${when} (${(e as Error).message}). We've posted that day so other providers can pick it up.`,
      link: `/clinic/shifts/${shiftId}`,
    });
  }
}

/** Sweep: keep every active standing booking booked out to the horizon. */
export async function standingSweep() {
  const ids = await prisma.standingBooking.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  let made = 0;
  for (const { id } of ids) made += await generateStanding(id).catch(() => 0);
  return made;
}

export async function clinicStanding(actor: Actor) {
  const orgId = requireClinic(actor);
  const rows = await prisma.standingBooking.findMany({ where: { clinicOrgId: orgId }, orderBy: [{ status: "asc" }, { createdAt: "desc" }] });
  return withNames(rows);
}

export async function providerStanding(actor: Actor) {
  const providerId = requireProvider(actor);
  const rows = await prisma.standingBooking.findMany({ where: { providerId }, orderBy: [{ status: "desc" }, { createdAt: "desc" }] });
  return withNames(rows);
}

async function withNames<T extends { providerId: string; clinicOrgId: string; locationId: string; id: string }>(rows: T[]) {
  const [providers, orgs, locs, upcoming] = await Promise.all([
    prisma.provider.findMany({ where: { id: { in: rows.map((r) => r.providerId) } }, select: { id: true, displayName: true } }),
    prisma.clinicOrg.findMany({ where: { id: { in: rows.map((r) => r.clinicOrgId) } }, select: { id: true, displayName: true } }),
    prisma.clinicLocation.findMany({ where: { id: { in: rows.map((r) => r.locationId) } }, select: { id: true, name: true, city: true, state: true, timeZone: true } }),
    prisma.shift.findMany({ where: { standingBookingId: { in: rows.map((r) => r.id) }, startsAt: { gte: clock.now() }, status: { not: "CANCELLED" } }, orderBy: { startsAt: "asc" }, select: { id: true, standingBookingId: true, startsAt: true, status: true, assignments: { where: { status: { in: ["CONFIRMED", "IN_PROGRESS"] } }, select: { id: true, providerId: true } } } }),
  ]);
  const p = new Map(providers.map((x) => [x.id, x.displayName]));
  const o = new Map(orgs.map((x) => [x.id, x.displayName]));
  const l = new Map(locs.map((x) => [x.id, x]));
  return rows.map((r) => ({ ...r, providerName: p.get(r.providerId) ?? "Provider", clinicName: o.get(r.clinicOrgId) ?? "Clinic", location: l.get(r.locationId)!, upcoming: upcoming.filter((u) => u.standingBookingId === r.id) }));
}

/** Providers a clinic can offer a standing booking to: completed a shift together, not blocked. */
export async function standingCandidates(actor: Actor) {
  const orgId = requireClinic(actor);
  const rows = await prisma.assignment.findMany({ where: { status: "COMPLETED", shift: { location: { clinicOrgId: orgId } } }, select: { providerId: true, professionCode: true, provider: { select: { displayName: true } } }, distinct: ["providerId", "professionCode"] });
  const blocked = new Set((await prisma.block.findMany({ where: { fromType: "CLINIC", fromId: orgId, toType: "PROVIDER" }, select: { toId: true } })).map((b) => b.toId));
  return rows.filter((r) => !blocked.has(r.providerId)).map((r) => ({ providerId: r.providerId, professionCode: r.professionCode, name: r.provider.displayName }));
}

