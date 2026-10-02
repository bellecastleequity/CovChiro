import { DateTime } from "luxon";
import { DomainError, followPace, instagramHandle, instagramHandleFrom } from "@cm/core";
import { prisma } from "@cm/db";
import { audit, clock, getSettings, requireAdmin, type Actor } from "../context";

/**
 * Instagram follow list. Handles come only from the practice's own social links
 * (research socialUrls) or an admin. Nothing here touches Instagram: a person
 * follows in the app, and this paces them (followPace) and keeps the list.
 */

type Pending = "FOUND" | "APPROVED" | "FOLLOWED" | "SKIPPED";

async function paceRules() {
  const s = await getSettings();
  return {
    perDay: s["growth.instagram.followsPerDay"], perWindow: s["growth.instagram.followsPerWindow"], windowMinutes: s["growth.instagram.windowMinutes"],
    start: s["growth.instagram.startTime"], end: s["growth.instagram.endTime"], timeZone: s["growth.instagram.timeZone"], autoPerDay: s["growth.instagram.autoApprovePerDay"],
  };
}

/** Researched prospects not checked yet → FOUND (has a handle) or NO_HANDLE. */
export async function syncInstagramHandles(limit = 500) {
  const rows = await prisma.clinicProspect.findMany({ where: { igStatus: "NONE", socialUrls: { isEmpty: false } }, select: { id: true, socialUrls: true }, take: limit });
  let found = 0;
  for (const r of rows) {
    const h = instagramHandleFrom(r.socialUrls);
    if (h) found++;
    await prisma.clinicProspect.update({ where: { id: r.id }, data: h ? { instagramHandle: h, igStatus: "FOUND" } : { igStatus: "NO_HANDLE" } });
  }
  return { checked: rows.length, found };
}

/** Auto-approve up to growth.instagram.autoApprovePerDay found handles per local day (0 = off), best prospects first. */
export async function autoApproveInstagram(now = clock.now()) {
  const r = await paceRules();
  if (!r.autoPerDay) return { approved: 0 };
  const dayStart = DateTime.fromJSDate(now, { zone: r.timeZone }).startOf("day").toJSDate();
  const done = await prisma.clinicProspect.count({ where: { igAutoApproved: true, igApprovedAt: { gte: dayStart } } });
  const room = r.autoPerDay - done;
  if (room <= 0) return { approved: 0 };
  const picks = await prisma.clinicProspect.findMany({ where: { igStatus: "FOUND", doNotContact: false }, orderBy: [{ intentScore: "desc" }, { createdAt: "asc" }], take: room, select: { id: true } });
  const res = await prisma.clinicProspect.updateMany({ where: { id: { in: picks.map((p) => p.id) }, igStatus: "FOUND" }, data: { igStatus: "APPROVED", igApprovedAt: now, igAutoApproved: true } });
  return { approved: res.count };
}

export async function instagramSweep() {
  return { ...(await syncInstagramHandles()), ...(await autoApproveInstagram()) };
}

/** Everything the Instagram page shows: today's pace, the follow queue and the review list. */
export async function instagramBoard(actor: Actor) {
  requireAdmin(actor);
  await syncInstagramHandles(200);
  const r = await paceRules();
  const now = clock.now();
  const since = new Date(+now - 36 * 3_600_000);
  const sel = { id: true, clinicName: true, city: true, state: true, website: true, instagramHandle: true, igApprovedAt: true, igAutoApproved: true, igFollowedAt: true, stage: true, intentScore: true } as const;
  const [recent, queue, review, counts] = await Promise.all([
    prisma.clinicProspect.findMany({ where: { igFollowedAt: { gte: since } }, select: { igFollowedAt: true } }),
    prisma.clinicProspect.findMany({ where: { igStatus: "APPROVED" }, orderBy: { igApprovedAt: "asc" }, take: 100, select: sel }),
    prisma.clinicProspect.findMany({ where: { igStatus: "FOUND", doNotContact: false }, orderBy: [{ intentScore: "desc" }, { createdAt: "asc" }], take: 200, select: sel }),
    prisma.clinicProspect.groupBy({ by: ["igStatus"], _count: { _all: true } }),
  ]);
  const pace = followPace(recent.map((x) => x.igFollowedAt!), now, r);
  return {
    pace, rules: r, queue, review,
    counts: Object.fromEntries(counts.map((c) => [c.igStatus, c._count._all])) as Record<string, number>,
  };
}

/** Bulk/single decisions. "followed" records the time (it counts toward the pace); nothing is sent to Instagram. */
export async function instagramDecide(actor: Actor, ids: string[], decision: "approve" | "skip" | "followed" | "review") {
  requireAdmin(actor);
  const now = clock.now();
  const list = [...new Set(ids)].slice(0, 500);
  const from: Record<typeof decision, Pending[]> = { approve: ["FOUND", "SKIPPED"], skip: ["FOUND", "APPROVED"], followed: ["APPROVED", "FOUND"], review: ["APPROVED", "SKIPPED"] };
  const data =
    decision === "approve" ? { igStatus: "APPROVED", igApprovedAt: now, igAutoApproved: false }
    : decision === "skip" ? { igStatus: "SKIPPED" }
    : decision === "followed" ? { igStatus: "FOLLOWED", igFollowedAt: now }
    : { igStatus: "FOUND", igApprovedAt: null, igAutoApproved: false };
  const res = await prisma.clinicProspect.updateMany({ where: { id: { in: list }, igStatus: { in: from[decision] }, instagramHandle: { not: null } }, data });
  await audit(prisma, actor, `growth.instagram_${decision}`, "ClinicProspect", list.length === 1 ? list[0] : "bulk", null, { count: res.count });
  return { count: res.count };
}

/** Set or correct a clinic's handle by hand (a profile URL or @handle). Blank clears it. */
export async function setInstagramHandle(actor: Actor, prospectId: string, input: string) {
  requireAdmin(actor);
  const v = input.trim();
  if (!v) {
    await prisma.clinicProspect.update({ where: { id: prospectId }, data: { instagramHandle: null, igStatus: "NO_HANDLE" } });
    return null;
  }
  const h = instagramHandle(/instagram\.com/i.test(v) ? v : `https://instagram.com/${v.replace(/^@/, "")}`);
  if (!h) throw new DomainError("VALIDATION", "That doesn't look like an Instagram profile. Paste the profile link or @handle.");
  const p = await prisma.clinicProspect.findUniqueOrThrow({ where: { id: prospectId }, select: { igStatus: true } });
  await prisma.clinicProspect.update({ where: { id: prospectId }, data: { instagramHandle: h, igStatus: ["FOLLOWED", "APPROVED", "SKIPPED"].includes(p.igStatus) ? p.igStatus : "FOUND" } });
  return h;
}
