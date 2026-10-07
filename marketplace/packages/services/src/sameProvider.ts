import { groupDeadlineAction } from "@cm/core";
import { prisma, type Prisma } from "@cm/db";
import { audit, clock, getSettings, requireClinic, SYSTEM, type Actor, type Db } from "./context";
import { getEligibleProviders, loadShift } from "./eligibility";
import { notifyClinic } from "./notify";

/**
 * "Same provider for all days" (core/sameProvider.ts). A booking is LOCKED (one provider for everything)
 * while ShiftGroup.sameProviderRequired is on, it hasn't been split, and nobody is booked on any day yet.
 * Locked: providers apply for every open day together (applyToShift / applyToAllDays), the clinic confirms
 * all days at once (bookings.confirmForAllDays), Smart Dispatch doesn't offer single days (startDispatch),
 * and the decision deadline is handled for the whole booking here (runGroupDeadlines). Once someone is
 * booked, a day that reopens (a cancellation) is filled on its own as usual.
 */

const OPENISH = ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"] as const;
const BOOKED = ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] as const;

/** Prisma filter: shifts whose booking is locked to one provider. */
export const LOCKED_GROUP: Prisma.ShiftGroupWhereInput = {
  sameProviderRequired: true,
  splitAt: null,
  shifts: { none: { assignments: { some: { status: { in: [...BOOKED] } } } } },
};

export async function lockedGroupId(db: Db, shiftId: string): Promise<string | null> {
  const sh = await db.shift.findUnique({ where: { id: shiftId }, select: { shiftGroupId: true } });
  if (!sh?.shiftGroupId) return null;
  const g = await db.shiftGroup.findFirst({ where: { id: sh.shiftGroupId, ...LOCKED_GROUP }, select: { id: true } });
  return g?.id ?? null;
}

async function openDays(db: Db, groupId: string) {
  return db.shift.findMany({ where: { shiftGroupId: groupId, status: { in: [...OPENISH] } }, orderBy: { startsAt: "asc" }, select: { id: true, startsAt: true, selectionDeadline: true } });
}

/**
 * How many providers could cover this booking: every open day (what a same-provider booking needs) vs at
 * least one day (what splitting would reach). Shown to the clinic so the trade-off is clear.
 */
export async function groupCoverage(groupId: string) {
  const days = await openDays(prisma, groupId);
  const sets: Set<string>[] = [];
  for (const d of days) sets.push(new Set((await getEligibleProviders(prisma, await loadShift(prisma, d.id))).eligible.map((e) => e.providerId)));
  const any = new Set(sets.flatMap((x) => [...x]));
  const all = sets.length ? [...sets[0]].filter((id) => sets.every((x) => x.has(id))) : [];
  const apps = days.length
    ? await prisma.application.groupBy({ by: ["providerId"], where: { status: "ACTIVE", shiftId: { in: days.map((d) => d.id) } }, _count: true })
    : [];
  const fullApplicants = apps.filter((a) => a._count === days.length && all.includes(a.providerId)).map((a) => a.providerId);
  return { openDays: days.length, allDays: all.length, anyDay: any.size, allDayIds: all, fullApplicants };
}

/** Split a locked booking into separate days: each day is then filled on its own (applications are kept). */
export async function splitGroup(actor: Actor, groupId: string, by: "clinic" | "auto") {
  const g = await prisma.shiftGroup.findUniqueOrThrow({ where: { id: groupId }, include: { location: true } });
  if (actor.role !== "SYSTEM") {
    const orgId = requireClinic(actor);
    if (g.location.clinicOrgId !== orgId) throw new Error("Not your booking.");
  }
  const r = await prisma.shiftGroup.updateMany({ where: { id: groupId, splitAt: null }, data: { splitAt: clock.now(), splitBy: by } });
  if (!r.count) return false;
  await audit(prisma, actor, "booking.split", "ShiftGroup", groupId, null, { by });
  // Providers who can take only some days hear about it now (the ones already told aren't told twice).
  const first = (await openDays(prisma, groupId))[0];
  if (first) {
    const { notifyEligibleProvidersOfShift } = await import("./shifts");
    await notifyEligibleProvidersOfShift(first.id, "posted").catch((e) => console.error("split notice failed", e));
  }
  return true;
}

/** Decision deadline for locked bookings (runs inside runSelectionDeadlines, which skips their days). */
export async function runGroupDeadlines(now = clock.now()) {
  const s = await getSettings();
  const groups = await prisma.shiftGroup.findMany({
    where: { ...LOCKED_GROUP, shifts: { some: { status: { in: [...OPENISH] }, selectionDeadline: { lte: now }, startsAt: { gt: now } } } },
    include: { location: true },
  });
  const out = { confirmed: 0, asked: 0, split: 0 };
  for (const g of groups) {
    const days = await openDays(prisma, g.id);
    if (!days.length) continue;
    const cov = await groupCoverage(g.id);
    // Best full applicant: highest average score across the days they applied to.
    let best: string | null = null;
    if (cov.fullApplicants.length) {
      const scores = await prisma.application.groupBy({ by: ["providerId"], where: { status: "ACTIVE", providerId: { in: cov.fullApplicants }, shiftId: { in: days.map((d) => d.id) } }, _avg: { scoreAtApply: true } });
      scores.sort((a, b) => (b._avg.scoreAtApply ?? 0) - (a._avg.scoreAtApply ?? 0));
      best = scores[0]?.providerId ?? null;
    }
    const action = groupDeadlineAction({ now, firstStartsAt: days[0].startsAt, hasFullApplicant: !!best, askedAt: g.splitAskedAt, waitHours: s["bookings.splitWaitHours"], splitNowWithinHours: s["bookings.splitNowWithinHours"] });
    const link = `/clinic/shifts/${days[0].id}#same-provider`;
    if (action === "confirm" && best) {
      const { confirmAllDays } = await import("./bookings");
      const r = await confirmAllDays(SYSTEM, g.id, best, "AUTO_APPLICANT").catch(() => null);
      if (r?.confirmed) {
        out.confirmed++;
        continue;
      }
    }
    if (action === "ask") {
      const claimed = await prisma.shiftGroup.updateMany({ where: { id: g.id, splitAskedAt: null }, data: { splitAskedAt: now } });
      if (!claimed.count) continue;
      await notifyClinic(prisma, g.location.clinicOrgId, {
        template: "booking_split_ask",
        title: `No one provider is free for all ${days.length} days. Split it so each day gets covered?`,
        body: `${cov.allDays ? `${cov.allDays} provider${cov.allDays === 1 ? " could" : "s could"} take every day but nobody has applied for all of them yet.` : "No single provider can take every day."} Split into separate days and ${cov.anyDay} provider${cov.anyDay === 1 ? "" : "s"} can be offered at least one day. If we don't hear from you within ${s["bookings.splitWaitHours"]} hours, we'll split it so your days get covered.`,
        link,
        ctaLabel: "Split or keep waiting",
        email: true,
        sms: true,
      });
      out.asked++;
    } else if (action === "split" || action === "confirm") {
      if (await splitGroup(SYSTEM, g.id, "auto")) {
        await notifyClinic(prisma, g.location.clinicOrgId, {
          template: "booking_split_auto",
          title: "We've split your booking so each day gets covered",
          body: `No one provider could take all ${days.length} days in time, so each day is now being filled on its own. Your provider may differ from day to day; you'll see who's booked for each day on the booking page.`,
          link,
          email: true,
        });
        out.split++;
      }
    }
  }
  return out;
}

/** Clinic: keep waiting for one provider after being asked (clears the question; asked again next time). */
export async function keepWaiting(actor: Actor, groupId: string) {
  const orgId = requireClinic(actor);
  const g = await prisma.shiftGroup.findUniqueOrThrow({ where: { id: groupId }, include: { location: true, shifts: { orderBy: { startsAt: "asc" }, take: 1 } } });
  if (g.location.clinicOrgId !== orgId) throw new Error("Not your booking.");
  // Asked again at the next deadline sweep after the wait: push the deadline out by the wait, never past the split-now point.
  const s = await getSettings();
  const first = g.shifts[0];
  const latest = new Date(+first.startsAt - s["bookings.splitNowWithinHours"] * 3_600_000);
  const next = new Date(Math.min(+clock.now() + 24 * 3_600_000, +latest));
  await prisma.shift.updateMany({ where: { shiftGroupId: groupId, status: { in: [...OPENISH] } }, data: { selectionDeadline: next } });
  await prisma.shiftGroup.update({ where: { id: groupId }, data: { splitAskedAt: null } });
  await audit(prisma, actor, "booking.keep_waiting", "ShiftGroup", groupId, null, { until: next });
  return next;
}
