import { createHmac, timingSafeEqual } from "node:crypto";
import { env } from "@cm/config";
import { activityAction, NATIONAL_CREDENTIAL, type ActivitySettings } from "@cm/core";
import { prisma } from "@cm/db";
import { audit, clock, getSettings, requireAdmin, SYSTEM, type Actor } from "./context";
import { liveSet } from "./enrollment";
import { notify } from "./notify";

/**
 * Provider active status (owner decision Oct 2026; core/activity.ts decides). A ready provider in an
 * open market stays active while they show interest: a completed shift, an application, an accepted
 * offer or invitation, an upcoming booking, or tapping "I'm still available" (Provider.
 * activeConfirmedAt; logging in alone doesn't count). Reminders on activity.reminderDays (email +
 * push, the last one also a text); after activity.pauseAfterDays with nothing, they're paused
 * (Provider.breakStartsAt = now, breakReason INACTIVE), so eligibility F4 skips them; bookings they
 * already have are untouched. One tap brings them back (dashboard banner or /a/<token>, no sign-in).
 * A break they chose themselves is left alone, and so is anyone whose market isn't open.
 */

const DAY = 86_400_000;

// ---------------- one-tap link ----------------

const sign = (providerId: string) => createHmac("sha256", env().SESSION_SECRET ?? "dev-secret").update(`active:${providerId}`).digest("base64url").slice(0, 22);

export const activeToken = (providerId: string) => `${providerId}.${sign(providerId)}`;

export function providerIdFromActiveToken(token: string): string | null {
  const [id, sig] = (token ?? "").split(".");
  if (!id || !sig) return null;
  const want = Buffer.from(sign(id));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got) ? id : null;
}

export async function activitySettings(): Promise<ActivitySettings> {
  const s = await getSettings();
  return { enabled: s["activity.enabled"], pauseAfterDays: s["activity.pauseAfterDays"], reminderDays: s["activity.reminderDays"] };
}

// ---------------- "I'm still available" ----------------

/** Restarts the clock; also ends an inactivity pause (never a break they chose). */
export async function confirmActive(providerId: string, via: "app" | "link" = "app") {
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: providerId }, select: { breakReason: true, breakStartsAt: true, userId: true } });
  const now = clock.now();
  const wasPaused = p.breakReason === "INACTIVE" && !!p.breakStartsAt;
  await prisma.provider.update({
    where: { id: providerId },
    data: { activeConfirmedAt: now, ...(wasPaused ? { breakStartsAt: null, breakEndsAt: null, breakReason: null } : {}) },
  });
  await audit(prisma, { userId: p.userId, role: "PROVIDER", providerId }, wasPaused ? "provider.active_resumed" : "provider.active_confirmed", "Provider", providerId, null, { via });
  return wasPaused ? "You're active again. Matching shifts will show up on Find shifts, and we'll send offers that fit your hours." : "Thanks! You're marked as available for coverage shifts.";
}

/** What the provider's dashboard shows: paused for inactivity, or a nudge once a reminder is due. */
export async function activityStatus(providerId: string) {
  const s = await activitySettings();
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: providerId }, select: { breakReason: true, breakStartsAt: true } });
  if (p.breakReason === "INACTIVE" && p.breakStartsAt) return { paused: true as const, since: p.breakStartsAt };
  const [f] = await facts([providerId], clock.now());
  const a = f ? activityAction(f, clock.now(), s) : { kind: "none" as const };
  return { paused: false as const, remindPauseAt: a.kind === "remind" ? a.pauseAt : null };
}

// ---------------- the facts ----------------

async function facts(providerIds: string[], now: Date) {
  if (!providerIds.length) return [];
  const [providers, completed, applied, accepted, upcoming, live] = await Promise.all([
    prisma.provider.findMany({
      where: { id: { in: providerIds } },
      select: {
        id: true,
        userId: true,
        displayName: true,
        createdAt: true,
        adminApprovedAt: true,
        activeConfirmedAt: true,
        breakStartsAt: true,
        breakEndsAt: true,
        licenses: { where: { status: "VERIFIED", state: { not: NATIONAL_CREDENTIAL } }, select: { professionCode: true, state: true } },
      },
    }),
    prisma.assignment.groupBy({ by: ["providerId"], where: { providerId: { in: providerIds }, status: "COMPLETED" }, _max: { endsAt: true } }),
    prisma.application.groupBy({ by: ["providerId"], where: { providerId: { in: providerIds } }, _max: { createdAt: true } }),
    prisma.offer.groupBy({ by: ["providerId"], where: { providerId: { in: providerIds }, status: { in: ["ACCEPTED", "ACCEPTED_PENDING"] } }, _max: { respondedAt: true } }),
    prisma.assignment.groupBy({ by: ["providerId"], where: { providerId: { in: providerIds }, status: { in: ["CONFIRMED", "IN_PROGRESS"] }, endsAt: { gt: now } }, _count: true }),
    liveSet(),
  ]);
  const max = (rows: { providerId: string; _max: Record<string, Date | null> }[]) => new Map(rows.map((r) => [r.providerId, Object.values(r._max)[0]]));
  const doneBy = max(completed as never);
  const appliedBy = max(applied as never);
  const acceptedBy = max(accepted as never);
  const upcomingBy = new Set(upcoming.map((u) => u.providerId));
  return providers.map((p) => {
    const dates = [p.activeConfirmedAt, p.adminApprovedAt, doneBy.get(p.id), appliedBy.get(p.id), acceptedBy.get(p.id)].filter((d): d is Date => !!d);
    const lastActivity = dates.length ? new Date(Math.max(...dates.map(Number))) : p.createdAt;
    const onBreak = !!p.breakStartsAt && p.breakStartsAt <= now && (!p.breakEndsAt || p.breakEndsAt > now);
    return {
      providerId: p.id,
      userId: p.userId,
      name: p.displayName,
      lastActivity,
      hasUpcomingBooking: upcomingBy.has(p.id),
      inOpenMarket: p.licenses.some((l) => live.has(`${l.professionCode}:${l.state}`)),
      onBreak,
    };
  });
}

// ---------------- the daily sweep ----------------

const fmtDate = (d: Date) => d.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "long", day: "numeric" });

export async function activitySweep(now: Date = clock.now()) {
  const s = await activitySettings();
  const out = { reminded: 0, paused: 0 };
  if (!s.enabled) return out;
  const first = Math.min(...s.reminderDays, s.pauseAfterDays);
  // Only providers whose own "I'm still available" clock is old enough could be due.
  const candidates = await prisma.provider.findMany({
    where: { status: "ACTIVE", breakStartsAt: null, OR: [{ activeConfirmedAt: null }, { activeConfirmedAt: { lte: new Date(+now - first * DAY) } }] },
    select: { id: true },
  });
  for (let i = 0; i < candidates.length; i += 200) {
    for (const f of await facts(candidates.slice(i, i + 200).map((c) => c.id), now)) {
      const a = activityAction(f, now, s);
      const link = `/a/${activeToken(f.providerId)}`;
      if (a.kind === "remind") {
        // One reminder per day-mark per stretch of inactivity (keyed on the last activity).
        const key = `active:${f.providerId}:${f.lastActivity.toISOString().slice(0, 10)}:${a.day}`;
        const claimed = await prisma.digestSend.createMany({ data: [{ key, userId: f.userId }], skipDuplicates: true });
        if (!claimed.count) continue;
        const last = a.day === Math.max(...s.reminderDays);
        await notify(prisma, f.userId, {
          template: "provider_active_reminder",
          title: "Still taking coverage shifts? Tap to stay active",
          body: `We haven't seen a shift, application or check-in from you in ${a.day} days. Tap "I'm still available" by ${fmtDate(a.pauseAt)} to keep getting shift offers. If you don't, we'll pause your profile until you're back.`,
          link,
          ctaLabel: "I'm still available",
          email: true,
          sms: last,
        }).catch((e) => console.error("active reminder failed", e));
        out.reminded++;
      } else if (a.kind === "pause") {
        const r = await prisma.provider.updateMany({ where: { id: f.providerId, breakStartsAt: null }, data: { breakStartsAt: now, breakEndsAt: null, breakReason: "INACTIVE" } });
        if (!r.count) continue;
        await audit(prisma, SYSTEM, "provider.paused_inactive", "Provider", f.providerId, null, { lastActivity: f.lastActivity });
        await notify(prisma, f.userId, {
          template: "provider_paused_inactive",
          title: "We've paused your profile. Tap to come back any time",
          body: `It's been more than ${s.pauseAfterDays} days since your last shift, application or check-in, so we've paused your profile: you won't get new shift offers or invitations for now. Bookings you already have aren't affected. When you're ready, tap "I'm active again" and you'll be matched to shifts right away.`,
          link,
          ctaLabel: "I'm active again",
          email: true,
          sms: true,
        }).catch((e) => console.error("pause notice failed", e));
        out.paused++;
      }
    }
  }
  return out;
}

// ---------------- admin ----------------

/** Providers paused for inactivity (Admin → Provider supply). */
export async function pausedForInactivity(actor: Actor) {
  requireAdmin(actor);
  return prisma.provider.findMany({
    where: { breakReason: "INACTIVE", breakStartsAt: { not: null } },
    select: { id: true, displayName: true, breakStartsAt: true },
    orderBy: { breakStartsAt: "desc" },
  });
}
