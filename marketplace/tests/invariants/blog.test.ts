import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { setLlmProvider, type LlmProvider, type LlmRequest } from "@cm/integrations";
import { admin as adminSvc, blog, invalidateSettings, setClock } from "@cm/services";
import { uid } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
const DAY = 86_400_000;

async function setting(key: string, value: unknown) {
  await adminSvc.updateSetting(admin, key, value);
  invalidateSettings();
}

const para = (n: number) => Array.from({ length: n }, (_, i) => `practical${i}`).join(" ");
let calls: LlmRequest[] = [];
function fakeModel(body: string, title = `Planning coverage for a CE weekend ${uid()}`): LlmProvider {
  return {
    name: "openai",
    generate: async (req) => {
      calls.push(req);
      if (req.user.startsWith("Suggest")) return { ok: true, data: { topics: [{ topic: `Fresh idea ${uid()}`, audience: "CLINIC" }] }, model: req.model, inputTokens: 10, outputTokens: 10 };
      return {
        ok: true,
        data: { title, description: "A practical checklist for clinic owners booking a covering doctor while they attend continuing education.", keywords: ["CE coverage"], body },
        model: req.model,
        inputTokens: 100,
        outputTokens: 900,
      };
    },
  };
}
const CLEAN = `# Repeated title\n\n## Start early\n\n${para(200)}\n\n## Brief your team\n\n${para(200)} See [pricing](/for-clinics).`;

beforeEach(async () => {
  calls = [];
  await prisma.blogPost.deleteMany();
});
afterEach(async () => {
  setLlmProvider(null);
  setClock(null);
  await setting("blog.autoDraftsPerWeek", 1);
});

describe("blog: AI drafts, people publish", () => {
  it("an AI draft is saved as a DRAFT with the blog's provider/model and grounded in the published FAQ", async () => {
    setLlmProvider(fakeModel(CLEAN));
    const { post, check } = await blog.draftPost(admin, { topic: "CE weekend coverage", audience: "CLINIC" });
    expect(post).toMatchObject({ status: "DRAFT", aiGenerated: true, audience: "CLINIC", brief: "CE weekend coverage", publishedAt: null });
    expect(post.body.startsWith("## Start early")).toBe(true); // repeated H1 removed
    expect(check.errors).toEqual([]);
    expect(calls[0]!.model).toBe("gpt-4.1-mini");
    expect(calls[0]!.user).toContain("Can a provider licensed in another state cover my clinic?");
    expect(await blog.publicPosts()).toEqual([]);
    expect(await prisma.aiUsage.count({ where: { agent: "blog" } })).toBeGreaterThan(0);
  });

  it("publishing is refused while the content checks fail, and allowed once fixed", async () => {
    setLlmProvider(fakeModel(CLEAN + " Clinics see a guaranteed 30% more revenue at $499 a day."));
    const { post, check } = await blog.draftPost(admin, { topic: "Revenue", audience: "CLINIC" });
    expect(check.errors.join(" ")).toMatch(/guarantee/);
    expect(check.errors.join(" ")).toMatch(/\$499/);
    await expect(blog.publishPost(admin, post.id)).rejects.toThrow(/Fix before publishing/);
    await blog.savePost(admin, post.id, { title: post.title, slug: post.slug, description: post.description, body: CLEAN.replace("# Repeated title\n\n", ""), audience: "CLINIC", keywords: "ce coverage" });
    const live = await blog.publishPost(admin, post.id);
    expect(live.status).toBe("PUBLISHED");
    expect(live.authorName).toMatch(/team$/);
    expect((await blog.publicPost(live.slug))?.id).toBe(post.id);
  });

  it("a live post can't be edited into something unpublishable, or deleted while live", async () => {
    setLlmProvider(fakeModel(CLEAN));
    const { post } = await blog.draftPost(admin, { topic: "Live edits", audience: "ALL" });
    await blog.publishPost(admin, post.id);
    await expect(blog.savePost(admin, post.id, { title: post.title, slug: post.slug, description: post.description, body: "too short", audience: "ALL", keywords: "" })).rejects.toThrow(/must stay publishable/);
    await expect(blog.deletePost(admin, post.id)).rejects.toThrow(/Unpublish/);
    await blog.setPostStatus(admin, post.id, "DRAFT");
    expect(await blog.publicPost(post.slug)).toBeNull();
  });

  it("slugs stay unique", async () => {
    setLlmProvider(fakeModel(CLEAN, "Same title"));
    const a = await blog.draftPost(admin, { topic: "one topic", audience: "ALL" });
    const b = await blog.draftPost(admin, { topic: "two topic", audience: "ALL" });
    expect([a.post.slug, b.post.slug]).toEqual(["same-title", "same-title-2"]);
  });

  it("without an AI key the admin gets a clear message, not a broken draft", async () => {
    await expect(blog.draftPost(admin, { topic: "No key", audience: "ALL" })).rejects.toThrow(/AI isn't available/);
    expect(await prisma.blogPost.count()).toBe(0);
  });

  it("automatic drafting: queue topics first, one per day, capped per week, never published, admins notified", async () => {
    setLlmProvider(fakeModel(CLEAN));
    const owner = await prisma.user.create({ data: { email: `blog-adm-${uid()}@test.dev`, name: "Owner", role: "PLATFORM_ADMIN", emailVerifiedAt: new Date() } });
    await setting("blog.autoDraftsPerWeek", 2);
    const t0 = Date.now();
    expect(await blog.autoDraftSweep(new Date(t0))).toMatchObject({ drafted: 1 });
    expect(await blog.autoDraftSweep(new Date(t0 + 3_600_000))).toMatchObject({ drafted: 0, reason: "quota" }); // same day
    setClock(() => new Date(t0 + 1 * DAY));
    expect(await blog.autoDraftSweep(new Date(t0 + 1 * DAY))).toMatchObject({ drafted: 1 });
    setClock(() => new Date(t0 + 2 * DAY));
    expect(await blog.autoDraftSweep(new Date(t0 + 2 * DAY))).toMatchObject({ drafted: 0, reason: "quota" }); // weekly cap
    const posts = await prisma.blogPost.findMany({ orderBy: { createdAt: "asc" } });
    expect(posts.every((p) => p.status === "DRAFT" && p.createdById === null)).toBe(true);
    const queue = (await import("@cm/config")).defaultSettings()["blog.topicQueue"];
    expect(posts.map((p) => p.brief)).toEqual([queue[0]!.topic, queue[1]!.topic]);
    expect(await prisma.notification.count({ where: { userId: owner.id, template: "blog_draft_ready", channel: "in_app" } })).toBe(2);
  });

  it("off means off", async () => {
    setLlmProvider(fakeModel(CLEAN));
    await setting("blog.autoDraftsPerWeek", 0);
    expect(await blog.autoDraftSweep()).toMatchObject({ drafted: 0, reason: "off" });
    expect(calls).toEqual([]);
  });
});
