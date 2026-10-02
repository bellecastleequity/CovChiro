import { randomBytes } from "node:crypto";
import { brand } from "@cm/config";
import { prisma } from "@cm/db";
import { clock } from "./context";
import { absoluteUrl } from "./notify";

/**
 * Private calendar feeds (iCalendar). Each person gets a secret URL (/api/calendar/<token>.ics)
 * that Google, Apple or Outlook subscribe to: providers see their booked shifts, clinics their
 * posted and booked shifts. Shifts that are cancelled drop out of the feed, so they disappear from
 * the calendar on its next refresh. Resetting the token breaks old subscriptions.
 */

export async function calendarToken(userId: string) {
  const u = await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { calendarToken: true } });
  if (u.calendarToken) return u.calendarToken;
  const token = randomBytes(24).toString("hex");
  await prisma.user.updateMany({ where: { id: userId, calendarToken: null }, data: { calendarToken: token } });
  return (await prisma.user.findUniqueOrThrow({ where: { id: userId }, select: { calendarToken: true } })).calendarToken!;
}

export async function resetCalendarToken(userId: string) {
  await prisma.user.update({ where: { id: userId }, data: { calendarToken: randomBytes(24).toString("hex") } });
  return calendarToken(userId);
}

export async function calendarLinks(userId: string) {
  const https = absoluteUrl(`/api/calendar/${await calendarToken(userId)}.ics`);
  return { https, webcal: https.replace(/^https?:/, "webcal:"), google: `https://calendar.google.com/calendar/render?cid=${encodeURIComponent(https.replace(/^https?:/, "webcal:"))}` };
}

// ---------------- iCalendar text ----------------

const esc = (s: string) => s.replace(/\\/g, "\\\\").replace(/;/g, "\\;").replace(/,/g, "\\,").replace(/\r?\n/g, "\\n");
const utc = (d: Date) => d.toISOString().replace(/[-:]/g, "").replace(/\.\d{3}/, "");

/** Fold to 75 octets per RFC 5545. */
function fold(line: string): string {
  const bytes = Buffer.from(line, "utf8");
  if (bytes.length <= 75) return line;
  const parts: string[] = [];
  let cur = "";
  for (const ch of line) {
    if (Buffer.byteLength(cur + ch, "utf8") > (parts.length ? 74 : 75)) {
      parts.push(cur);
      cur = "";
    }
    cur += ch;
  }
  parts.push(cur);
  return parts.join("\r\n ");
}

interface Ev {
  uid: string;
  start: Date;
  end: Date;
  summary: string;
  location?: string;
  description?: string;
  url?: string;
  updated: Date;
}

export function toIcs(name: string, events: Ev[], now = clock.now()): string {
  const lines = ["BEGIN:VCALENDAR", "VERSION:2.0", `PRODID:-//${esc(brand().name)}//Coverage//EN`, "CALSCALE:GREGORIAN", "METHOD:PUBLISH", `X-WR-CALNAME:${esc(name)}`, "X-PUBLISHED-TTL:PT1H", "REFRESH-INTERVAL;VALUE=DURATION:PT1H"];
  for (const e of events) {
    lines.push(
      "BEGIN:VEVENT",
      `UID:${e.uid}@${new URL(absoluteUrl("/")).host}`,
      `DTSTAMP:${utc(now)}`,
      `LAST-MODIFIED:${utc(e.updated)}`,
      `DTSTART:${utc(e.start)}`,
      `DTEND:${utc(e.end)}`,
      `SUMMARY:${esc(e.summary)}`,
      ...(e.location ? [`LOCATION:${esc(e.location)}`] : []),
      ...(e.description ? [`DESCRIPTION:${esc(e.description)}`] : []),
      ...(e.url ? [`URL:${e.url}`] : []),
      "END:VEVENT",
    );
  }
  lines.push("END:VCALENDAR");
  return lines.map(fold).join("\r\n") + "\r\n";
}

/** The feed for a token, or null (unknown token / account closed). */
export async function feedForToken(token: string): Promise<string | null> {
  const t = token.replace(/\.ics$/, "");
  if (!/^[a-f0-9]{48}$/.test(t)) return null;
  const u = await prisma.user.findUnique({ where: { calendarToken: t }, include: { provider: { select: { id: true } }, clinicMembers: { select: { clinicOrgId: true } } } });
  if (!u || u.disabledAt) return null;
  const since = new Date(+clock.now() - 60 * 86_400_000);
  const b = brand();
  const addr = (l: { name: string; addressLine1: string; city: string; state: string; zip: string }) => `${l.name}, ${l.addressLine1}, ${l.city}, ${l.state} ${l.zip}`;
  if (u.role === "PROVIDER" && u.provider) {
    const rows = await prisma.assignment.findMany({
      where: { providerId: u.provider.id, status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED", "DISPUTED"] }, startsAt: { gte: since } },
      include: { shift: { include: { location: { include: { clinicOrg: { select: { displayName: true } } } } } } },
      orderBy: { startsAt: "asc" },
    });
    return toIcs(`${b.name} shifts`, rows.map((a) => ({
      uid: `assignment-${a.id}`, start: a.startsAt, end: a.endsAt, updated: a.confirmedAt,
      summary: `Coverage: ${a.shift.location.clinicOrg.displayName}`,
      location: addr(a.shift.location),
      description: `${a.shift.location.arrivalNotes ? `Arrival: ${a.shift.location.arrivalNotes}\n` : ""}Shift details and time clock: ${absoluteUrl(`/provider/assignments/${a.id}`)}`,
      url: absoluteUrl(`/provider/assignments/${a.id}`),
    })));
  }
  const orgIds = u.clinicMembers.map((m) => m.clinicOrgId);
  if (orgIds.length) {
    const rows = await prisma.shift.findMany({
      where: { location: { clinicOrgId: { in: orgIds } }, status: { notIn: ["DRAFT", "CANCELLED", "UNFILLED"] }, startsAt: { gte: since } },
      include: { location: true, assignments: { where: { status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED", "DISPUTED"] } }, include: { provider: { select: { displayName: true } } } } },
      orderBy: { startsAt: "asc" },
    });
    return toIcs(`${b.name} coverage`, rows.map((s) => {
      const p = s.assignments[0]?.provider.displayName;
      return {
        uid: `shift-${s.id}`, start: s.startsAt, end: s.endsAt, updated: s.postedAt ?? s.createdAt,
        summary: p ? `Coverage: ${p}` : "Coverage requested (not filled yet)",
        location: addr(s.location),
        description: `Shift details: ${absoluteUrl(`/clinic/shifts/${s.id}`)}`,
        url: absoluteUrl(`/clinic/shifts/${s.id}`),
      };
    }));
  }
  return toIcs(b.name, []);
}
