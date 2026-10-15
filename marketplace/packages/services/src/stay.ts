import { DateTime } from "luxon";
import { DomainError, HOUR, STAY_KINDS, stayDateIssues, type StayDateIssue, STAY_MISSING_WORDS, stayAccessVisible, stayLabel, stayMissing, stayReminderDue, staySharedWith, type StayKind } from "@cm/core";
import { prisma, type Assignment, type Shift } from "@cm/db";
import { storageProvider } from "@cm/integrations";
import { audit, getSettings, requireAdmin, requireClinic, requireProvider, SYSTEM, type Actor } from "./context";
import { notify, notifyAdmins, notifyClinic } from "./notify";

/**
 * Clinic-booked stays (owner decision Oct 2026). When the clinic books the provider's stay
 * (Shift.lodgingByClinic), it enters the details here and only the provider it was saved for
 * sees them: place, address, check-in/out, confirmation number, the name it's booked under,
 * access instructions (door codes, shown from stay.accessFromHours before the start), a
 * booking confirmation file and notes. The provider taps "Got it". If a replacement is
 * confirmed, the clinic is told to move the reservation to the new provider's legal name;
 * the old details are hidden from the new provider until the clinic saves them again.
 */

export interface StayInput {
  kind: StayKind;
  place: string;
  address: string;
  /** Local date-time strings (yyyy-MM-ddTHH:mm) in the clinic location's time zone. */
  checkIn: string;
  checkOut: string;
  confirmation: string;
  bookedUnder: string;
  access: string;
  notes: string;
  fileKey?: string | null;
  removeFile?: boolean;
}

const LIVE = ["CONFIRMED", "IN_PROGRESS"] as const;

/** A multi-day booking is one trip: its days share the stay when the same provider covers them. */
const tripKey = (sh: { id: string; shiftGroupId: string | null }) => sh.shiftGroupId ?? sh.id;

/** The days the stay saved on `shiftId` applies to: itself plus the booking's other days covered by the same provider (or, unbooked, the other unbooked days). */
async function stayDays(shift: { id: string; shiftGroupId: string | null }) {
  const days = await prisma.shift.findMany({
    where: shift.shiftGroupId ? { shiftGroupId: shift.shiftGroupId, status: { notIn: ["CANCELLED", "COMPLETED", "UNFILLED"] } } : { id: shift.id },
    include: { assignments: { where: { status: { in: [...LIVE] } }, include: { provider: true } } },
    orderBy: { startsAt: "asc" },
  });
  const mine = days.find((d) => d.id === shift.id);
  const who = mine?.assignments[0]?.providerId ?? null;
  return days.filter((d) => d.id === shift.id || (d.assignments[0]?.providerId ?? null) === who);
}

/** Claim a once-only notice. */
const once = async (key: string, userId: string) => (await prisma.digestSend.createMany({ data: [{ key, userId }], skipDuplicates: true })).count === 1;

/** This booking needs a stay: fly-in, or a drive past the lodging trigger. */
export function needsStay(a: Pick<Assignment, "flyIn" | "driveMinutes">, s: { "pricing.lodgingTriggerMinutes": number }): boolean {
  return a.flyIn || a.driveMinutes > s["pricing.lodgingTriggerMinutes"];
}

const clip = (v: string | null | undefined, n: number) => (v ?? "").trim().slice(0, n) || null;

function localTime(v: string, zone: string): Date | null {
  if (!v) return null;
  const d = DateTime.fromISO(v, { zone });
  if (!d.isValid) throw new DomainError("VALIDATION", "Enter the check-in and check-out as a date and time.");
  return d.toJSDate();
}

async function clinicShift(actor: Actor, shiftId: string) {
  if (actor.role === "PLATFORM_ADMIN") requireAdmin(actor);
  const orgId = actor.role === "PLATFORM_ADMIN" ? null : requireClinic(actor);
  const shift = await prisma.shift.findFirst({ where: { id: shiftId, ...(orgId ? { location: { clinicOrgId: orgId } } : {}) }, include: { location: true } });
  if (!shift) throw new DomainError("NOT_FOUND", "Shift not found");
  return shift;
}

/**
 * Advice when the stay doesn't line up with the work: check-in within 24 h before the start, check-out
 * between the start and 24 h after the end. A multi-day booking is measured as one stay (first start, last end).
 */
export async function stayDateWarnings(shift: Pick<Shift, "id" | "startsAt" | "endsAt" | "shiftGroupId" | "stayCheckIn" | "stayCheckOut">, tz: string): Promise<string[]> {
  let work = { startsAt: shift.startsAt, endsAt: shift.endsAt };
  if (shift.shiftGroupId) {
    const days = await prisma.shift.findMany({ where: { shiftGroupId: shift.shiftGroupId, status: { not: "CANCELLED" } }, select: { startsAt: true, endsAt: true } });
    if (days.length) work = { startsAt: new Date(Math.min(...days.map((d) => +d.startsAt))), endsAt: new Date(Math.max(...days.map((d) => +d.endsAt))) };
  }
  const t = (d: Date) => d.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  const what = shift.shiftGroupId ? "the booking" : "the shift";
  const words: Record<StayDateIssue, string> = {
    CHECKIN_AFTER_START: `Check-in (${shift.stayCheckIn ? t(shift.stayCheckIn) : ""}) is after ${what} starts (${t(work.startsAt)}). Your provider usually needs to check in the evening before. Please check the dates.`,
    CHECKIN_TOO_EARLY: `Check-in (${shift.stayCheckIn ? t(shift.stayCheckIn) : ""}) is more than 24 hours before ${what} starts (${t(work.startsAt)}). Is the extra night intended? If not, please check the dates.`,
    CHECKOUT_BEFORE_START: `Check-out (${shift.stayCheckOut ? t(shift.stayCheckOut) : ""}) is before ${what} starts (${t(work.startsAt)}), so the stay wouldn't cover the night before. Please check the dates.`,
    CHECKOUT_TOO_LATE: `Check-out (${shift.stayCheckOut ? t(shift.stayCheckOut) : ""}) is more than 24 hours after ${what} ends (${t(work.endsAt)}). Is the extra night intended? If not, please check the dates.`,
  };
  return stayDateIssues({ checkIn: shift.stayCheckIn, checkOut: shift.stayCheckOut }, work).map((i) => words[i]);
}

/** The clinic saves the stay details. They're saved for the booked provider (if any), who is told. */
export async function saveStayDetails(actor: Actor, shiftId: string, input: StayInput) {
  const shift = await clinicShift(actor, shiftId);
  if (!shift.lodgingByClinic) throw new DomainError("VALIDATION", "This shift doesn't use a stay booked by your clinic.");
  const tz = shift.location.timeZone;
  const checkIn = localTime(input.checkIn, tz);
  const checkOut = localTime(input.checkOut, tz);
  if (checkIn && checkOut && checkOut <= checkIn) throw new DomainError("VALIDATION", "Check-out has to be after check-in.");
  const days = await stayDays(shift);
  const live = days.find((d) => d.id === shiftId)?.assignments[0] ?? null;
  if (input.removeFile && shift.stayFileKey) await storageProvider().remove(shift.stayFileKey).catch(() => undefined);
  const now = new Date();
  const data = {
    lodgingStayKind: STAY_KINDS.includes(input.kind) ? input.kind : "OTHER",
    stayPlace: clip(input.place, 200),
    stayAddress: clip(input.address, 300),
    stayCheckIn: checkIn,
    stayCheckOut: checkOut,
    stayConfirmation: clip(input.confirmation, 100),
    stayBookedUnder: clip(input.bookedUnder, 200),
    stayAccess: clip(input.access, 600),
    lodgingStayDetails: clip(input.notes, 600),
    stayFileKey: input.fileKey ?? (input.removeFile ? null : shift.stayFileKey),
    stayUpdatedAt: now,
  };
  // Saved for every day of the trip this provider covers (each day keeps its own booking id).
  for (const d of days) {
    const a = d.assignments[0] ?? null;
    await prisma.shift.update({ where: { id: d.id }, data: { ...data, stayForAssignmentId: a?.id ?? null } });
    if (a) await prisma.assignment.update({ where: { id: a.id }, data: { stayAckAt: null } });
  }
  await audit(prisma, actor, "shift.stay_details", "Shift", shiftId, null, { ...data, stayAccess: data.stayAccess ? "(set)" : null, forAssignmentId: live?.id ?? null, days: days.map((d) => d.id) });
  const s = await getSettings();
  if (live && needsStay(live, s)) {
    await notify(prisma, live.provider.userId, {
      template: "stay_details",
      title: shift.stayUpdatedAt ? "Your stay details were updated" : "Your stay is booked",
      body: `${shift.location.name} ${shift.stayUpdatedAt ? "updated" : "added"} where you're staying for ${days.length > 1 ? `your ${days.length}-day booking from ${days[0].startsAt.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" })}` : `your ${shift.startsAt.toLocaleDateString("en-US", { timeZone: tz, month: "short", day: "numeric" })} shift`}${data.stayPlace ? ` (${data.stayPlace})` : ""}. Open the shift to see the details and tap "Got it".`,
      link: `/provider/assignments/${days[0].assignments[0]?.id ?? live.id}`,
      ctaLabel: "See your stay",
      sms: true,
    });
  }
  const warnings = await stayDateWarnings({ ...shift, stayCheckIn: checkIn, stayCheckOut: checkOut }, tz);
  return { sharedWith: live?.provider.displayName ?? null, warnings, days: days.length };
}

/** Everything the clinic's stay card needs, including who to book it for. */
export async function clinicStayView(actor: Actor, shiftId: string) {
  const shift = await clinicShift(actor, shiftId);
  const s = await getSettings();
  const live = await prisma.assignment.findFirst({ where: { shiftId, status: { in: [...LIVE] } }, include: { provider: { select: { displayName: true, legalName: true } } } });
  const facts = { place: shift.stayPlace, address: shift.stayAddress, checkInAt: shift.stayCheckIn, bookedUnder: shift.stayBookedUnder, forAssignmentId: shift.stayForAssignmentId };
  return {
    shift,
    dateWarnings: await stayDateWarnings(shift, shift.location.timeZone),
    live: live
      ? {
          id: live.id,
          displayName: live.provider.displayName,
          // Hotels check ID at the desk: the reservation should be in the provider's legal name.
          legalName: live.provider.legalName,
          needsStay: needsStay(live, s),
          driveMinutes: live.driveMinutes,
          flyIn: live.flyIn,
          ackAt: live.stayAckAt,
          missing: stayMissing(facts, live.id).map((m) => STAY_MISSING_WORDS[m]),
          stale: !!shift.stayForAssignmentId && shift.stayForAssignmentId !== live.id,
        }
      : null,
  };
}

/** The provider's view of their stay; null when the clinic doesn't book it or they don't need one. */
export function providerStay(a: Assignment & { shift: Shift & { location: { timeZone: string } } }, s: Awaited<ReturnType<typeof getSettings>>, now = new Date()) {
  const sh = a.shift;
  if (!sh.lodgingAllowed || !sh.lodgingByClinic || !needsStay(a, s) || !LIVE.includes(a.status as (typeof LIVE)[number])) return null;
  const shared = staySharedWith({ forAssignmentId: sh.stayForAssignmentId }, a.id);
  const hasAny = !!(sh.stayPlace || sh.stayAddress || sh.lodgingStayDetails || sh.stayCheckIn);
  const accessOpen = stayAccessVisible(a.startsAt, now, s["stay.accessFromHours"]);
  return {
    kind: sh.lodgingStayKind,
    label: stayLabel(sh.lodgingStayKind),
    status: !shared ? ("UPDATING" as const) : hasAny ? ("READY" as const) : ("WAITING" as const),
    place: shared ? sh.stayPlace : null,
    address: shared ? sh.stayAddress : null,
    mapUrl: shared && sh.stayAddress ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(`${sh.stayPlace ?? ""} ${sh.stayAddress}`.trim())}` : null,
    checkIn: shared ? sh.stayCheckIn : null,
    checkOut: shared ? sh.stayCheckOut : null,
    confirmation: shared ? sh.stayConfirmation : null,
    bookedUnder: shared ? sh.stayBookedUnder : null,
    access: shared && accessOpen ? sh.stayAccess : null,
    accessLater: shared && !!sh.stayAccess && !accessOpen ? new Date(+a.startsAt - s["stay.accessFromHours"] * HOUR) : null,
    notes: shared ? sh.lodgingStayDetails : null,
    fileUrl: shared && sh.stayFileKey ? `/api/files/${sh.stayFileKey}` : null,
    ackAt: a.stayAckAt,
    timeZone: sh.location.timeZone,
  };
}

/** Short text for messages: "Hampton Inn, 1 Main St · check-in Mon 3:00 PM". */
export function staySummary(a: Assignment & { shift: Shift & { location: { timeZone: string } } }, s: Awaited<ReturnType<typeof getSettings>>): string | null {
  const v = providerStay(a, s);
  if (!v || v.status !== "READY") return v ? `Your stay (${v.label}) is booked by the clinic; we'll let you know when the details are in.` : null;
  const when = v.checkIn ? ` · check-in ${v.checkIn.toLocaleString("en-US", { timeZone: v.timeZone, weekday: "short", hour: "numeric", minute: "2-digit" })}` : "";
  return `Your stay: ${[v.place, v.address].filter(Boolean).join(", ") || v.label}${when}${v.bookedUnder ? ` · booked under ${v.bookedUnder}` : ""}.`;
}

/** The provider has seen the stay details. */
export async function ackStay(actor: Actor, assignmentId: string) {
  const providerId = requireProvider(actor);
  const a = await prisma.assignment.findFirst({ where: { id: assignmentId, providerId }, include: { shift: { include: { location: true } } } });
  if (!a) throw new DomainError("NOT_FOUND", "Shift not found");
  if (!staySharedWith({ forAssignmentId: a.shift.stayForAssignmentId }, a.id)) throw new DomainError("CONFLICT", "The clinic is still updating your stay.");
  // One "Got it" covers every day of the trip.
  await prisma.assignment.updateMany({
    where: { providerId, status: { in: [...LIVE] }, ...(a.shift.shiftGroupId ? { shift: { shiftGroupId: a.shift.shiftGroupId } } : { id: a.id }) },
    data: { stayAckAt: new Date() },
  });
  await audit(prisma, actor, "assignment.stay_ack", "Assignment", a.id);
  return "Thanks, the clinic can see you've got your stay details.";
}

/** Booking confirmation file: the clinic, and the provider it was saved for while booked. */
export async function canViewStayFile(actor: Actor, key: string) {
  const shifts = await prisma.shift.findMany({ where: { stayFileKey: key }, include: { location: { select: { clinicOrgId: true } } } });
  if (!shifts.length) return false;
  if (actor.clinicOrgId && shifts.some((s) => s.location.clinicOrgId === actor.clinicOrgId)) return true;
  if (!actor.providerId) return false;
  for (const shift of shifts) {
    const a = await prisma.assignment.findFirst({ where: { shiftId: shift.id, providerId: actor.providerId, status: { in: [...LIVE] } }, select: { id: true } });
    if (a && staySharedWith({ forAssignmentId: shift.stayForAssignmentId }, a.id)) return true;
  }
  return false;
}

/**
 * At confirmation (effect after the transaction). Details saved before anyone was booked become this
 * provider's; details saved for an earlier provider mean the clinic must move the reservation.
 */
export async function stayOnConfirmed(assignmentId: string) {
  const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { provider: true, shift: { include: { location: true } } } });
  const sh = a.shift;
  const s = await getSettings();
  if (!sh.lodgingAllowed || !sh.lodgingByClinic || !needsStay(a, s)) return;
  const day = sh.startsAt.toLocaleDateString("en-US", { timeZone: sh.location.timeZone, weekday: "short", month: "short", day: "numeric" });
  if (!sh.stayForAssignmentId) {
    if (sh.stayUpdatedAt) await prisma.shift.update({ where: { id: sh.id }, data: { stayForAssignmentId: a.id } });
    const missing = stayMissing({ place: sh.stayPlace, address: sh.stayAddress, checkInAt: sh.stayCheckIn, bookedUnder: sh.stayBookedUnder, forAssignmentId: a.id }, a.id);
    if (!missing.length) return;
    // A multi-day trip confirms day by day: one notice for the whole trip.
    if (!(await once(`stay-needed:${tripKey(sh)}:${a.providerId}`, sh.location.clinicOrgId))) return;
    await notifyClinic(prisma, sh.location.clinicOrgId, {
      template: "stay_details_needed",
      title: "Your provider needs a place to stay",
      body: `${a.provider.displayName} is confirmed for ${day} and lives far enough away to stay the night before. Book ${stayLabel(sh.lodgingStayKind)} under their legal name, ${a.provider.legalName}, and add the details (still needed: ${missing.map((m) => STAY_MISSING_WORDS[m]).join(", ")}).`,
      link: `/clinic/shifts/${sh.id}#stay`,
      ctaLabel: "Add stay details",
    });
    return;
  }
  if (sh.stayForAssignmentId !== a.id) {
    if (!(await once(`stay-moved:${tripKey(sh)}:${a.providerId}`, sh.location.clinicOrgId))) return;
    await notifyClinic(prisma, sh.location.clinicOrgId, {
      template: "stay_update_for_replacement",
      title: "Move the stay to your new provider",
      body: `Your new provider for ${day} is ${a.provider.displayName}. Change the reservation to their legal name, ${a.provider.legalName}, then save the stay details again so they can see them. Your previous provider no longer sees them.`,
      link: `/clinic/shifts/${sh.id}#stay`,
      ctaLabel: "Update the stay",
      sms: true,
    });
  }
}

/**
 * Job (every 15 min): reminders to the clinic while details are missing (stay.reminderHours), one admin
 * alert at stay.adminAlertHours, and a "Got it" nudge to the provider once everything is in.
 */
export async function staySweep(now = new Date()) {
  const s = await getSettings();
  const horizon = Math.max(...s["stay.reminderHours"], s["stay.adminAlertHours"], 1);
  const rows = await prisma.assignment.findMany({
    where: { status: "CONFIRMED", startsAt: { gt: now, lte: new Date(+now + horizon * HOUR) }, shift: { lodgingAllowed: true, lodgingByClinic: true } },
    include: { provider: true, shift: { include: { location: true } } },
  });
  let reminded = 0, alerted = 0, nudged = 0;
  for (const a of rows) {
    if (!needsStay(a, s)) continue;
    const sh = a.shift;
    const missing = stayMissing({ place: sh.stayPlace, address: sh.stayAddress, checkInAt: sh.stayCheckIn, bookedUnder: sh.stayBookedUnder, forAssignmentId: sh.stayForAssignmentId }, a.id);
    const day = a.startsAt.toLocaleDateString("en-US", { timeZone: sh.location.timeZone, weekday: "short", month: "short", day: "numeric" });
    if (missing.length) {
      const mark = stayReminderDue(a.startsAt, now, s["stay.reminderHours"]);
      if (mark !== null && (await once(`stay:${tripKey(sh)}:${a.providerId}:h${mark}`, sh.location.clinicOrgId))) {
        reminded++;
        await notifyClinic(prisma, sh.location.clinicOrgId, {
          template: "stay_details_reminder",
          title: `Your provider's stay for ${day} isn't finished`,
          body: `${a.provider.displayName} arrives the night before and needs the stay details. Still needed: ${missing.map((m) => STAY_MISSING_WORDS[m]).join(", ")}. Book it under ${a.provider.legalName}.`,
          link: `/clinic/shifts/${sh.id}#stay`,
          ctaLabel: "Finish the stay details",
          sms: true,
        });
      }
      if (stayReminderDue(a.startsAt, now, [s["stay.adminAlertHours"]]) !== null && (await once(`stay:${tripKey(sh)}:${a.providerId}:admin`, "admins"))) {
        alerted++;
        await notifyAdmins(prisma, {
          template: "stay_details_missing",
          title: "Clinic-booked stay still missing details",
          body: `${sh.location.name}, ${day}: ${a.provider.displayName} needs a stay and the clinic hasn't added ${missing.map((m) => STAY_MISSING_WORDS[m]).join(", ")}. Please call the clinic.`,
          link: `/admin/shifts/${sh.id}`,
          email: true,
          sms: true,
        });
      }
    } else if (!a.stayAckAt && stayReminderDue(a.startsAt, now, [s["reconfirm.askBeforeHours"]]) !== null && (await once(`stay:${tripKey(sh)}:${a.providerId}:ack`, a.provider.userId))) {
      nudged++;
      await notify(prisma, a.provider.userId, {
        template: "stay_ack_nudge",
        title: `Check your stay for ${day}`,
        body: `The clinic booked your stay at ${sh.stayPlace ?? stayLabel(sh.lodgingStayKind)}. Open your shift to see the address, check-in and the name it's booked under, then tap "Got it".`,
        link: `/provider/assignments/${a.id}`,
        ctaLabel: "See your stay",
        sms: true,
      });
    }
  }
  return { reminded, alerted, nudged };
}
