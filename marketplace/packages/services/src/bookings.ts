import { DomainError } from "@cm/core";
import { prisma } from "@cm/db";
import { audit, requireClinic, requireProvider, type Actor } from "./context";
import { notifyClinic } from "./notify";
import { applyToShift, cancelAssignment, createShift, postShift, selectApplicant, ShiftInput, type ShiftInputT, validateShiftInput } from "./shifts";

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
  if (days.length === 1) return { groupId: null, shiftIds: [(await createShift(actor, days[0], opts)).shiftId] };
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
  const group = await prisma.shiftGroup.create({ data: { locationId: parsed[0].locationId } });
  const shiftIds: string[] = [];
  for (const [i, d] of parsed.entries()) {
    const { shiftId } = await createShift(actor, { ...d, promoCode: i === 0 ? d.promoCode : null }, { post: false });
    await prisma.shift.update({ where: { id: shiftId }, data: { shiftGroupId: group.id } });
    shiftIds.push(shiftId);
  }
  if (opts.post) for (const id of shiftIds) await postShift(actor, id);
  await audit(prisma, actor, "booking.created", "ShiftGroup", group.id, null, { days: shiftIds.length, post: opts.post });
  return { groupId: group.id, shiftIds };
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
  for (const d of days) {
    try {
      await applyToShift(actor, d.id, input);
      applied++;
    } catch {
      skipped++; // not eligible that day (availability, conflict…) or already applied
    }
  }
  if (!applied) throw new DomainError("VALIDATION", "You can't take any of the open days in this booking.");
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
          orderBy: { startsAt: "asc" },
        })
      : [a];
  const quiet = targets.length > 1;
  for (const t of targets) await cancelAssignment(actor, t.id, reason, { by: "PROVIDER", quiet });
  if (quiet) {
    const tz = a.shift.location.timeZone;
    const days = targets.map((t) => t.startsAt.toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" }));
    await notifyClinic(prisma, a.shift.location.clinicOrgId, {
      template: "booking_cancelled_days",
      title: `We've had a cancellation for ${targets.length} days — we're already finding replacements`,
      body: `${a.provider.displayName} can no longer cover ${days.join(", ")}. No need to worry — we're finding a replacement for each day urgently as we speak, and we'll email you as each day is covered. Your deposits for those days are being refunded.`,
      link: `/clinic/shifts/${targets[0].shiftId}`,
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
