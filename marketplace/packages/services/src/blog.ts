import { brand, type SettingsMap } from "@cm/config";
import { checkBlogPost, DomainError, dollarAmountsIn, slugify, US_STATES, type BlogCheck } from "@cm/core";
import { prisma, type BlogPost } from "@cm/db";
import { audit, clock, getSettings, requireAdmin, SYSTEM, type Actor } from "./context";
import { siteFaq } from "./faq";
import { ai } from "./growth/engine";
import { primaryTarget } from "./growth/expansion";
import { notifyAdmins } from "./notify";

/**
 * Blog: AI drafts, people publish. Drafts are grounded in the published FAQ
 * and approved knowledge-base articles (the same facts the website chat may
 * use), checked by core checkBlogPost, and never published automatically.
 */

export type BlogAudience = "CLINIC" | "PROVIDER" | "ALL";
const AUDIENCES: BlogAudience[] = ["CLINIC", "PROVIDER", "ALL"];
const asAudience = (v: string): BlogAudience => (AUDIENCES.includes(v as BlogAudience) ? (v as BlogAudience) : "ALL");

/** Internal pages a post may link to. */
export const BLOG_LINKS = ["/for-clinics", "/for-providers", "/how-it-works", "/faq", "/states", "/signup?role=clinic", "/signup?role=provider", "/tools/cost-of-closing", "/contact", "/blog"];

// ---------------- facts the AI may rely on ----------------

async function approvedFacts(s: SettingsMap): Promise<string> {
  // Articles for every profession and for professions live on the platform (never a prelaunch one's).
  const live = (await prisma.profession.findMany({ where: { active: true }, select: { code: true } })).map((x) => x.code);
  const kb = await prisma.kbArticle.findMany({ where: { approved: true, active: true, OR: [{ professionCode: null }, { professionCode: { in: live } }] }, orderBy: { topic: "asc" } });
  return [...siteFaq(s).map(([q, a]) => `Q: ${q}\nA: ${a}`), ...kb.map((k) => `Q: ${k.question}\nA: ${k.answer}`)].join("\n\n");
}

// The main live market (Growth → Expansion). The settings argument is kept for callers.
async function liveMarket(_s: SettingsMap) {
  const m = await primaryTarget();
  const p = await prisma.profession.findUnique({ where: { code: m.professionCode } });
  return { profession: p?.displayName ?? m.professionCode, state: US_STATES[m.state] ?? m.state };
}

/** Publish checks with the dollar amounts our approved facts already state. */
export async function checkPost(p: Pick<BlogPost, "title" | "slug" | "description" | "body">, s?: SettingsMap): Promise<BlogCheck> {
  const facts = await approvedFacts(s ?? (await getSettings()));
  return checkBlogPost(p, { knownDollarAmounts: dollarAmountsIn(facts) });
}

// ---------------- AI drafting ----------------

const DRAFT_SCHEMA = {
  type: "object",
  properties: {
    title: { type: "string" },
    description: { type: "string" },
    keywords: { type: "array", items: { type: "string" } },
    body: { type: "string" },
  },
  required: ["title", "description", "keywords", "body"],
  additionalProperties: false,
};

const AUDIENCE_LABEL: Record<BlogAudience, string> = {
  CLINIC: "clinic owners and office managers who need a covering provider when their doctor is out",
  PROVIDER: "licensed providers (and soon-to-graduate students) interested in coverage and per diem work",
  ALL: "clinic owners and providers",
};

async function systemPrompt(s: SettingsMap) {
  const b = brand();
  const m = await liveMarket(s);
  return `You write blog articles for ${b.name} (${b.domain}), a marketplace that connects clinics needing coverage with licensed, verified providers who have open days. The live market today is ${m.profession} in ${m.state}; other professions and states are not live yet, so never say or imply they are.

Write genuinely useful, accurate, people-first articles. No filler, no keyword stuffing, no hype.

Format (the "body" field): Markdown only, 900–1400 words. Use ## and ### headings, short paragraphs, "-" bullet lists and **bold**. No H1 (the title is separate), no tables, images, HTML or code.

Rules you must follow:
- Facts about ${b.name} (how it works, policies, timing, prices) may come ONLY from the FACTS section. Never invent features, numbers, policies, statistics, studies, surveys, quotes or testimonials.
- No dollar amounts unless the exact amount appears in FACTS. For prices, link to /for-clinics.
- Never promise results: no "guarantee", "risk-free", or claims of more revenue, income, patients or percentages.
- No legal, tax or medical advice. For licensing rules, tell readers to check with their state licensing board; don't cite statute or rule numbers.
- No patient stories or patient details. No phone numbers or email addresses.
- Be fair to alternatives (locum agencies, colleagues, staffing services). Don't name or criticize specific companies.
- Links: only these internal paths, at most 3 in total: ${BLOG_LINKS.join(", ")}. Use Markdown links like [pricing](/for-clinics).
- End with one short, low-key paragraph on how ${b.name} can help, with one link.
- "title": 60 characters or fewer, natural, includes the main search phrase.
- "description": a 120–155 character meta description that makes someone want to read it.
- "keywords": 3–6 search phrases the article answers.`;
}

function cleanDraft(d: Record<string, unknown> | null) {
  if (!d) return null;
  const title = typeof d.title === "string" ? d.title.trim().replace(/^#+\s*/, "") : "";
  const description = typeof d.description === "string" ? d.description.trim() : "";
  let body = typeof d.body === "string" ? d.body.trim() : "";
  // Drop a repeated title line if the model added one.
  body = body.replace(/^#\s+.+\n+/, "");
  const keywords = Array.isArray(d.keywords) ? d.keywords.filter((k): k is string => typeof k === "string").map((k) => k.trim().toLowerCase()).filter(Boolean).slice(0, 8) : [];
  return title && body ? { title, description, body, keywords } : null;
}

async function uniqueSlug(base: string, exceptId?: string) {
  const root = base || "post";
  for (let n = 1; ; n++) {
    const slug = n === 1 ? root : `${root}-${n}`;
    const hit = await prisma.blogPost.findUnique({ where: { slug }, select: { id: true } });
    if (!hit || hit.id === exceptId) return slug;
  }
}

function aiError(code: string | null) {
  if (code === "ai_unavailable") return "AI isn't available: add the API key for the provider chosen in Admin → Settings → Blog (OPENAI_API_KEY for OpenAI), or pick another provider.";
  if (code === "ai_budget_exhausted") return "The AI spend cap for today or this month has been reached (Settings → Growth). Try again later or raise the cap.";
  return `The AI couldn't write a usable draft (${code ?? "unknown error"}). Try again, or simplify the topic.`;
}

export interface DraftInput {
  topic: string;
  audience: string;
  keywords?: string;
  notes?: string;
}

/** Writes a DRAFT post with AI. Never publishes. */
export async function draftPost(actor: Actor, input: DraftInput): Promise<{ post: BlogPost; check: BlogCheck }> {
  requireAdmin(actor);
  const topic = input.topic.trim();
  if (topic.length < 5) throw new DomainError("VALIDATION", "Describe the topic in a few words.");
  const audience = asAudience(input.audience);
  const s = await getSettings();
  const [facts, existing] = await Promise.all([approvedFacts(s), prisma.blogPost.findMany({ where: { status: { not: "ARCHIVED" } }, select: { title: true }, take: 200, orderBy: { createdAt: "desc" } })]);
  const user = [
    `Topic: ${topic}`,
    `Audience: ${AUDIENCE_LABEL[audience]}`,
    input.keywords?.trim() ? `Search phrases to cover naturally: ${input.keywords.trim()}` : null,
    input.notes?.trim() ? `Editor's notes: ${input.notes.trim()}` : null,
    existing.length ? `Existing articles (don't repeat them; you may link to /blog):\n${existing.map((e) => `- ${e.title}`).join("\n")}` : null,
    `FACTS (the only source for anything about ${brand().name}):\n${facts}`,
  ]
    .filter(Boolean)
    .join("\n\n");
  const r = await ai("blog", "write", await systemPrompt(s), user, DRAFT_SCHEMA, 12_000, { provider: s["blog.aiProvider"], model: s["blog.aiModel"] });
  const d = cleanDraft(r.data);
  if (!d) throw new DomainError("VALIDATION", aiError(r.error));
  const post = await prisma.blogPost.create({
    data: {
      slug: await uniqueSlug(slugify(d.title)),
      title: d.title,
      description: d.description,
      body: d.body,
      keywords: d.keywords,
      audience,
      aiGenerated: true,
      aiModel: r.model,
      brief: topic,
      createdById: actor.userId,
    },
  });
  await audit(prisma, actor, "blog.drafted", "BlogPost", post.id, null, { title: post.title, model: r.model });
  return { post, check: await checkPost(post, s) };
}

const TOPICS_SCHEMA = {
  type: "object",
  properties: { topics: { type: "array", items: { type: "object", properties: { topic: { type: "string" }, audience: { type: "string", enum: AUDIENCES } }, required: ["topic", "audience"], additionalProperties: false } } },
  required: ["topics"],
  additionalProperties: false,
};

/** Topic ideas that answer real search questions and don't repeat existing posts. */
export async function suggestTopics(actor: Actor, audience: string, count = 8): Promise<{ topic: string; audience: BlogAudience }[]> {
  requireAdmin(actor);
  const s = await getSettings();
  const existing = await prisma.blogPost.findMany({ select: { title: true, brief: true }, take: 300, orderBy: { createdAt: "desc" } });
  const a = asAudience(audience);
  const user = `Suggest ${count} blog topics for ${AUDIENCE_LABEL[a]}${a === "ALL" ? " (mix both audiences)" : ""}. Each should answer a specific question people actually search for, be useful without reading anything else, and fit a coverage marketplace's blog. Skip anything already covered:\n${existing.map((e) => `- ${e.title}`).join("\n") || "(no posts yet)"}`;
  const r = await ai("blog", "classify", await systemPrompt(s), user, TOPICS_SCHEMA, 3000, { provider: s["blog.aiProvider"], model: s["blog.aiModel"] });
  const list = Array.isArray(r.data?.topics) ? (r.data.topics as { topic?: unknown; audience?: unknown }[]) : null;
  if (!list) throw new DomainError("VALIDATION", aiError(r.error));
  return list
    .filter((t): t is { topic: string; audience: string } => typeof t.topic === "string" && t.topic.trim().length >= 5)
    .map((t) => ({ topic: t.topic.trim(), audience: a === "ALL" ? asAudience(String(t.audience)) : a }))
    .slice(0, count);
}

/**
 * Daily: keeps up to blog.autoDraftsPerWeek AI drafts per 7 days, at most one
 * per day, from the topic queue (then AI suggestions). Drafts wait for review.
 */
export async function autoDraftSweep(now = clock.now()) {
  const s = await getSettings();
  const perWeek = s["blog.autoDraftsPerWeek"];
  if (perWeek <= 0) return { drafted: 0, reason: "off" };
  const since = (h: number) => new Date(+now - h * 3_600_000);
  const [week, day] = await Promise.all([
    prisma.blogPost.count({ where: { aiGenerated: true, createdById: null, createdAt: { gte: since(24 * 7) } } }),
    prisma.blogPost.count({ where: { aiGenerated: true, createdById: null, createdAt: { gte: since(20) } } }),
  ]);
  if (week >= perWeek || day > 0) return { drafted: 0, reason: "quota" };
  const used = new Set((await prisma.blogPost.findMany({ select: { brief: true } })).map((p) => p.brief?.trim().toLowerCase()).filter(Boolean));
  let next: { topic: string; audience: BlogAudience } | undefined = s["blog.topicQueue"].find((t) => !used.has(t.topic.trim().toLowerCase()));
  try {
    if (!next) next = (await suggestTopics(SYSTEM, "CLINIC", 3)).find((t) => !used.has(t.topic.toLowerCase()));
    if (!next) return { drafted: 0, reason: "no_topic" };
    const { post, check } = await draftPost(SYSTEM, { topic: next.topic, audience: next.audience });
    await notifyAdmins(prisma, {
      template: "blog_draft_ready",
      title: `New blog draft to review: ${post.title}`,
      body: check.errors.length ? `${check.errors.length} item(s) to fix before it can be published.` : "Ready for your review. Nothing is published until you click Publish.",
      link: `/admin/blog/${post.id}`,
      email: true,
      ctaLabel: "Review the draft",
    });
    return { drafted: 1, reason: "ok" };
  } catch (e) {
    return { drafted: 0, reason: (e as Error).message.slice(0, 200) };
  }
}

// ---------------- editing & publishing ----------------

export async function listPosts(actor: Actor) {
  requireAdmin(actor);
  return prisma.blogPost.findMany({ orderBy: [{ status: "asc" }, { updatedAt: "desc" }] });
}

export async function getPost(actor: Actor, id: string) {
  requireAdmin(actor);
  const post = await prisma.blogPost.findUnique({ where: { id } });
  if (!post) throw new DomainError("NOT_FOUND", "Post not found.");
  return { post, check: await checkPost(post) };
}

export interface PostEdit {
  title: string;
  slug: string;
  description: string;
  body: string;
  audience: string;
  keywords: string;
}

export async function createPost(actor: Actor, e: Pick<PostEdit, "title">) {
  requireAdmin(actor);
  const title = e.title.trim() || "Untitled post";
  const post = await prisma.blogPost.create({ data: { title, slug: await uniqueSlug(slugify(title)), description: "", body: "", createdById: actor.userId } });
  await audit(prisma, actor, "blog.created", "BlogPost", post.id);
  return post;
}

export async function savePost(actor: Actor, id: string, e: PostEdit) {
  requireAdmin(actor);
  const before = await prisma.blogPost.findUnique({ where: { id } });
  if (!before) throw new DomainError("NOT_FOUND", "Post not found.");
  const slug = slugify(e.slug || e.title);
  if (!slug) throw new DomainError("VALIDATION", "Add a title or web address.");
  const taken = await prisma.blogPost.findUnique({ where: { slug }, select: { id: true } });
  if (taken && taken.id !== id) throw new DomainError("VALIDATION", `Another post already uses /blog/${slug}.`);
  const data = {
    title: e.title.trim(),
    slug,
    description: e.description.trim(),
    body: e.body.replace(/\r\n?/g, "\n").trim(),
    audience: asAudience(e.audience),
    keywords: e.keywords.split(",").map((k) => k.trim().toLowerCase()).filter(Boolean).slice(0, 12),
  };
  if (before.status === "PUBLISHED") {
    const check = await checkPost(data);
    if (check.errors.length) throw new DomainError("VALIDATION", `This post is live, so it must stay publishable: ${check.errors[0]}`);
  }
  const post = await prisma.blogPost.update({ where: { id }, data });
  await audit(prisma, actor, "blog.saved", "BlogPost", id, { title: before.title, slug: before.slug }, { title: post.title, slug: post.slug });
  return post;
}

export async function publishPost(actor: Actor, id: string) {
  requireAdmin(actor);
  const post = await prisma.blogPost.findUnique({ where: { id } });
  if (!post) throw new DomainError("NOT_FOUND", "Post not found.");
  const s = await getSettings();
  const check = await checkPost(post, s);
  if (check.errors.length) throw new DomainError("VALIDATION", `Fix before publishing: ${check.errors.join(" ")}`);
  const updated = await prisma.blogPost.update({
    where: { id },
    data: { status: "PUBLISHED", publishedAt: post.publishedAt ?? clock.now(), publishedById: actor.userId, authorName: s["blog.authorName"].trim() || `The ${brand().name} team` },
  });
  await audit(prisma, actor, "blog.published", "BlogPost", id, { status: post.status }, { status: "PUBLISHED" });
  return updated;
}

export async function setPostStatus(actor: Actor, id: string, status: "DRAFT" | "ARCHIVED") {
  requireAdmin(actor);
  const post = await prisma.blogPost.update({ where: { id }, data: { status } });
  await audit(prisma, actor, `blog.${status === "DRAFT" ? "unpublished" : "archived"}`, "BlogPost", id, null, { status });
  return post;
}

export async function deletePost(actor: Actor, id: string) {
  requireAdmin(actor);
  const post = await prisma.blogPost.findUnique({ where: { id } });
  if (!post) return;
  if (post.status === "PUBLISHED") throw new DomainError("VALIDATION", "Unpublish the post before deleting it.");
  await prisma.blogPost.delete({ where: { id } });
  await audit(prisma, actor, "blog.deleted", "BlogPost", id, { title: post.title, slug: post.slug }, null);
}

// ---------------- public ----------------

const published = { status: "PUBLISHED" as const, publishedAt: { not: null } };

export async function publicPosts(opts: { audience?: string; take?: number } = {}) {
  const audience = opts.audience ? asAudience(opts.audience.toUpperCase()) : null;
  return prisma.blogPost.findMany({
    where: { ...published, ...(audience && audience !== "ALL" ? { audience: { in: [audience, "ALL"] } } : {}) },
    orderBy: { publishedAt: "desc" },
    take: opts.take ?? 50,
  });
}

export async function publicPost(slug: string) {
  return prisma.blogPost.findFirst({ where: { slug, ...published } });
}

export async function relatedPosts(post: Pick<BlogPost, "id" | "audience">, take = 3) {
  return prisma.blogPost.findMany({
    where: { ...published, id: { not: post.id }, ...(post.audience !== "ALL" ? { audience: { in: [post.audience, "ALL"] } } : {}) },
    orderBy: { publishedAt: "desc" },
    take,
  });
}
