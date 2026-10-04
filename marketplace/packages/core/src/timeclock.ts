/**
 * Time clock (pure rules). A day's punches: IN → (BREAK_START → BREAK_END)* → OUT.
 * The server stamps every punch with its own time; the phone's location is optional and only
 * used to flag punches made far from the clinic. Timesheet totals and flags come from here;
 * flags are shown to the clinic when it signs off, they never change pay by themselves
 * (pay comes from the rate engine; a wrong timesheet goes through a dispute).
 */

export type PunchKind = "IN" | "BREAK_START" | "BREAK_END" | "OUT";
export interface Punch {
  kind: PunchKind;
  at: Date;
  /** Typed in later by the provider (missed punch) or set by an admin / the system. */
  manual?: boolean;
  auto?: boolean;
  distanceMiles?: number | null;
}

export type ClockState = "NOT_STARTED" | "ON_CLOCK" | "ON_BREAK" | "DONE";

export function clockState(punches: Punch[]): ClockState {
  const last = sorted(punches).at(-1);
  if (!last) return "NOT_STARTED";
  return last.kind === "OUT" ? "DONE" : last.kind === "BREAK_START" ? "ON_BREAK" : "ON_CLOCK";
}

/** What can be punched next. */
export function nextPunches(punches: Punch[]): PunchKind[] {
  switch (clockState(punches)) {
    case "NOT_STARTED":
      return ["IN"];
    case "ON_CLOCK":
      return ["BREAK_START", "OUT"];
    case "ON_BREAK":
      return ["BREAK_END"];
    default:
      return [];
  }
}

export interface PunchWindow {
  startsAt: Date;
  endsAt: Date;
  /** Earliest punch-in, minutes before the scheduled start. */
  earliestInMinutes: number;
  /** Latest punch of any kind, hours after the scheduled end. */
  latestHoursAfterEnd: number;
}

/** Why a live punch isn't allowed now (null = allowed). */
export function punchProblem(kind: PunchKind, punches: Punch[], now: Date, w: PunchWindow): string | null {
  if (!nextPunches(punches).includes(kind)) {
    const st = clockState(punches);
    return st === "DONE" ? "You've already punched out for this shift." : st === "ON_BREAK" ? "End your lunch first." : st === "NOT_STARTED" ? "Punch in first." : "That punch doesn't fit here.";
  }
  if (kind === "IN" && +now < +w.startsAt - w.earliestInMinutes * 60_000) return `You can punch in from ${w.earliestInMinutes} minutes before the shift starts.`;
  if (+now > +w.endsAt + w.latestHoursAfterEnd * 3_600_000) return "This shift's time clock has closed. Add the missed times with a note instead.";
  const last = sorted(punches).at(-1);
  if (last && +now < +last.at) return "That's earlier than your last punch.";
  return null;
}

/** A missed punch typed in afterwards must fit between its neighbours and stay near the shift. */
export function manualPunchProblem(kind: PunchKind, at: Date, punches: Punch[], w: PunchWindow): string | null {
  if (!nextPunches(punches).includes(kind)) return "Add punches in order: in, lunch start, lunch end, out.";
  const last = sorted(punches).at(-1);
  if (last && +at <= +last.at) return "That time is before your previous punch.";
  if (+at < +w.startsAt - 3 * 3_600_000 || +at > +w.endsAt + w.latestHoursAfterEnd * 3_600_000) return "That time is too far from the scheduled shift.";
  return null;
}

export interface TimesheetSummary {
  firstIn: Date | null;
  lastOut: Date | null;
  workedMinutes: number;
  breakMinutes: number;
  flags: string[];
}

export function summarizeTimesheet(punches: Punch[], scheduled: { startsAt: Date; endsAt: Date }, rules: { lateGraceMinutes: number; farMiles: number }): TimesheetSummary {
  const ps = sorted(punches);
  const flags: string[] = [];
  let worked = 0;
  let breaks = 0;
  let onSince: Date | null = null;
  let breakSince: Date | null = null;
  for (const p of ps) {
    if (p.kind === "IN" || p.kind === "BREAK_END") {
      if (p.kind === "BREAK_END" && breakSince) breaks += +p.at - +breakSince;
      breakSince = null;
      onSince = p.at;
    } else if (p.kind === "BREAK_START" || p.kind === "OUT") {
      if (onSince) worked += +p.at - +onSince;
      onSince = null;
      if (p.kind === "BREAK_START") breakSince = p.at;
    }
  }
  const firstIn = ps.find((p) => p.kind === "IN")?.at ?? null;
  const out = ps.find((p) => p.kind === "OUT");
  const mins = (ms: number) => Math.round(ms / 60_000);
  if (!firstIn) flags.push("no punch-in");
  else {
    const late = mins(+firstIn - +scheduled.startsAt);
    if (late > rules.lateGraceMinutes) flags.push(`punched in ${late} min late`);
  }
  if (out) {
    const early = mins(+scheduled.endsAt - +out.at);
    if (early > rules.lateGraceMinutes) flags.push(`punched out ${early} min early`);
  }
  if (out?.auto) flags.push("no punch-out: closed at the scheduled end");
  if (ps.some((p) => p.manual)) flags.push("times added by hand");
  const far = ps.filter((p) => p.distanceMiles != null && p.distanceMiles > rules.farMiles);
  if (far.length) flags.push(`punched ${Math.max(...far.map((p) => p.distanceMiles!)).toFixed(1)} mi from the clinic`);
  return { firstIn, lastOut: out?.at ?? null, workedMinutes: mins(worked), breakMinutes: mins(breaks), flags };
}

export function hoursLabel(minutes: number): string {
  const h = Math.floor(minutes / 60);
  const m = minutes % 60;
  return h ? `${h}h ${String(m).padStart(2, "0")}m` : `${m}m`;
}

/** Great-circle distance in miles. */
export function milesBetween(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 3958.8;
  const rad = (d: number) => (d * Math.PI) / 180;
  const dLat = rad(b.lat - a.lat);
  const dLng = rad(b.lng - a.lng);
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(rad(a.lat)) * Math.cos(rad(b.lat)) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.sqrt(h));
}

function sorted(ps: Punch[]) {
  return [...ps].sort((a, b) => +a.at - +b.at);
}

export const PUNCH_LABEL: Record<PunchKind, string> = { IN: "Punched in", BREAK_START: "Lunch start", BREAK_END: "Lunch end", OUT: "Punched out" };

/**
 * Punch reminders: which nudges are due now (each is sent once by the caller).
 * Clock in once the shift has started; start lunch once the planned lunch has begun and they're
 * still on the clock; back from lunch once it should have ended and they're still on break; clock
 * out once the shift has ended. `afterMinutes` of slack each time; nothing older than `staleHours`.
 */
export function punchRemindersDue(
  punches: Punch[],
  shift: { startsAt: Date; endsAt: Date; lunchStartsAt?: Date | null; lunchMinutes?: number | null },
  now: Date,
  opts: { afterMinutes: number; staleHours?: number },
): PunchKind[] {
  const after = opts.afterMinutes * 60_000;
  const stale = (opts.staleHours ?? 3) * 3_600_000;
  const t = +now;
  const due = (at: number, until: number) => t >= at + after && t < Math.min(until, at + stale);
  const state = clockState(punches);
  const out: PunchKind[] = [];
  if (state === "NOT_STARTED" && due(+shift.startsAt, +shift.endsAt)) out.push("IN");
  const lunchStart = shift.lunchMinutes && shift.lunchStartsAt ? +shift.lunchStartsAt : null;
  if (lunchStart !== null) {
    const lunchEnd = lunchStart + shift.lunchMinutes! * 60_000;
    // A break already taken around lunch time counts.
    const tookLunch = punches.some((p) => p.kind === "BREAK_START" && +p.at >= lunchStart - 60 * 60_000);
    if (state === "ON_CLOCK" && !tookLunch && due(lunchStart, lunchEnd)) out.push("BREAK_START");
    if (state === "ON_BREAK" && due(lunchEnd, +shift.endsAt)) out.push("BREAK_END");
  }
  if ((state === "ON_CLOCK" || state === "ON_BREAK") && due(+shift.endsAt, Infinity)) out.push("OUT");
  return out;
}
