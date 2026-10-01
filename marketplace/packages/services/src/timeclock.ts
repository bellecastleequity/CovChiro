import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@cm/config";
import { DomainError, hoursLabel, manualPunchProblem, milesBetween, PUNCH_LABEL, punchProblem, summarizeTimesheet, type Punch, type PunchKind } from "@cm/core";
import { prisma } from "@cm/db";
import { audit, clock, getSettings, SYSTEM, type Actor } from "./context";
import { openDispute } from "./lifecycle";
import { absoluteUrl, notify, notifyClinic } from "./notify";

/**
 * Time clock + timesheet sign-off (core/timeclock.ts has the rules).
 *  - Provider punches IN → lunch start → lunch end → OUT on their shift (server time; the phone's
 *    location, when shared, only flags punches far from the clinic). A missed punch can be added
 *    by hand with a note (flagged). Punching in marks the provider as arrived.
 *  - Punching out submits the day's timesheet; the clinic gets an email with a one-tap sign-off
 *    link (/t/<token>), can sign off in the portal, or a manager can sign on the provider's phone.
 *    Sign-off = typed name (+ optional drawn signature), time, IP and device.
 *  - "Something's wrong" opens the normal dispute (pay is held until an admin resolves it).
 *  - Job timeclockSweep: closes a timesheet with no punch-out timeclock.autoCloseHours after the
 *    scheduled end (flagged), reminds the clinic once, and approves automatically after
 *    timeclock.autoApproveHours with no dispute. Punches never change pay by themselves.
 */

const HOUR = 3_600_000;
const KINDS: PunchKind[] = ["IN", "BREAK_START", "BREAK_END", "OUT"];

// ---------------- one-tap sign-off link ----------------

function sign(assignmentId: string) {
  return createHmac("sha256", env().SESSION_SECRET ?? "dev-secret").update(`timesheet:${assignmentId}`).digest("base64url").slice(0, 22);
}
export const timesheetToken = (assignmentId: string) => `${assignmentId}.${sign(assignmentId)}`;
export function assignmentIdFromTimesheetToken(token: string): string | null {
  const [id, sig] = token.split(".");
  if (!id || !sig) return null;
  const want = Buffer.from(sign(id));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}
export const timesheetLink = (assignmentId: string) => absoluteUrl(`/t/${timesheetToken(assignmentId)}`);

// ---------------- loading ----------------

const withAll = { provider: true, shift: { include: { location: { include: { clinicOrg: true } } } }, punches: { orderBy: { at: "asc" as const } }, timesheet: true } as const;

async function load(assignmentId: string) {
  return prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, include: withAll });
}
type Loaded = Awaited<ReturnType<typeof load>>;

const toPunches = (rows: Loaded["punches"]): Punch[] => rows.map((p) => ({ kind: p.kind as PunchKind, at: p.at, manual: p.source === "MANUAL" || p.source === "ADMIN", auto: p.source === "AUTO", distanceMiles: p.distanceMiles }));

async function rules() {
  const s = await getSettings();
  return {
    s,
    window: (a: Loaded) => ({ startsAt: a.startsAt, endsAt: a.endsAt, earliestInMinutes: s["timeclock.earliestInMinutes"], latestHoursAfterEnd: s["timeclock.latestHoursAfterEnd"] }),
    summary: { lateGraceMinutes: s["timeclock.lateGraceMinutes"], farMiles: s["timeclock.farMiles"] },
  };
}

/** Recompute the timesheet totals and flags from the punches (creates the row on first use). */
async function refresh(assignmentId: string) {
  const a = await load(assignmentId);
  const r = await rules();
  const sum = summarizeTimesheet(toPunches(a.punches), { startsAt: a.startsAt, endsAt: a.endsAt }, r.summary);
  const data = { workedMinutes: sum.workedMinutes, breakMinutes: sum.breakMinutes, firstIn: sum.firstIn, lastOut: sum.lastOut, flags: sum.flags };
  return prisma.timesheet.upsert({ where: { assignmentId }, create: { assignmentId, ...data }, update: data });
}

const locked = (t: { status: string } | null) => !!t && (t.status === "APPROVED" || t.status === "DISPUTED");

function assertProvider(actor: Actor, a: { providerId: string }) {
  if (actor.role !== "PROVIDER" || actor.providerId !== a.providerId) throw new DomainError("NOT_FOUND", "Shift not found");
}
function assertClinic(actor: Actor, a: Loaded) {
  if ((actor.role !== "CLINIC_OWNER" && actor.role !== "CLINIC_STAFF") || actor.clinicOrgId !== a.shift.location.clinicOrgId) throw new DomainError("NOT_FOUND", "Shift not found");
}
const LIVE_STATUSES = ["CONFIRMED", "IN_PROGRESS", "COMPLETED"];

// ---------------- provider ----------------

/** A live punch from the provider's phone. */
export async function punch(actor: Actor, assignmentId: string, kind: PunchKind, geo?: { lat?: number | null; lng?: number | null; accuracyM?: number | null }) {
  if (!KINDS.includes(kind)) throw new DomainError("VALIDATION", "Unknown punch.");
  const a = await load(assignmentId);
  assertProvider(actor, a);
  const r = await rules();
  if (!r.s["timeclock.enabled"]) throw new DomainError("FORBIDDEN", "The time clock is turned off.");
  if (!LIVE_STATUSES.includes(a.status)) throw new DomainError("CONFLICT", "This shift is no longer booked to you.");
  if (locked(a.timesheet)) throw new DomainError("CONFLICT", "This timesheet has already been signed off.");
  const now = clock.now();
  const why = punchProblem(kind, toPunches(a.punches), now, r.window(a));
  if (why) throw new DomainError("VALIDATION", why);
  const hasGeo = typeof geo?.lat === "number" && typeof geo?.lng === "number" && Number.isFinite(geo.lat) && Number.isFinite(geo.lng);
  const distanceMiles = hasGeo && a.shift.location.lat != null && a.shift.location.lng != null ? Math.round(milesBetween({ lat: geo!.lat!, lng: geo!.lng! }, { lat: a.shift.location.lat, lng: a.shift.location.lng }) * 100) / 100 : null;
  await prisma.timePunch.create({
    data: { assignmentId, kind, at: now, source: "LIVE", lat: hasGeo ? geo!.lat : null, lng: hasGeo ? geo!.lng : null, accuracyM: hasGeo && geo!.accuracyM ? Math.round(geo!.accuracyM) : null, distanceMiles, createdById: actor.userId },
  });
  if (kind === "IN") await prisma.assignment.update({ where: { id: assignmentId }, data: { arrivedAt: a.arrivedAt ?? now, onMyWayAt: a.onMyWayAt ?? now } });
  await audit(prisma, actor, `timeclock.${kind.toLowerCase()}`, "Assignment", assignmentId, null, { at: now, distanceMiles });
  const t = await refresh(assignmentId);
  if (kind === "OUT") await submit(assignmentId);
  return { at: now, timesheet: t, distanceMiles };
}

/** A missed punch typed in afterwards (needs a note; flagged to the clinic). */
export async function addMissedPunch(actor: Actor, assignmentId: string, kind: PunchKind, at: Date, note: string) {
  const a = await load(assignmentId);
  assertProvider(actor, a);
  const r = await rules();
  if (locked(a.timesheet)) throw new DomainError("CONFLICT", "This timesheet has already been signed off.");
  if (note.trim().length < 3) throw new DomainError("VALIDATION", "Add a short note about the missed punch.");
  if (Number.isNaN(+at) || +at > +clock.now()) throw new DomainError("VALIDATION", "Enter a time that has already happened.");
  const why = manualPunchProblem(kind, at, toPunches(a.punches), r.window(a));
  if (why) throw new DomainError("VALIDATION", why);
  await prisma.timePunch.create({ data: { assignmentId, kind, at, source: "MANUAL", note: note.trim().slice(0, 300), createdById: actor.userId } });
  await audit(prisma, actor, "timeclock.manual_punch", "Assignment", assignmentId, null, { kind, at, note });
  await refresh(assignmentId);
  if (kind === "OUT") await submit(assignmentId);
}

export async function setProviderNote(actor: Actor, assignmentId: string, note: string) {
  const a = await load(assignmentId);
  assertProvider(actor, a);
  if (locked(a.timesheet)) throw new DomainError("CONFLICT", "This timesheet has already been signed off.");
  await refresh(assignmentId);
  await prisma.timesheet.update({ where: { assignmentId }, data: { providerNote: note.trim().slice(0, 500) || null } });
}

/** Punched out (or closed by the sweep): ask the clinic to sign off. Once only. */
async function submit(assignmentId: string, now = clock.now()) {
  const claimed = await prisma.timesheet.updateMany({ where: { assignmentId, status: "OPEN" }, data: { status: "SUBMITTED", submittedAt: now } });
  if (!claimed.count) return;
  const a = await load(assignmentId);
  const t = a.timesheet!;
  const tz = a.shift.location.timeZone;
  const time = (d: Date | null) => (d ? d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }) : "—");
  await notifyClinic(prisma, a.shift.location.clinicOrgId, {
    template: "timesheet_submitted",
    title: `Please sign off ${a.provider.displayName}'s timesheet`,
    body: `${a.shift.location.name}, ${a.startsAt.toLocaleDateString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric" })}: in ${time(t.firstIn)}, out ${time(t.lastOut)}, lunch ${hoursLabel(t.breakMinutes)}, worked ${hoursLabel(t.workedMinutes)}.${t.flags.length ? ` Note: ${t.flags.join("; ")}.` : ""}`,
    details: ["One tap to approve, or tell us if something's wrong. If we don't hear back it's approved automatically."],
    link: timesheetLink(assignmentId),
    ctaLabel: "Review & sign off",
  }).catch((e) => console.error("timesheet notice failed", e));
}

// ---------------- sign-off ----------------

export interface SignOff {
  approverName: string;
  approverTitle?: string | null;
  signature?: string | null;
  note?: string | null;
  ip?: string | null;
  device?: string | null;
}

function cleanSignature(sig: string | null | undefined) {
  if (!sig) return null;
  if (!/^data:image\/png;base64,[A-Za-z0-9+/=]+$/.test(sig) || sig.length > 250_000) throw new DomainError("VALIDATION", "The signature couldn't be read. Please sign again.");
  return sig;
}

async function approve(assignmentId: string, method: "PORTAL" | "EMAIL_LINK" | "ONSITE" | "AUTO" | "ADMIN", by: SignOff & { userId?: string | null }, actor: Actor) {
  const name = by.approverName.trim();
  if (method !== "AUTO" && name.length < 2) throw new DomainError("VALIDATION", "Type the manager's full name.");
  const signature = cleanSignature(by.signature);
  if (method === "ONSITE" && !signature) throw new DomainError("VALIDATION", "The manager needs to sign in the box.");
  const t = await prisma.timesheet.findUnique({ where: { assignmentId } });
  if (!t || t.status === "OPEN") throw new DomainError("CONFLICT", "The provider hasn't punched out yet.");
  if (t.status !== "SUBMITTED") throw new DomainError("CONFLICT", t.status === "APPROVED" ? "This timesheet is already signed off." : "A problem was reported on this timesheet; an admin is reviewing it.");
  const r = await prisma.timesheet.updateMany({
    where: { assignmentId, status: "SUBMITTED" },
    data: {
      status: "APPROVED", approvalMethod: method, approvedAt: clock.now(), approvedByUserId: by.userId ?? null, approverName: name || null, approverTitle: by.approverTitle?.trim().slice(0, 80) || null,
      signature, approverIp: by.ip?.slice(0, 64) || null, approverDevice: by.device?.slice(0, 300) || null, clinicNote: by.note?.trim().slice(0, 500) || null,
    },
  });
  if (!r.count) throw new DomainError("CONFLICT", "This timesheet was just updated. Refresh and try again.");
  await audit(prisma, actor, "timesheet.approved", "Assignment", assignmentId, null, { method, approverName: name, ip: by.ip });
  return method;
}

/** Clinic user in the portal. */
export async function approveAsClinic(actor: Actor, assignmentId: string, by: SignOff) {
  const a = await load(assignmentId);
  assertClinic(actor, a);
  return approve(assignmentId, "PORTAL", { ...by, userId: actor.userId }, actor);
}

/** Anyone with the emailed link (it covers this one timesheet). */
export async function approveByToken(token: string, by: SignOff) {
  const id = assignmentIdFromTimesheetToken(token);
  if (!id) throw new DomainError("NOT_FOUND", "This link isn't valid.");
  return approve(id, "EMAIL_LINK", by, SYSTEM);
}

/** A manager signing on the provider's phone. The clinic gets a copy and can still report a problem. */
export async function approveOnsite(actor: Actor, assignmentId: string, by: SignOff) {
  const a = await load(assignmentId);
  assertProvider(actor, a);
  if (!(await getSettings())["timeclock.allowOnsiteSignature"]) throw new DomainError("FORBIDDEN", "On-site signing is turned off; the clinic will sign off by email.");
  await approve(assignmentId, "ONSITE", by, actor);
  await notifyClinic(prisma, a.shift.location.clinicOrgId, {
    template: "timesheet_signed_onsite",
    title: `Timesheet signed on site by ${by.approverName.trim()}`,
    body: `${a.provider.displayName}'s timesheet for ${a.shift.location.name} was signed on their phone by ${by.approverName.trim()}. If that isn't right, report it within the dispute window.`,
    link: timesheetLink(assignmentId),
    ctaLabel: "View timesheet",
  }).catch(() => undefined);
}

export async function approveAsAdmin(actor: Actor, assignmentId: string, note: string) {
  if (actor.role !== "PLATFORM_ADMIN") throw new DomainError("FORBIDDEN", "Admins only.");
  return approve(assignmentId, "ADMIN", { approverName: "Platform admin", note }, actor);
}

/** "Something's wrong": opens a dispute (pay held until an admin resolves it). */
async function report(assignmentId: string, actor: Actor, reason: string) {
  if (reason.trim().length < 5) throw new DomainError("VALIDATION", "Tell us briefly what's wrong.");
  const d = await openDispute(actor, assignmentId, `Timesheet: ${reason.trim()}`);
  await prisma.timesheet.upsert({ where: { assignmentId }, create: { assignmentId, status: "DISPUTED", disputeId: d.id }, update: { status: "DISPUTED", disputeId: d.id, clinicNote: reason.trim().slice(0, 500) } });
  return d;
}
export async function reportAsClinic(actor: Actor, assignmentId: string, reason: string) {
  const a = await load(assignmentId);
  assertClinic(actor, a);
  return report(assignmentId, actor, reason);
}
export async function reportByToken(token: string, reason: string) {
  const id = assignmentIdFromTimesheetToken(token);
  if (!id) throw new DomainError("NOT_FOUND", "This link isn't valid.");
  const a = await load(id);
  return report(id, { userId: null, role: "CLINIC_OWNER", clinicOrgId: a.shift.location.clinicOrgId, providerId: null }, reason);
}

// ---------------- views ----------------

export async function timesheetView(assignmentId: string) {
  const a = await load(assignmentId);
  const s = await getSettings();
  const t = a.timesheet ?? (a.punches.length ? await refresh(assignmentId) : null);
  return {
    assignmentId,
    providerName: a.provider.displayName,
    locationName: a.shift.location.name,
    clinicName: a.shift.location.clinicOrg.displayName,
    timeZone: a.shift.location.timeZone,
    startsAt: a.startsAt,
    endsAt: a.endsAt,
    status: t?.status ?? "OPEN",
    timesheet: t,
    punches: a.punches.map((p) => ({ id: p.id, kind: p.kind as PunchKind, label: PUNCH_LABEL[p.kind as PunchKind], at: p.at, source: p.source, note: p.note, distanceMiles: p.distanceMiles })),
    enabled: s["timeclock.enabled"],
    allowOnsite: s["timeclock.allowOnsiteSignature"],
    farMiles: s["timeclock.farMiles"],
  };
}

export async function timesheetForProvider(actor: Actor, assignmentId: string) {
  const a = await prisma.assignment.findUniqueOrThrow({ where: { id: assignmentId }, select: { providerId: true } });
  assertProvider(actor, a);
  return timesheetView(assignmentId);
}
export async function timesheetForClinic(actor: Actor, assignmentId: string) {
  assertClinic(actor, await load(assignmentId));
  return timesheetView(assignmentId);
}
export async function timesheetByToken(token: string) {
  const id = assignmentIdFromTimesheetToken(token);
  return id ? timesheetView(id) : null;
}

/** Today's (or the current) shift for the provider dashboard's clock card. */
export async function currentShiftForClock(providerId: string) {
  const s = await getSettings();
  if (!s["timeclock.enabled"]) return null;
  const now = clock.now();
  const a = await prisma.assignment.findFirst({
    where: {
      providerId, status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] },
      startsAt: { lte: new Date(+now + s["timeclock.earliestInMinutes"] * 60_000) },
      endsAt: { gte: new Date(+now - s["timeclock.latestHoursAfterEnd"] * HOUR) },
      OR: [{ timesheet: null }, { timesheet: { status: { in: ["OPEN", "SUBMITTED"] } } }],
    },
    orderBy: { startsAt: "asc" },
    select: { id: true },
  });
  return a ? timesheetView(a.id) : null;
}

/** Timesheets waiting for this clinic's sign-off. */
export async function pendingForClinic(actor: Actor) {
  if ((actor.role !== "CLINIC_OWNER" && actor.role !== "CLINIC_STAFF") || !actor.clinicOrgId) return [];
  return prisma.timesheet.findMany({
    where: { status: "SUBMITTED", assignment: { shift: { location: { clinicOrgId: actor.clinicOrgId } } } },
    include: { assignment: { include: { provider: true, shift: { include: { location: true } } } } },
    orderBy: { submittedAt: "asc" },
  });
}

export async function adminTimesheets(actor: Actor, status?: string) {
  if (actor.role !== "PLATFORM_ADMIN") throw new DomainError("FORBIDDEN", "Admins only.");
  const [rows, counts] = await Promise.all([
    prisma.timesheet.findMany({
      where: status ? { status } : {},
      include: { assignment: { include: { provider: true, shift: { include: { location: { include: { clinicOrg: true } } } }, punches: { orderBy: { at: "asc" } } } } },
      orderBy: { updatedAt: "desc" },
      take: 200,
    }),
    prisma.timesheet.groupBy({ by: ["status"], _count: true }),
  ]);
  return { rows, counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) as Record<string, number> };
}

// ---------------- sweep ----------------

/** Job (every 15 min): close forgotten punch-outs, remind clinics once, auto-approve. */
export async function timeclockSweep(now = clock.now()) {
  const s = await getSettings();
  if (!s["timeclock.enabled"]) return { closed: 0, reminded: 0, approved: 0 };
  let closed = 0;
  let reminded = 0;
  let approved = 0;

  // 1. No punch-out: close at the later of the scheduled end and the last punch (flagged). Shifts with
  //    no punches at all still get a timesheet so the clinic confirms the day happened.
  const due = await prisma.assignment.findMany({
    where: {
      status: { in: ["IN_PROGRESS", "COMPLETED"] },
      endsAt: { lte: new Date(+now - s["timeclock.autoCloseHours"] * HOUR), gte: new Date(+now - 7 * 24 * HOUR) },
      OR: [{ timesheet: null }, { timesheet: { status: "OPEN" } }],
    },
    include: { punches: { orderBy: { at: "asc" } } },
    take: 200,
  });
  for (const a of due) {
    const last = a.punches.at(-1);
    if (last && last.kind !== "OUT") {
      const at = new Date(Math.max(+a.endsAt, +last.at));
      if (last.kind === "BREAK_START") await prisma.timePunch.create({ data: { assignmentId: a.id, kind: "BREAK_END", at, source: "AUTO", note: "Clock closed automatically" } });
      await prisma.timePunch.create({ data: { assignmentId: a.id, kind: "OUT", at, source: "AUTO", note: "No punch-out: closed at the scheduled end" } });
    }
    const t = await refresh(a.id);
    if (!a.punches.length && !t.flags.includes("no punches recorded")) await prisma.timesheet.update({ where: { id: t.id }, data: { flags: ["no punches recorded", ...t.flags.filter((f) => f !== "no punch-in")] } });
    await submit(a.id, now);
    closed++;
  }

  // 2. One reminder to the clinic.
  const remind = await prisma.timesheet.findMany({ where: { status: "SUBMITTED", remindedAt: null, submittedAt: { lte: new Date(+now - s["timeclock.clinicReminderHours"] * HOUR) } }, include: { assignment: { include: { provider: true, shift: { include: { location: true } } } } }, take: 200 });
  for (const t of remind) {
    const r = await prisma.timesheet.updateMany({ where: { id: t.id, remindedAt: null }, data: { remindedAt: now } });
    if (!r.count) continue;
    await notifyClinic(prisma, t.assignment.shift.location.clinicOrgId, {
      template: "timesheet_reminder",
      title: `Reminder: sign off ${t.assignment.provider.displayName}'s timesheet`,
      body: `It's approved automatically ${s["timeclock.autoApproveHours"]} hours after it was sent if we don't hear from you.`,
      link: timesheetLink(t.assignmentId),
      ctaLabel: "Review & sign off",
    }).catch(() => undefined);
    reminded++;
  }

  // 3. Auto-approve when nobody objected.
  const stale = await prisma.timesheet.findMany({
    where: { status: "SUBMITTED", submittedAt: { lte: new Date(+now - s["timeclock.autoApproveHours"] * HOUR) }, assignment: { disputes: { none: { status: "OPEN" } } } },
    select: { assignmentId: true },
    take: 500,
  });
  for (const t of stale) {
    await approve(t.assignmentId, "AUTO", { approverName: "" }, SYSTEM).then(() => approved++).catch(() => undefined);
  }
  return { closed, reminded, approved };
}

/** Provider-visible label for each status. */
export const TIMESHEET_STATUS: Record<string, string> = { OPEN: "On the clock", SUBMITTED: "Waiting for clinic sign-off", APPROVED: "Signed off", DISPUTED: "Problem reported: under review" };
