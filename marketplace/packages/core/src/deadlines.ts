import type { DeadlineTier } from "@cm/config";
import { HOUR, MINUTE } from "./time";

/** Selection deadline and offer windows by lead time at posting (SPEC §7.4). */

export function tierForLeadTime(tiers: DeadlineTier[], leadHours: number): DeadlineTier {
  const sorted = [...tiers].sort((a, b) => b.minLeadHours - a.minLeadHours);
  return sorted.find((t) => leadHours >= t.minLeadHours) ?? sorted[sorted.length - 1];
}

export function isUrgent(postedAt: Date, startsAt: Date): boolean {
  return (+startsAt - +postedAt) / HOUR < 48;
}

/**
 * Deadline = posted + tier window, capped so that at least 3 cascade rounds
 * fit before startsAt − 2h. Never earlier than postedAt.
 */
export function selectionDeadline(tiers: DeadlineTier[], postedAt: Date, startsAt: Date): { deadline: Date; tier: DeadlineTier } {
  const leadHours = (+startsAt - +postedAt) / HOUR;
  const tier = tierForLeadTime(tiers, leadHours);
  const wanted = +postedAt + tier.selectionWindowHours * HOUR;
  const latest = +startsAt - 2 * HOUR - 3 * tier.offerWindowMinutes * MINUTE;
  return { deadline: new Date(Math.max(+postedAt, Math.min(wanted, latest))), tier };
}

/** Favorites window applies only with ≥48h lead and at least one eligible favorite. */
export function favoritesWindowEnd(postedAt: Date, startsAt: Date, eligibleFavorites: number, windowHours: number): Date | null {
  if (eligibleFavorites < 1 || isUrgent(postedAt, startsAt)) return null;
  return new Date(+postedAt + windowHours * HOUR);
}

export function minPostingLeadOk(now: Date, startsAt: Date): boolean {
  return +startsAt - +now >= 2 * HOUR;
}
