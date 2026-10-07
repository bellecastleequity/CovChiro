import { DateTime } from "luxon";
import { DomainError } from "@cm/core";
import { prisma } from "@cm/db";
import { audit, clock, getSettings, requireProvider, type Actor } from "./context";

/**
 * Taking a break (provider). From the break's start date the provider gets no NEW shifts:
 * core eligibility F4 fails for any shift starting on or after Provider.breakStartsAt (until
 * breakEndsAt, when they've set a resume date), so matching, offers, dispatch, On Call,
 * invitations and standing bookings all skip them. Existing bookings are decided one by one
 * when the break is set up: keep it, or release it (a normal provider cancellation, so the late
 * rules apply and the shift is refilled). Open applications and offers for shifts in the break
 * are withdrawn/declined. Resuming = confirm their hours and pick the date they're back.
 */

const day = (iso: string, tz: string) => {
  const d = DateTime.fromISO(iso, { zone: tz }).startOf("day");
  if (!d.isValid) throw new DomainError("VALIDATION", "Choose a date.");
  return d;
};

/** On break now (or from a future date)? Clears a break whose resume date has passed. */
export async function breakStatus(providerId: string) {
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: providerId }, select: { breakStartsAt: true, breakEndsAt: true, homeTimeZone: true } });
  const now = clock.now();
  if (p.breakStartsAt && p.breakEndsAt && p.breakEndsAt <= now) {
    // Back from a planned break: their active-status clock starts again.
    await prisma.provider.update({ where: { id: providerId }, data: { breakStartsAt: null, breakEndsAt: null, breakReason: null, activeConfirmedAt: now } });
    return { onBreak: false, scheduled: false, from: null, until: null, timeZone: p.homeTimeZone };
  }
  return {
    onBreak: !!p.breakStartsAt && p.breakStartsAt <= now,
    /** A break set up to start later. */
    scheduled: !!p.breakStartsAt && p.breakStartsAt > now,
    from: p.breakStartsAt,
    until: p.breakEndsAt,
    timeZone: p.homeTimeZone,
  };
}

/** Step 2 of "Taking a break": the bookings from the start date, each to keep or release. */
export async function previewBreak(actor: Actor, startDate: string) {
  const providerId = requireProvider(actor);
  const s = await getSettings();
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: providerId }, select: { homeTimeZone: true } });
  const now = clock.now();
  const from = day(startDate, p.homeTimeZone);
  if (from < DateTime.fromJSDate(now, { zone: p.homeTimeZone }).startOf("day")) throw new DomainError("VALIDATION", "The break can't start in the past.");
  const rows = await prisma.assignment.findMany({
    where: { providerId, status: "CONFIRMED", startsAt: { gt: now } },
    include: { shift: { include: { location: { include: { clinicOrg: true } } } } },
    orderBy: { startsAt: "asc" },
  });
  const lateHours = s["payments.providerLateCancelHours"];
  const view = (a: (typeof rows)[number]) => ({
    id: a.id,
    clinic: a.shift.location.clinicOrg.displayName,
    city: a.shift.location.city,
    startsAt: a.startsAt.toISOString(),
    endsAt: a.endsAt.toISOString(),
    timeZone: a.shift.location.timeZone,
    payCents: a.providerTotalCents,
    late: +a.startsAt - +now < lateHours * 3_600_000,
  });
  const fromDate = from.toJSDate();
  return {
    from: fromDate.toISOString(),
    lateHours,
    during: rows.filter((a) => a.startsAt >= fromDate).map(view),
    before: rows.filter((a) => a.startsAt < fromDate).map(view),
  };
}

/** Final step: release the chosen bookings, withdraw open applications/offers, and start the break. */
export async function startBreak(actor: Actor, input: { startDate: string; release: string[]; keep: string[] }) {
  const providerId = requireProvider(actor);
  const preview = await previewBreak(actor, input.startDate);
  const decided = new Set([...input.release, ...input.keep]);
  const undecided = preview.during.filter((b) => !decided.has(b.id));
  if (undecided.length) throw new DomainError("VALIDATION", "Choose keep or release for every booking during your break.");
  const release = new Set(input.release.filter((id) => preview.during.some((b) => b.id === id)));
  const from = new Date(preview.from);
  const { cancelAssignment, withdrawApplication, respondToOffer } = await import("./shifts");
  for (const id of release) await cancelAssignment(actor, id, "Taking a break", { by: "PROVIDER" });
  const apps = await prisma.application.findMany({ where: { providerId, status: "ACTIVE", shift: { startsAt: { gte: from } } }, select: { id: true } });
  for (const a of apps) await withdrawApplication(actor, a.id).catch(() => undefined);
  const offers = await prisma.offer.findMany({ where: { providerId, status: "PENDING", shift: { startsAt: { gte: from } } }, select: { id: true } });
  for (const o of offers) await respondToOffer(actor, o.id, false).catch(() => undefined);
  await prisma.provider.update({ where: { id: providerId }, data: { breakStartsAt: from, breakEndsAt: null, breakReason: null } });
  await audit(prisma, actor, "provider.break_started", "Provider", providerId, null, { from, released: [...release], kept: input.keep, withdrawnApplications: apps.length, declinedOffers: offers.length });
  return { from, released: release.size, kept: preview.during.length - release.size, withdrawnApplications: apps.length, declinedOffers: offers.length };
}

/** Back from a break: hours confirmed, and the date they take shifts again (today = right away). */
export async function resumeCoverage(actor: Actor, input: { resumeDate: string; hoursConfirmed: boolean }) {
  const providerId = requireProvider(actor);
  if (!input.hoursConfirmed) throw new DomainError("VALIDATION", "Please confirm your available hours first.");
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: providerId }, select: { breakStartsAt: true, homeTimeZone: true, _count: { select: { availability: true, openDates: true } } } });
  if (!p.breakStartsAt) throw new DomainError("CONFLICT", "You're not on a break.");
  if (!p._count.availability && !p._count.openDates) throw new DomainError("VALIDATION", "Add your weekly hours or open dates first, so we know when to offer you shifts.");
  const now = clock.now();
  const back = day(input.resumeDate, p.homeTimeZone);
  if (back < DateTime.fromJSDate(now, { zone: p.homeTimeZone }).startOf("day")) throw new DomainError("VALIDATION", "Choose today or a later date.");
  const until = back.toJSDate();
  if (until <= now) await prisma.provider.update({ where: { id: providerId }, data: { breakStartsAt: null, breakEndsAt: null, breakReason: null, activeConfirmedAt: now } });
  else await prisma.provider.update({ where: { id: providerId }, data: { breakEndsAt: until, activeConfirmedAt: until } });
  await audit(prisma, actor, "provider.break_ended", "Provider", providerId, null, { resumeAt: until });
  return { resumeAt: until, now: until <= now };
}
