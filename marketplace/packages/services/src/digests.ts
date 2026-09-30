import { brand } from "@cm/config";
import { prisma, type Prisma } from "@cm/db";
import { DateTime } from "luxon";
import { clock, getSettings } from "./context";
import { sendEmail, type EmailContent } from "./notify";

/**
 * Provider booking emails, carried over from the old site's morning route
 * email: a daily list of today's bookings (default 5:30am) and, on Sunday
 * evening, the coming Monday–Sunday. Times are the provider's home time
 * zone. No bookings → no email.
 *
 * Runs as an idempotent sweep on every tick: a provider is due once their
 * local clock has passed the send time (up to CATCH_UP_HOURS later, so a
 * missed tick still sends but a morning email never arrives at dinner time).
 * A DigestSend row is claimed before sending, so overlapping ticks can't
 * send twice; a failed send releases the claim for the next tick to retry.
 */

const CATCH_UP_HOURS = 3;
const BOOKED = ["CONFIRMED", "IN_PROGRESS"] as const;

type Kind = "daily" | "weekly";

/** Google Maps directions: opens the Maps app on a phone, the website on a computer. */
export function directionsUrl(address: string): string {
  return `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`;
}

export function appleMapsUrl(address: string): string {
  return `https://maps.apple.com/?daddr=${encodeURIComponent(address)}`;
}

/** Start of the window a provider's email covers, if it's due at `now` in their time zone. */
export function digestWindow(kind: Kind, now: Date, tz: string, cfg: { time: string; weekday?: number }): { key: string; from: DateTime; to: DateTime } | null {
  const local = DateTime.fromJSDate(now, { zone: tz });
  if (!local.isValid) return null;
  const [h, m] = cfg.time.split(":").map(Number);
  const sendAt = local.set({ hour: h, minute: m, second: 0, millisecond: 0 });
  if (local < sendAt || local >= sendAt.plus({ hours: CATCH_UP_HOURS })) return null;
  if (kind === "daily") {
    const from = local.startOf("day");
    return { key: from.toISODate()!, from, to: from.plus({ days: 1 }) };
  }
  if (local.weekday !== cfg.weekday) return null;
  const from = local.startOf("week").plus({ weeks: 1 }); // next Monday 00:00
  return { key: from.toISODate()!, from, to: from.plus({ weeks: 1 }) };
}

export async function sendBookingDigests(now: Date = clock.now()) {
  const s = await getSettings();
  const kinds = (["daily", "weekly"] as const).filter((k) => s[`digests.${k}`].enabled);
  if (!kinds.length) return { sent: 0 };
  // Anyone with a booking in the next ~9 days; the per-provider window narrows it down.
  const upcoming = await prisma.assignment.findMany({
    where: { status: { in: [...BOOKED] }, startsAt: { gte: new Date(+now - 86_400_000), lt: new Date(+now + 9 * 86_400_000) } },
    include: { shift: { include: { location: { include: { clinicOrg: true } } } }, provider: { include: { user: true } } },
    orderBy: { startsAt: "asc" },
  });
  const byProvider = new Map<string, typeof upcoming>();
  for (const a of upcoming) byProvider.set(a.providerId, [...(byProvider.get(a.providerId) ?? []), a]);

  let sent = 0;
  for (const list of byProvider.values()) {
    const provider = list[0].provider;
    if (provider.user.disabledAt) continue;
    for (const kind of kinds) {
      const w = digestWindow(kind, now, provider.homeTimeZone, s[`digests.${kind}`]);
      if (!w) continue;
      const bookings = list.filter((a) => a.startsAt >= w.from.toJSDate() && a.startsAt < w.to.toJSDate());
      if (!bookings.length) continue;
      const key = `${kind}:${provider.id}:${w.key}`;
      const claimed = await prisma.digestSend.createMany({ data: [{ key, userId: provider.userId }], skipDuplicates: true });
      if (!claimed.count) continue;
      const ok = await sendEmail(provider.user.email, digestEmail(kind, w.from, bookings, s["digests.daily"].enabled));
      if (ok) sent++;
      else await prisma.digestSend.delete({ where: { key } }).catch(() => {});
    }
  }
  return { sent };
}

type Booking = Prisma.AssignmentGetPayload<{ include: { shift: { include: { location: { include: { clinicOrg: true } } } } } }>;

function digestEmail(kind: Kind, from: DateTime, bookings: Booking[], dailyToo = false): EmailContent {
  const n = bookings.length;
  const plural = `${n} booking${n === 1 ? "" : "s"}`;
  const items = bookings.map((a) => {
    const loc = a.shift.location;
    const tz = loc.timeZone;
    const address = `${loc.addressLine1}${loc.addressLine2 ? `, ${loc.addressLine2}` : ""}, ${loc.city}, ${loc.state} ${loc.zip}`;
    const day = a.startsAt.toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric" });
    const time = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
    const contact = [loc.onSiteContactName, loc.phone].filter(Boolean).join(" · ");
    return {
      title: `${kind === "weekly" ? `${day} · ` : ""}${time(a.startsAt)}–${time(a.endsAt)} · ${loc.clinicOrg.displayName}`,
      lines: [address, ...(contact ? [`On-site contact: ${contact}`] : [])],
      links: [
        { label: "Get directions", url: directionsUrl(address) },
        { label: "Apple Maps", url: appleMapsUrl(address) },
        { label: "Shift details", url: `/provider/assignments/${a.id}` },
      ],
    };
  });
  if (kind === "daily") {
    const date = from.toFormat("cccc, LLLL d");
    return {
      subject: `Today: ${plural} · ${date}`,
      heading: "Today's bookings",
      paragraphs: [`You have ${plural} today, ${date}. Tap "Get directions" to start navigation.`],
      items,
    };
  }
  const range = `${from.toFormat("LLL d")}–${from.plus({ days: 6 }).toFormat("LLL d")}`;
  return {
    subject: `Your week ahead: ${plural} · ${range}`,
    heading: "Your week ahead",
    paragraphs: [`You have ${plural} coming up this week (${range}).${dailyToo ? " Each morning you'll also get that day's list with directions." : ""}`],
    items,
    cta: { label: `Open ${brand().name}`, url: "/provider" },
  };
}
