/**
 * Provider active status. A ready provider stays active while something shows they still want
 * shifts: a completed shift, an application, an accepted offer or invitation, an upcoming booking,
 * or tapping "I'm still available". Logging in alone doesn't count. After `pauseAfterDays` with
 * none of that, they're put on an (inactivity) break; reminders go out on `reminderDays` before.
 * Providers on a break they chose and providers whose market isn't open yet are skipped.
 */

export interface ActivitySettings {
  enabled: boolean;
  pauseAfterDays: number;
  /** Days since the last activity when a reminder goes out, e.g. [23, 28]. */
  reminderDays: number[];
}

export const ACTIVITY_DEFAULTS: ActivitySettings = { enabled: true, pauseAfterDays: 30, reminderDays: [23, 28] };

export interface ActivityFacts {
  /** Latest sign of interest (completed shift, application, acceptance, "I'm still available", approval, market opening). */
  lastActivity: Date;
  hasUpcomingBooking: boolean;
  inOpenMarket: boolean;
  onBreak: boolean;
}

export type ActivityAction = { kind: "none" } | { kind: "remind"; day: number; pauseAt: Date } | { kind: "pause" };

const DAY = 86_400_000;

export function activityAction(f: ActivityFacts, now: Date, s: ActivitySettings): ActivityAction {
  if (!s.enabled || f.onBreak || !f.inOpenMarket || f.hasUpcomingBooking) return { kind: "none" };
  const idleDays = Math.floor((+now - +f.lastActivity) / DAY);
  if (idleDays > s.pauseAfterDays) return { kind: "pause" };
  const due = [...s.reminderDays].filter((d) => d <= idleDays && d <= s.pauseAfterDays).sort((a, b) => b - a)[0];
  return due !== undefined ? { kind: "remind", day: due, pauseAt: new Date(+f.lastActivity + (s.pauseAfterDays + 1) * DAY) } : { kind: "none" };
}
