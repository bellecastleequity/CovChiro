/**
 * Arrival time ("On my way" ETA). After a provider taps On my way, their phone sends its position
 * while their page is open; the server turns it into a drive time and an arrival time for the
 * clinic. Only the arrival time and distance are kept, never the position. Pure rules here.
 */

export interface ArrivalSettings {
  /** Seconds between drive-time lookups for one booking. */
  updateSeconds: number;
  /** Text the clinic once when the provider is this many minutes away. */
  nearMinutes: number;
  /** Stop sharing this long after the start time (or at clock-in). */
  stopAfterStartMinutes: number;
}

export const ARRIVAL_DEFAULTS: ArrivalSettings = { updateSeconds: 120, nearMinutes: 5, stopAfterStartMinutes: 30 };

export interface ArrivalState {
  status: string;
  onMyWayAt: Date | null;
  arrivedAt: Date | null;
  startsAt: Date;
  etaUpdatedAt: Date | null;
  nearNotifiedAt: Date | null;
}

export function arrivalPlan(a: ArrivalState, now: Date, s: ArrivalSettings, drive?: { minutes: number; miles: number } | null) {
  const open =
    (a.status === "CONFIRMED" || a.status === "IN_PROGRESS") &&
    !!a.onMyWayAt &&
    !a.arrivedAt &&
    +now <= +a.startsAt + s.stopAfterStartMinutes * 60_000;
  const recheck = open && (!a.etaUpdatedAt || +now - +a.etaUpdatedAt >= s.updateSeconds * 1000);
  const etaAt = drive ? new Date(+now + Math.round(drive.minutes) * 60_000) : null;
  const notifyNear = open && !!drive && !a.nearNotifiedAt && drive.minutes <= s.nearMinutes;
  return { open, recheck, etaAt, notifyNear };
}
