import { DateTime } from "luxon";

/**
 * Standing bookings (services/standing.ts): a clinic and a provider on a weekly pattern.
 * Editing one (owner, Oct 2026: ramp a practice from 1 to 5 afternoons a week as volume grows)
 * changes the provider's schedule, so it needs their consent, except notes or a later end date.
 */
export interface StandingPattern {
  /** 1 = Monday … 7 = Sunday. */
  weekdays: number[];
  /** Local "HH:MM". */
  startTime: string;
  endTime: string;
  /** Last day (ISO date) or null = open-ended. */
  endsOn: string | null;
}

const sameDays = (a: number[], b: number[]) => [...new Set(a)].sort().join() === [...new Set(b)].sort().join();

/** Does a change need the provider to accept it? Notes and a later (or kept) end date don't. */
export function standingChangeNeedsConsent(from: StandingPattern, to: StandingPattern): boolean {
  if (!sameDays(from.weekdays, to.weekdays) || from.startTime !== to.startTime || from.endTime !== to.endTime) return true;
  if (to.endsOn === from.endsOn) return false;
  if (to.endsOn === null) return false; // open-ended again: more work, never less
  if (from.endsOn === null) return true; // an end date where there was none
  return to.endsOn < from.endsOn; // ending earlier
}

/** Is an already-booked standing shift still part of the pattern (local weekday, hours, end date)? */
export function standingShiftFits(p: StandingPattern, tz: string, startsAt: Date, endsAt: Date): boolean {
  const s = DateTime.fromJSDate(startsAt, { zone: tz });
  const e = DateTime.fromJSDate(endsAt, { zone: tz });
  if (!p.weekdays.includes(s.weekday)) return false;
  if (s.toFormat("HH:mm") !== p.startTime || e.toFormat("HH:mm") !== p.endTime) return false;
  return !p.endsOn || s.toISODate()! <= p.endsOn;
}
