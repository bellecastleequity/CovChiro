import { DateTime } from "luxon";

/** instagram.com paths that are never a profile. */
const RESERVED = new Set(["p", "reel", "reels", "tv", "explore", "accounts", "stories", "direct", "about", "developer", "legal", "web", "share", "s", "invites"]);

/** The profile handle in an Instagram URL (lower-case, no @), or null for posts, reels, system pages and other sites. */
export function instagramHandle(url: string): string | null {
  let u: URL;
  try {
    u = new URL(/^https?:\/\//i.test(url) ? url : `https://${url}`);
  } catch {
    return null;
  }
  if (!/(^|\.)instagram\.com$/i.test(u.hostname)) return null;
  const first = u.pathname.split("/").filter(Boolean)[0]?.replace(/^@/, "") ?? "";
  if (!first || RESERVED.has(first.toLowerCase())) return null;
  return /^[A-Za-z0-9._]{1,30}$/.test(first) ? first.toLowerCase() : null;
}

export function instagramHandleFrom(urls: string[]): string | null {
  for (const u of urls) {
    const h = instagramHandle(u);
    if (h) return h;
  }
  return null;
}

export interface FollowPaceRules {
  perDay: number;
  perWindow: number;
  windowMinutes: number;
  /** Active hours, local "HH:MM". */
  start: string;
  end: string;
  timeZone: string;
}

/**
 * How many follows can be done right now under a human-looking pace:
 * at most perWindow in any windowMinutes, perDay per local day, only between
 * start and end. Follows are made by a person in Instagram; this only paces them.
 */
export function followPace(followedAt: Date[], now: Date, r: FollowPaceRules): { readyNow: number; today: number; nextAt: Date | null; reason: "ok" | "window" | "daily_cap" | "outside_hours" } {
  const local = DateTime.fromJSDate(now, { zone: r.timeZone });
  const at = (day: DateTime, hhmm: string) => {
    const [h, m] = hhmm.split(":").map(Number);
    return day.set({ hour: h, minute: m, second: 0, millisecond: 0 });
  };
  const open = at(local, r.start), close = at(local, r.end);
  const today = followedAt.filter((d) => DateTime.fromJSDate(d, { zone: r.timeZone }).toISODate() === local.toISODate()).length;
  const tomorrowOpen = at(local.plus({ days: 1 }), r.start).toJSDate();
  if (local < open) return { readyNow: 0, today, nextAt: open.toJSDate(), reason: "outside_hours" };
  if (local >= close) return { readyNow: 0, today, nextAt: tomorrowOpen, reason: "outside_hours" };
  const leftToday = Math.max(0, r.perDay - today);
  if (!leftToday) return { readyNow: 0, today, nextAt: tomorrowOpen, reason: "daily_cap" };
  const windowMs = r.windowMinutes * 60_000;
  const recent = followedAt.filter((d) => +now - +d < windowMs).sort((a, b) => +a - +b);
  const leftWindow = Math.max(0, r.perWindow - recent.length);
  if (!leftWindow) return { readyNow: 0, today, nextAt: new Date(+recent[recent.length - r.perWindow] + windowMs), reason: "window" };
  return { readyNow: Math.min(leftWindow, leftToday), today, nextAt: null, reason: "ok" };
}
