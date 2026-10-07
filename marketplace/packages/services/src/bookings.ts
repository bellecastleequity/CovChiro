import { DomainError } from "@cm/core";
import { prisma } from "@cm/db";
import { audit, getSettings, requireClinic, requireProvider, type Actor } from "./context";
import { notifyClinic } from "./notify";
import { applyToShift, cancelAssignment, createShift, flyInFields, postShift, selectApplicant, ShiftInput, type ShiftInputT, validateShiftInput } from "./shifts";

/**
 * Multi-day bookings: several days posted together as one ShiftGroup. Each
 * day is still its own shift (own pricing, eligibility, dispatch and
 * cancellation), so coverage is always solved per day; the group just lets
 * clinics post, providers apply, and clinics confirm across all days at once.
 */

const MAX_DAYS = 14;
const LIVE = ["CONFIRMED", "IN_PROGRESS"] as const;

/** Post (or save) several days at once. A promo code applies to the first day only. */
export async function createMultiDay(actor: Actor, days: ShiftInputT[], opts: { post: boolean }) {
  const orgId = requireClinic(actor);
  if (days.some((d) => d.flyIn) && days.some((d) => d.clinicRate)) throw new DomainError("VALIDATION", "Fly-in coverage can't be combined with a clinic-set rate.");
  if (days.length === 1) {
    const one = ShiftInput.parse(days[0]);
    const fly = await flyInFields(one.locationId, [one]);
    if (!fly) return { groupId: null, shiftIds: [(await createShift(actor, days[0], opts)).shiftId] };
    const { shiftId } = await createShift(actor, days[0], { post: false });
    await prisma.shift.update({ where: { id: shiftId }, data: fly });
    if (opts.post) await postShift(actor, shiftId);
    return { groupId: null, shiftIds: [shiftId] };
  }
  if (days.some((d) => d.clinicRate)) throw new DomainError("VALIDATION", "A clinic-set rate is available for single-day shifts only.");
  if (days.length > MAX_DAYS) throw new DomainError("VALIDATION", `Up to ${MAX_DAYS} days per booking.`);
  const parsed = days.map((d) => ShiftInput.parse(d)).sort((a, b) => +a.startsAt - +b.startsAt);
  for (let i = 1; i < parsed.length; i++) {
    if (parsed[i].startsAt < parsed[i - 1].endsAt) throw new DomainError("VALIDATION", "Two of the days overlap. Check the dates and times.");
  }
  // Validate every day before creating anything, so a bad day never leaves half a booking.
  for (const d of parsed) {
    if (!(d.endsAt > d.startsAt)) throw new DomainError("VALIDATION", "Each day needs an end time after its start.");
    await validateShiftInput(prisma, orgId, d, opts.post);
  }
  const fly = await flyInFields(parsed[0].locationId, parsed.map((d) => ({ ...d, flyIn: parsed.some((x) => x.flyIn) })));
  const group = await prisma.shiftGroup.create({ data: { locationId: parsed[0].locationId } });
  const shiftIds: string[] = [];
  for (const [i, d] of parsed.entries()) {
    const { shiftId } = await createShift(actor, { ...d, promoCode: i === 0 ? d.promoCode : null }, { post: false });
    await prisma.shift.update({ where: { id: shiftId }, data: { shiftGroupId: group.id, ...(fly ?? {}) } });
    shiftIds.push(shiftId);
  }
  if (opts.post) for (const id of shiftIds) await postShift(actor, id);
  await audit(prisma, actor, "booking.created", "ShiftGroup", group.id, null, { days: shiftIds.length, post: opts.post });
  return { groupId: group.id, shiftIds };
}

/**
 * Several providers for the same time: one separate booking per provider (each its own shift or
 * multi-day group, price, visit count and confirmation). The DB already stops one provider from
 * holding two overlapping bookings. A promo code applies to the first booking only.
 */
export const MAX_PROVIDERS_AT_ONCE = 5;
export async function createForProviders(actor: Actor, days: ShiftInputT[], providers: number, opts: { post: boolean }) {
  const n = Math.floor(providers);
  if (!(n >= 1 && n <= MAX_PROVIDERS_AT_ONCE)) throw new DomainError("VALIDATION", `Choose 1 to ${MAX_PROVIDERS_AT_ONCE} providers.`);
  if (n > 1 && days.some((d) => d.clinicRate)) throw new DomainError("VALIDATION", "A clinic-set rate is available for one provider at a time.");
  const shiftIds: string[] = [];
  for (let i = 0; i < n; i++) {
    const r = await createMultiDay(actor, i === 0 ? days : days.map((d) => ({ ...d, promoCode: null })), opts);
    shiftIds.push(...r.shiftIds);
  }
  return { shiftIds, bookings: n };
}

/** The days of a booking, with who covers each. */
export async function bookingDays(shiftGroupId: string) {
  return prisma.shift.findMany({
    where: { shiftGroupId },
    orderBy: { startsAt: "asc" },
    include: { location: true, assignments: { where: { status: { in: [...LIVE, "COMPLETED"] } }, include: { provider: true } } },
  });
}

/** Provider: apply to every open day of the booking they're eligible for. */
export async function applyToAllDays(actor: Actor, shiftId: string, input: { note?: string | null; commit: boolean }) {
  requireProvider(actor);
  const sh = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
  if (!sh.shiftGroupId) return { applied: [await applyToShift(actor, shiftId, input)].length, skipped: 0 };
  const days = await prisma.shift.findMany({ where: { shiftGroupId: sh.shiftGroupId, status: { in: ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"] } }, orderBy: { startsAt: "asc" } });
  let applied = 0;
  let skipped = 0;
  const made: string[] = [];
  let flyIn = false;
  for (const d of days) {
    try {
      const r = await applyToShift(actor, d.id, input, { allDays: true });
      made.push(r.applicationId);
      if (r.flyIn) flyIn = true;
      applied++;
    } catch {
      skipped++; // not eligible that day (availability, conflict…) or already applied
    }
  }
  if (!applied) throw new DomainError("VALIDATION", "You can't take any of the open days in this booking.");
  // A fly-in trip needs flyIn.minDays days, or the flight isn't worth it for either side.
  const min = (await getSettings())["flyIn.minDays"];
  if (flyIn && applied < min) {
    await prisma.application.updateMany({ where: { id: { in: made }, status: "ACTIVE" }, data: { status: "WITHDRAWN", withdrawnAt: new Date() } });
    throw new DomainError("VALIDATION", `You'd fly in for this booking, which needs at least ${min} days, but you can only take ${applied} of them (check your availability and other bookings).`);
  }
  return { applied, skipped };
}

/** Clinic: confirm one provider for every open day they applied to. */
export async function confirmForAllDays(actor: Actor, shiftId: string, providerId: string) {
  requireClinic(actor);
  const sh = await prisma.shift.findUniqueOrThrow({ where: { id: shiftId } });
  const ids = sh.shiftGroupId
    ? (await prisma.application.findMany({ where: { providerId, status: "ACTIVE", shift: { shiftGroupId: sh.shiftGroupId } }, select: { shiftId: true } })).map((a) => a.shiftId)
    : [shiftId];
  let confirmed = 0;
  const failed: string[] = [];
  for (const id of ids) {
    try {
      await selectApplicant(actor, id, providerId);
      confirmed++;
    } catch (e) {
      failed.push((e as Error).message);
    }
  }
  if (!confirmed) throw new DomainError("CONFLICT", failed[0] ?? "Nothing to confirm.");
  return { confirmed, failed: failed.length };
}

/**
 * Provider cancels a day of a booking: just this day, or this and all their
 * remaining days. Each released day gets its own replacement search
 * (emergency cover within 24h); the clinic gets one email for all of them.
 */
export async function cancelBookingDays(actor: Actor, assignmentId: string, reason: string, scope: "day" | "remaining") {
  const providerId = requireProvider(actor);
  const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { shift: { include: { location: { include: { clinicOrg: true } } } }, provider: true } });
  if (a.providerId !== providerId) throw new DomainError("NOT_FOUND", "Shift not found");
  const targets =
    scope === "remaining" && a.shift.shiftGroupId
      ? await prisma.assignment.findMany({
          where: { providerId, status: { in: [...LIVE] }, startsAt: { gte: a.startsAt }, shift: { shiftGroupId: a.shift.shiftGroupId } },
          // Latest first: the day carrying a fly-in airfare goes last, when no other days remain (refunded).
          orderBy: { startsAt: "desc" },
        })
      : [a];
  const quiet = targets.length > 1;
  for (const t of targets) await cancelAssignment(actor, t.id, reason, { by: "PROVIDER", quiet });
  if (quiet) {
    const tz = a.shift.location.timeZone;
    const days = [...targets].reverse().map((t) => t.startsAt.toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }));
    await notifyClinic(prisma, a.shift.location.clinicOrgId, {
      template: "booking_cancelled_days",
      title: `We've had a cancellation for ${targets.length} days — we're already finding replacements`,
      body: `${a.provider.displayName} can no longer cover ${days.join(", ")}. No need to worry — we're finding a replacement for each day urgently as we speak, and we'll email you as each day is covered. Your deposits for those days are being refunded.`,
      link: `/clinic/shifts/${targets[targets.length - 1].shiftId}`,
      sms: true,
    });
  }
  return { cancelled: targets.length };
}

/** After a confirmation: once every day of a booking is covered, one summary email to the clinic. */
export async function maybeSendBookingCovered(shiftId: string) {
  const sh = await prisma.shift.findUnique({ where: { id: shiftId }, select: { shiftGroupId: true } });
  if (!sh?.shiftGroupId) return;
  const days = (await bookingDays(sh.shiftGroupId)).filter((d) => d.status !== "CANCELLED");
  if (days.length < 2 || days.some((d) => !d.assignments.some((x) => (LIVE as readonly string[]).includes(x.status)))) return;
  // One summary per covered state: a later change + re-cover sends a fresh one.
  const loc = days[0].location;
  const signature = days.map((d) => d.assignments.find((x) => (LIVE as readonly string[]).includes(x.status))!.id).join(",");
  const claimed = await prisma.digestSend.createMany({ data: [{ key: `booking-covered:${sh.shiftGroupId}:${signature}`, userId: loc.clinicOrgId }], skipDuplicates: true });
  if (!claimed.count) return;
  const lines = days.map((d) => {
    const x = d.assignments.find((y) => (LIVE as readonly string[]).includes(y.status))!;
    return `${d.startsAt.toLocaleDateString("en-US", { timeZone: loc.timeZone, weekday: "short", month: "short", day: "numeric" })}: ${x.provider.displayName}`;
  });
  await notifyClinic(prisma, loc.clinicOrgId, {
    template: "booking_covered",
    title: `Your ${days.length}-day booking is fully covered`,
    body: `Here's who's covering ${loc.name}:`,
    details: lines,
    link: `/clinic/shifts/${days[0].id}`,
    ctaLabel: "See your booking",
  });
}

/**
 * "Book again": post the same shift (location, profession, hours, preferences) on a new date and
 * invite the provider who worked it. The invitation is a normal clinic invite: rank-protected, and
 * the provider must still be eligible on the new date (INV-1); if they can't be invited, the shift
 * stays posted for others and the reason is returned.
 */
export async function bookAgain(actor: Actor, assignmentId: string, dateIso: string) {
  const orgId = requireClinic(actor);
  const a = await prisma.assignment.findFirst({ where: { id: assignmentId, shift: { location: { clinicOrgId: orgId } } }, include: { shift: { include: { location: true } }, provider: { select: { id: true, displayName: true } } } });
  if (!a) throw new DomainError("NOT_FOUND", "Shift not found");
  if (!/^\d{4}-\d{2}-\d{2}$/.test(dateIso)) throw new DomainError("VALIDATION", "Pick a date.");
  const tz = a.shift.location.timeZone;
  const { DateTime } = await import("luxon");
  const oldStart = DateTime.fromJSDate(a.shift.startsAt, { zone: tz });
  const oldEnd = DateTime.fromJSDate(a.shift.endsAt, { zone: tz });
  const day = DateTime.fromISO(dateIso, { zone: tz });
  const startsAt = day.set({ hour: oldStart.hour, minute: oldStart.minute, second: 0, millisecond: 0 });
  const endsAt = startsAt.plus(oldEnd.diff(oldStart));
  const s = a.shift;
  const { shiftId } = await createShift(
    actor,
    {
      locationId: s.locationId, professionCode: s.professionCode, startsAt: startsAt.toJSDate(), endsAt: endsAt.toJSDate(),
      requiredSkillIds: s.requiredSkillIds, preferredSkillIds: s.preferredSkillIds, expectedPatients: s.expectedPatients, minYearsExperience: s.minYearsExperience ?? undefined,
      notes: s.notes, instantBook: false, maxTravelBudgetCents: s.maxTravelBudgetCents, lodgingAllowed: s.lodgingAllowed, lodgingCapCentsPerNight: s.lodgingCapCentsPerNight,
      // Same lunch, at the same time of day.
      lunchMinutes: s.lunchMinutes,
      lunchStartsAt: s.lunchStartsAt ? new Date(+startsAt.toJSDate() + (+s.lunchStartsAt - +s.startsAt)) : null,
      supervisionAttestation: (s.supervisionAttestation as never) ?? null,
    },
    { post: true },
  );
  await audit(prisma, actor, "shift.book_again", "Shift", shiftId, null, { fromAssignmentId: assignmentId, providerId: a.providerId });
  const { inviteProviders } = await import("./shifts");
  try {
    await inviteProviders(actor, shiftId, [a.providerId]);
    return { shiftId, invited: true as const, providerName: a.provider.displayName };
  } catch (e) {
    return { shiftId, invited: false as const, providerName: a.provider.displayName, reason: e instanceof Error ? e.message : String(e) };
  }
}
