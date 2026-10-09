import { randomBytes } from "node:crypto";
import { DateTime } from "luxon";
import { brand } from "@cm/config";
import { stateAreasByCode } from "@cm/core";
import { prisma } from "@cm/db";
import { submitIndexNow } from "@cm/integrations";
import { clock, getSettings, invalidateSettings, requireAdmin, type Actor } from "./context";
import { absoluteUrl, notify } from "./notify";
import { publicPosts } from "./blog";
import { updateSetting } from "./admin";

/**
 * Search & AI-search helpers: the public URL list (sitemap + IndexNow), IndexNow
 * pings, keyword topics for the blog queue, and post-shift Google review requests.
 */

const STATIC = ["/", "/for-clinics", "/for-providers", "/how-it-works", "/states", "/faq", "/contact", "/tools/cost-of-closing", "/personal-injury-clinics", "/blog", "/privacy", "/terms"];

export type PublicPath = { path: string; priority: number; changeFrequency: "weekly" | "monthly"; lastModified?: Date };

/** Every public page worth indexing: static pages, profession pages, live landing pages, blog posts. */
export async function publicPaths(): Promise<PublicPath[]> {
  const [posts, professions, live, states] = await Promise.all([
    publicPosts({ take: 1000 }).catch(() => []),
    prisma.profession.findMany({ select: { slug: true, active: true } }).catch(() => []),
    prisma.professionStateConfig.findMany({ where: { enabled: true, profession: { active: true } }, select: { state: true, profession: { select: { slug: true } } } }).catch(() => []),
    prisma.stateConfig.findMany({ where: { enabled: true }, select: { state: true } }).catch(() => []),
  ]);
  const open = new Set(states.map((s) => s.state));
  const landing = live.filter((l) => open.has(l.state)).flatMap((l) => {
    const st = stateAreasByCode(l.state);
    return st ? [`/${l.profession.slug}/${st.slug}`, ...st.areas.map((a) => `/${l.profession.slug}/${st.slug}/${a.slug}`)] : [];
  });
  return [
    ...STATIC.map((p) => ({ path: p, changeFrequency: (p === "/blog" ? "weekly" : "monthly") as "weekly" | "monthly", priority: p === "/" ? 1 : 0.7 })),
    ...professions.filter((p) => p.slug).map((p) => ({ path: `/${p.slug}`, changeFrequency: "monthly" as const, priority: p.active ? 0.8 : 0.4 })),
    ...landing.map((u) => ({ path: u, changeFrequency: "monthly" as const, priority: u.split("/").length === 3 ? 0.9 : 0.8 })),
    ...posts.map((p) => ({ path: `/blog/${p.slug}`, lastModified: p.updatedAt, changeFrequency: "monthly" as const, priority: 0.6 })),
  ];
}

// ---------------- IndexNow ----------------

const KEY = "seo.indexNowKey";

/** The site's IndexNow key (made once), served at /indexnow.txt. */
export async function indexNowKey(): Promise<string> {
  const row = await prisma.setting.findUnique({ where: { key: KEY } });
  const v = (row?.value as { key?: string } | null)?.key;
  if (v) return v;
  const key = randomBytes(16).toString("hex");
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: { key } }, update: {} });
  return ((await prisma.setting.findUnique({ where: { key: KEY } }))?.value as { key: string }).key;
}

export async function pingIndexNow(paths: string[]) {
  const s = await getSettings();
  if (!s["seo.indexNow"] || !paths.length) return { ok: true, sent: 0 };
  const base = absoluteUrl("/").replace(/\/$/, "");
  const host = new URL(base).host;
  if (/localhost|127\.0\.0\.1|0\.0\.0\.0/.test(host) && process.env.NODE_ENV === "production") return { ok: false, sent: 0 };
  const r = await submitIndexNow({ host, key: await indexNowKey(), keyLocation: `${base}/indexnow.txt`, urls: paths.map((p) => `${base}${p === "/" ? "" : p}`) });
  await prisma.setting.upsert({ where: { key: "seo.indexNowLast" }, create: { key: "seo.indexNowLast", value: { at: clock.now().toISOString(), sent: paths.length, ...r } }, update: { value: { at: clock.now().toISOString(), sent: paths.length, ...r } } });
  return { ...r, sent: paths.length };
}

/** Daily: every public page (search engines re-check what changed). */
export async function indexNowSweep() {
  return pingIndexNow((await publicPaths()).map((p) => p.path));
}

// ---------------- blog keyword topics ----------------

/** Questions clinic owners and providers actually search, per profession. Admin adds them to the blog topic queue. */
export function seoTopics(professionDisplay: string, stateName: string): { topic: string; audience: "CLINIC" | "PROVIDER" | "ALL" }[] {
  const n = professionDisplay.toLowerCase();
  const where = stateName ? ` in ${stateName}` : "";
  return [
    { topic: `Who covers my practice when I go on vacation? A guide to hiring a temporary ${n}${where}`, audience: "CLINIC" },
    { topic: `How much does a locum ${n} cost${where}? Day rates, mileage and what's included`, audience: "CLINIC" },
    { topic: `Closing vs. getting coverage: what one week away really costs a ${n} practice`, audience: "CLINIC" },
    { topic: `Maternity and paternity leave planning for practice owners: keeping patients cared for`, audience: "CLINIC" },
    { topic: `Checklist: preparing your office and staff for a covering ${n}`, audience: "CLINIC" },
    { topic: `What to verify before letting another ${n} treat your patients${where}`, audience: "CLINIC" },
    { topic: `Selling or buying a practice: using temporary coverage during the transition`, audience: "CLINIC" },
    { topic: `Per diem ${n} work${where}: how to earn extra on your own schedule`, audience: "PROVIDER" },
    { topic: `New graduate ${n}s: building experience with coverage shifts before joining a practice`, audience: "PROVIDER" },
    { topic: `How independent contractor pay, mileage and 1099s work for covering ${n}s`, audience: "PROVIDER" },
    { topic: `Licensing and malpractice requirements for ${n}s working coverage${where}`, audience: "PROVIDER" },
    { topic: `Hurricane season: a continuity plan for ${n} practices${where}`, audience: "ALL" },
  ];
}

/** Adds the keyword topics to blog.topicQueue (skips ones already there). Returns how many were added. */
export async function addSeoTopics(actor: Actor) {
  requireAdmin(actor);
  const live = await prisma.professionStateConfig.findFirst({ where: { enabled: true, profession: { active: true } }, include: { profession: true } });
  const st = live ? stateAreasByCode(live.state) : null;
  const topics = seoTopics(live?.profession.displayName ?? "provider", st?.name ?? "");
  const s = await getSettings();
  const queue = s["blog.topicQueue"];
  const have = new Set(queue.map((t) => t.topic.toLowerCase()));
  const add = topics.filter((t) => !have.has(t.topic.toLowerCase()));
  const next = [...queue, ...add].slice(0, 100);
  await updateSetting(actor, "blog.topicQueue", next);
  invalidateSettings();
  return { added: Math.min(add.length, next.length - queue.length) };
}

// ---------------- Google review requests ----------------

/**
 * After a completed shift, ask the clinic's owners for a Google review: every clinic,
 * whatever its rating (asking only happy customers breaks Google's rules), at most once
 * per reviews.repeatDays. Off while reviews.googleReviewUrl is blank.
 */
export async function reviewRequestSweep(now = clock.now()) {
  const s = await getSettings();
  const url = s["reviews.googleReviewUrl"];
  if (!url) return { off: true };
  const until = new Date(+now - s["reviews.askAfterDays"] * 86_400_000);
  const from = new Date(+until - 7 * 86_400_000);
  const done = await prisma.assignment.findMany({
    where: { status: "COMPLETED", completedAt: { gte: from, lte: until } },
    select: { shift: { select: { location: { select: { clinicOrgId: true, clinicOrg: { select: { displayName: true } } } } } } },
  });
  const orgs = new Map(done.map((a) => [a.shift.location.clinicOrgId, a.shift.location.clinicOrg.displayName]));
  let asked = 0;
  for (const [orgId, name] of orgs) {
    const key = `review:${orgId}`;
    const prev = await prisma.digestSend.findUnique({ where: { key } });
    if (prev && +now - +prev.sentAt < s["reviews.repeatDays"] * 86_400_000) continue;
    const owners = await prisma.clinicMember.findMany({ where: { clinicOrgId: orgId, role: "CLINIC_OWNER" }, select: { userId: true } });
    if (!owners.length) continue;
    // Claim first so overlapping runs never double-ask.
    if (prev) {
      const r = await prisma.digestSend.updateMany({ where: { key, sentAt: prev.sentAt }, data: { sentAt: now } });
      if (!r.count) continue;
    } else {
      try { await prisma.digestSend.create({ data: { key, userId: owners[0].userId, sentAt: now } }); } catch { continue; }
    }
    for (const o of owners) {
      await notify(prisma, o.userId, {
        template: "review_request",
        title: `How did your coverage go, ${name}?`,
        body: `If ${brand().name} kept your office open, a short Google review helps other practices find us. It takes a minute.`,
        details: ["Something not right? Reply to this email or use Help in your account and we'll make it right."],
        link: url,
        ctaLabel: "Leave a Google review",
        push: false,
      });
    }
    asked++;
  }
  return { asked };
}

export async function seoStatus(actor: Actor) {
  requireAdmin(actor);
  const last = (await prisma.setting.findUnique({ where: { key: "seo.indexNowLast" } }))?.value as { at?: string; sent?: number; ok?: boolean; status?: number | null; error?: string } | null;
  return { indexNowLast: last, pages: (await publicPaths()).length, today: DateTime.fromJSDate(clock.now()).toISODate() };
}
