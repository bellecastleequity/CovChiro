import { DateTime } from "luxon";

/** Half-open interval [start, end) in epoch milliseconds. */
export interface Interval {
  start: number;
  end: number;
}

export const MINUTE = 60_000;
export const HOUR = 60 * MINUTE;
export const DAY = 24 * HOUR;

export function iv(start: Date | number, end: Date | number): Interval {
  return { start: +start, end: +end };
}

export function overlaps(a: Interval, b: Interval): boolean {
  return a.start < b.end && b.start < a.end;
}

/** Union of intervals, sorted, with touching/overlapping ones merged. */
export function mergeIntervals(list: Interval[]): Interval[] {
  const sorted = list.filter((i) => i.end > i.start).sort((a, b) => a.start - b.start);
  const out: Interval[] = [];
  for (const i of sorted) {
    const last = out[out.length - 1];
    if (last && i.start <= last.end) last.end = Math.max(last.end, i.end);
    else out.push({ ...i });
  }
  return out;
}

export function containedInUnion(target: Interval, list: Interval[]): boolean {
  return mergeIntervals(list).some((i) => i.start <= target.start && i.end >= target.end);
}

export interface WeeklyRule {
  weekday: number; // 0=Sun..6=Sat
  startMin: number; // minutes from local midnight
  endMin: number; // up to 1440
  timeZone: string;
}

/** Expand weekly rules into concrete intervals that could touch `window`. */
export function expandWeeklyRules(rules: WeeklyRule[], window: Interval): Interval[] {
  const out: Interval[] = [];
  for (const r of rules) {
    let day = DateTime.fromMillis(window.start - DAY, { zone: r.timeZone }).startOf("day");
    const stop = window.end + DAY;
    while (+day <= stop) {
      // luxon weekday: 1=Mon..7=Sun
      if (day.weekday % 7 === r.weekday) {
        const s = day.plus({ minutes: r.startMin });
        const e = day.plus({ minutes: r.endMin });
        out.push({ start: +s, end: +e });
      }
      day = day.plus({ days: 1 }).startOf("day");
    }
  }
  return out;
}

export function hoursBetween(a: Date | number, b: Date | number): number {
  return (+b - +a) / HOUR;
}

/** Weekday (0=Sun..6=Sat) and ISO date of an instant in a zone. */
export function localParts(at: Date | number, timeZone: string) {
  const d = DateTime.fromMillis(+at, { zone: timeZone });
  return { weekday: d.weekday % 7, isoDate: d.toISODate()!, year: d.year, month: d.month, day: d.day };
}
