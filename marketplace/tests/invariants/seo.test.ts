import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { devOutbox, indexNowSent } from "@cm/integrations";
import { admin as adminSvc, invalidateSettings, seo, setClock } from "@cm/services";
import { insertAssignment, makeClinic, makeProvider, makeShift } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
async function setting(key: string, value: unknown) {
  await adminSvc.updateSetting(admin, key, value);
  invalidateSettings();
}
afterEach(async () => {
  setClock(null);
  await setting("reviews.googleReviewUrl", "");
});

describe("search pages", () => {
  it("lists the live state and area landing pages with the static pages", async () => {
    const paths = (await seo.publicPaths()).map((p) => p.path);
    expect(paths).toEqual(expect.arrayContaining(["/", "/for-clinics", "/chiropractic", "/chiropractic/florida", "/chiropractic/florida/central-florida", "/chiropractic/florida/south-florida"]));
    // Professions that aren't live get no state pages.
    expect(paths.some((p) => p.startsWith("/physical-therapy/"))).toBe(false);
  });

  it("has a stable IndexNow key and pings new blog posts", async () => {
    const k = await seo.indexNowKey();
    expect(k).toMatch(/^[0-9a-f]{32}$/);
    expect(await seo.indexNowKey()).toBe(k);
    const r = await seo.pingIndexNow(["/chiropractic/florida"]);
    expect(r.ok).toBe(true);
    expect(indexNowSent.at(-1)!.urls[0]).toMatch(/\/chiropractic\/florida$/);
  });

  it("adds keyword topics to the blog queue once", async () => {
    const a = await seo.addSeoTopics(admin);
    expect(a.added).toBeGreaterThan(5);
    expect((await seo.addSeoTopics(admin)).added).toBe(0);
  });
});

describe("Google review requests", () => {
  it("asks every clinic once after a completed shift, only when a review link is set", async () => {
    const { location, user } = await makeClinic();
    const provider = await makeProvider();
    const shift = await makeShift(location.id);
    const a = await insertAssignment(shift.id, provider.id);
    const done = new Date(Date.now() - 2 * 86_400_000);
    await prisma.assignment.update({ where: { id: a.id }, data: { status: "COMPLETED", completedAt: done } });

    expect(await seo.reviewRequestSweep()).toEqual({ off: true });
    await setting("reviews.googleReviewUrl", "https://g.page/r/test/review");
    const before = devOutbox.filter((m) => m.to === user.email).length;
    expect((await seo.reviewRequestSweep()).asked).toBeGreaterThanOrEqual(1);
    const mail = devOutbox.filter((m) => m.to === user.email);
    expect(mail.length).toBe(before + 1);
    expect(mail.at(-1)!.body).toMatch(/g\.page\/r\/test\/review/);

    // Not again for the same clinic within the repeat window.
    await seo.reviewRequestSweep();
    expect(devOutbox.filter((m) => m.to === user.email).length).toBe(before + 1);
  });
});
