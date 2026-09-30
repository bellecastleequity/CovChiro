import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@cm/config";
import { DomainError } from "@cm/core";
import { prisma, type Prisma } from "@cm/db";
import { audit, clock, getSettings, SYSTEM, type Actor } from "./context";
import { notify, notifyAdmins, notifyClinic } from "./notify";

/**
 * Attendance: providers reconfirm upcoming shifts, then check in on the day.
 *
 *   ask (48h before) → one reminder (+6h) → deadline (24h before): not
 *   reconfirmed = released as a late provider cancel, shift reopened, clinic
 *   told. Shifts booked within 72h of the start skip reconfirmation.
 *   Day of: "On my way" prompt (2h before); none by 30 min before → alert
 *   admins and the clinic. Missing 2 reconfirmations in 90 days pauses the
 *   provider. Every number is a Setting.
 *
 * Each step is an idempotent sweep that claims its row with a conditional
 * update, so overlapping cron ticks never send twice.
 */

const HOUR = 3_600_000;
const MIN = 60_000;

// ---------------- one-tap link ----------------

function sign(assignmentId: string) {
  return createHmac("sha256", env().SESSION_SECRET ?? "dev-secret").update(`attendance:${assignmentId}`).digest("base64url").slice(0, 22);
}

/** Link token for the provider's one-tap confirm / "On my way" page (no sign-in needed; covers this one shift). */
export function attendanceToken(assignmentId: string) {
  return `${assignmentId}.${sign(assignmentId)}`;
}

export function assignmentIdFromToken(token: string): string | null {
  const [id, sig] = token.split(".");
  if (!id || !sig) return null;
  const want = Buffer.from(sign(id));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}

export async function attendanceByToken(token: string) {
  const id = assignmentIdFromToken(token);
  if (!id) return null;
  return prisma.assignment.findUnique({ where: { id }, include: { provider: true, shift: { include: { location: { include: { clinicOrg: true } } } } } });
}

// ---------------- provider actions ----------------

function assertMine(actor: Actor | null, a: { providerId: string }) {
  if (actor && actor.role !== "SYSTEM" && actor.providerId !== a.providerId) throw new DomainError("NOT_FOUND", "Shift not found");
}

/** "I'm still coming." actor = null when it comes from the signed one-tap link. */
export async function reconfirmAttendance(actor: Actor | null, assignmentId: string) {
  const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId } });
  assertMine(actor, a);
  if (a.status !== "CONFIRMED" && a.status !== "IN_PROGRESS") {
    throw new DomainError("CONFLICT", a.flags.includes("RECONFIRM_MISSED") ? "This shift was released because it wasn't confirmed by the deadline." : "This shift is no longer booked to you.");
  }
  if (!a.reconfirmedAt) {
    await prisma.assignment.update({ where: { id: a.id }, data: { reconfirmedAt: clock.now() } });
    await audit(prisma, actor ?? SYSTEM, "assignment.reconfirmed", "Assignment", a.id, null, { via: actor ? "app" : "link" });
  }
  return "Thanks — you're confirmed. See you there!";
}

/** Day-of check-in: "On my way." Also counts as reconfirmed; the clinic is told. */
export async function markOnMyWay(actor: Actor | null, assignmentId: string) {
  const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: { provider: true, shift: { include: { location: true } } } });
  assertMine(actor, a);
  if (a.status !== "CONFIRMED" && a.status !== "IN_PROGRESS") throw new DomainError("CONFLICT", "This shift is no longer booked to you.");
  if (a.onMyWayAt) return "Already marked — drive safe!";
  const now = clock.now();
  await prisma.assignment.update({ where: { id: a.id }, data: { onMyWayAt: now, reconfirmedAt: a.reconfirmedAt ?? now } });
  await audit(prisma, actor ?? SYSTEM, "assignment.on_my_way", "Assignment", a.id, null, { via: actor ? "app" : "link" });
  await notifyClinic(prisma, a.shift.location.clinicOrgId, {
    template: "provider_on_way",
    title: `${a.provider.displayName} is on the way`,
    body: `Your provider for today at ${a.shift.location.name} has checked in and is heading over.`,
    link: `/clinic/shifts/${a.shiftId}`,
    email: false,
  });
  return "Thanks — we've let the clinic know you're on your way. Drive safe!";
}

// ---------------- sweep ----------------

type Loaded = Prisma.AssignmentGetPayload<{ include: { provider: true; shift: { include: { location: { include: { clinicOrg: true } } } } } }>;
const withShift = { provider: true, shift: { include: { location: { include: { clinicOrg: true } } } } } as const;

/** Claim one step for one assignment: true only for the tick that set it. */
async function claim(id: string, field: "reconfirmRequestedAt" | "reconfirmRemindedAt" | "checkinPromptedAt" | "checkinAlertedAt", now: Date) {
  const r = await prisma.assignment.updateMany({ where: { id, [field]: null }, data: { [field]: now } });
  return r.count === 1;
}

function when(a: Loaded, d: Date, opts: Intl.DateTimeFormatOptions) {
  return d.toLocaleString("en-US", { timeZone: a.shift.location.timeZone, ...opts });
}
const dayOf = (a: Loaded) => when(a, a.startsAt, { weekday: "short", month: "short", day: "numeric" });
const timeOf = (a: Loaded, d: Date) => when(a, d, { hour: "numeric", minute: "2-digit" });

export async function attendanceSweep(now: Date = clock.now()) {
  const s = await getSettings();
  const out = { asked: 0, reminded: 0, released: 0, prompted: 0, alerted: 0 };
  const askBefore = s["reconfirm.askBeforeHours"] * HOUR;
  const deadlineBefore = s["reconfirm.deadlineBeforeHours"] * HOUR;

  if (s["reconfirm.enabled"]) {
    // 1. Ask, once the shift is inside the ask window and still before the deadline.
    const due = await prisma.assignment.findMany({
      where: { status: "CONFIRMED", reconfirmRequestedAt: null, reconfirmedAt: null, startsAt: { gt: new Date(+now + deadlineBefore), lte: new Date(+now + askBefore) } },
      include: withShift,
    });
    for (const a of due) {
      // A fresh booking is its own confirmation.
      if (+a.startsAt - +a.confirmedAt <= s["reconfirm.skipIfBookedWithinHours"] * HOUR) continue;
      if (!(await claim(a.id, "reconfirmRequestedAt", now))) continue;
      const deadline = new Date(+a.startsAt - deadlineBefore);
      await notify(prisma, a.provider.userId, {
        template: "reconfirm_ask",
        title: `Please confirm: ${dayOf(a)} at ${a.shift.location.clinicOrg.displayName}`,
        body: `Tap to confirm you're still coming (${timeOf(a, a.startsAt)}, ${a.shift.location.city}). If we don't hear from you by ${dayOf({ ...a, startsAt: deadline })} ${timeOf(a, deadline)}, we'll give this shift to another provider.`,
        link: `/c/${attendanceToken(a.id)}`,
        ctaLabel: "I'm still coming",
        sms: true,
      });
      out.asked++;
    }

    // 2. One reminder.
    const remind = await prisma.assignment.findMany({
      where: {
        status: "CONFIRMED",
        reconfirmedAt: null,
        reconfirmRemindedAt: null,
        reconfirmRequestedAt: { lte: new Date(+now - s["reconfirm.reminderAfterHours"] * HOUR) },
        startsAt: { gt: new Date(+now + deadlineBefore) },
      },
      include: withShift,
    });
    for (const a of remind) {
      if (!(await claim(a.id, "reconfirmRemindedAt", now))) continue;
      const deadline = new Date(+a.startsAt - deadlineBefore);
      await notify(prisma, a.provider.userId, {
        template: "reconfirm_reminder",
        title: `Reminder: confirm your ${dayOf(a)} shift by ${timeOf(a, deadline)} ${when(a, deadline, { weekday: "short" })}`,
        body: `We still need you to confirm ${a.shift.location.clinicOrg.displayName} on ${dayOf(a)}. Otherwise the shift goes to another provider at the deadline.`,
        link: `/c/${attendanceToken(a.id)}`,
        ctaLabel: "I'm still coming",
        sms: true,
      });
      out.reminded++;
    }

    // 3. Deadline: release the unconfirmed.
    const missed = await prisma.assignment.findMany({
      where: { status: "CONFIRMED", reconfirmedAt: null, reconfirmRequestedAt: { not: null }, startsAt: { gt: now, lte: new Date(+now + deadlineBefore) }, NOT: { flags: { has: "RECONFIRM_MISSED" } } },
      select: { id: true, providerId: true },
    });
    for (const m of missed) {
      const claimed = await prisma.assignment.updateMany({ where: { id: m.id, reconfirmedAt: null, NOT: { flags: { has: "RECONFIRM_MISSED" } } }, data: { flags: { push: "RECONFIRM_MISSED" } } });
      if (!claimed.count) continue;
      const { cancelAssignment } = await import("./shifts");
      await cancelAssignment(SYSTEM, m.id, "Not reconfirmed by the deadline", { by: "PROVIDER", unconfirmed: true });
      out.released++;
      await pauseIfRepeated(m.providerId, now, s["reconfirm.missesBeforePause"], s["reconfirm.missWindowDays"]);
    }
  }

  // 4. Day-of "On my way" prompt.
  const prompt = await prisma.assignment.findMany({
    where: { status: "CONFIRMED", onMyWayAt: null, checkinPromptedAt: null, startsAt: { gt: now, lte: new Date(+now + s["checkin.promptBeforeHours"] * HOUR) } },
    include: withShift,
  });
  for (const a of prompt) {
    if (!(await claim(a.id, "checkinPromptedAt", now))) continue;
    await notify(prisma, a.provider.userId, {
      template: "checkin_prompt",
      title: `Today ${timeOf(a, a.startsAt)} at ${a.shift.location.clinicOrg.displayName}`,
      body: `Tap "On my way" when you head out so the clinic knows you're coming. ${a.shift.location.addressLine1}, ${a.shift.location.city}.`,
      link: `/c/${attendanceToken(a.id)}`,
      ctaLabel: "On my way",
      sms: true,
    });
    out.prompted++;
  }

  // 5. Not on the way close to the start → alert admins and the clinic.
  const late = await prisma.assignment.findMany({
    where: { status: { in: ["CONFIRMED", "IN_PROGRESS"] }, onMyWayAt: null, checkinAlertedAt: null, startsAt: { gt: new Date(+now - HOUR), lte: new Date(+now + s["checkin.alertBeforeMinutes"] * MIN) } },
    include: withShift,
  });
  for (const a of late) {
    if (!(await claim(a.id, "checkinAlertedAt", now))) continue;
    await notifyAdmins(prisma, {
      template: "checkin_missing_admin",
      title: `No check-in: ${a.provider.displayName} → ${a.shift.location.clinicOrg.displayName} at ${timeOf(a, a.startsAt)}`,
      body: `${a.provider.displayName} hasn't tapped "On my way" for today's shift. Consider calling them${a.provider.userId ? "" : ""}.`,
      link: `/admin/shifts/${a.shiftId}`,
    });
    await notifyClinic(prisma, a.shift.location.clinicOrgId, {
      template: "checkin_missing_clinic",
      title: "Your provider hasn't checked in yet",
      body: `${a.provider.displayName} hasn't confirmed they're on the way for ${timeOf(a, a.startsAt)}. We're contacting them now and will update you.`,
      link: `/clinic/shifts/${a.shiftId}`,
      sms: true,
    });
    await notify(prisma, a.provider.userId, {
      template: "checkin_urgent",
      title: `Are you on your way to ${a.shift.location.clinicOrg.displayName}?`,
      body: `Your shift starts at ${timeOf(a, a.startsAt)}. Tap "On my way" now, or contact us right away if you can't make it.`,
      link: `/c/${attendanceToken(a.id)}`,
      ctaLabel: "On my way",
      sms: true,
    });
    out.alerted++;
  }
  return out;
}

/** Missing reconfirmations repeatedly pauses the provider until an admin reactivates them. */
async function pauseIfRepeated(providerId: string, now: Date, limit: number, days: number) {
  const misses = await prisma.assignment.count({ where: { providerId, flags: { has: "RECONFIRM_MISSED" }, startsAt: { gte: new Date(+now - days * 24 * HOUR) } } });
  if (misses < limit) return;
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: providerId } });
  if (p.status !== "ACTIVE") return;
  await prisma.provider.update({ where: { id: providerId }, data: { status: "PAUSED" } });
  await audit(prisma, SYSTEM, "provider.paused_missed_reconfirmations", "Provider", providerId, { status: p.status }, { status: "PAUSED", misses });
  await prisma.adminTask.create({ data: { kind: "RECONFIRM_MISSES", title: `${p.displayName}: ${misses} missed shift reconfirmations — offers paused`, entityType: "Provider", entityId: providerId } });
  await notify(prisma, p.userId, {
    template: "provider_paused_reconfirm",
    title: "Your shift offers are paused",
    body: `You've missed ${misses} shift reconfirmations recently, so we've paused new offers. Contact us to get back on the schedule.`,
    link: "/provider",
    sms: true,
  });
}
