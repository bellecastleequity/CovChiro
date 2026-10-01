import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { admin as adminSvc, invalidateSettings, seo } from "@cm/services";
import { makeClinic, makeProvider, makeShift } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
async function setting(key: string, value: unknown) {
  await adminSvc.updateSetting(admin, key, value);
  invalidateSettings();
}

afterEach(async () => {
  await setting("seo.publicJobListings", true);
});

describe("public job postings (Google for Jobs)", () => {
  it("publishes open, posted shifts with city-level facts only, and drops them once filled", async () => {
    const c = await makeClinic();
    const open = await makeShift(c.location.id);
    const draft = await makeShift(c.location.id, { status: "DRAFT" });
    await prisma.shift.update({ where: { id: draft.id }, data: { postedAt: null } });

    const jobs = await seo.publicJobs();
    const job = jobs.find((j) => j.id === open.id)!;
    expect(job).toBeTruthy();
    expect(jobs.some((j) => j.id === draft.id)).toBe(false);
    expect(job).toMatchObject({ city: c.location.city, state: "FL", providerPayCents: 37500, professionSlug: "chiropractic" });
    // Never the clinic's identity, street, price or arrival notes.
    const text = JSON.stringify(job);
    for (const secret of [c.org.displayName, c.org.legalName, "1 Test St", "Back door", "57500"]) expect(text).not.toContain(secret);

    expect(await seo.publicJob(open.id)).not.toBeNull();
    await prisma.shift.update({ where: { id: open.id }, data: { status: "CONFIRMED" } });
    expect(await seo.publicJob(open.id)).toBeNull();
  });

  it("the owner switch turns job listings off everywhere", async () => {
    const c = await makeClinic();
    const s = await makeShift(c.location.id);
    await setting("seo.publicJobListings", false);
    expect(await seo.publicJobs()).toEqual([]);
    expect(await seo.publicJob(s.id)).toBeNull();
  });
});

describe("landing pages and sitemap", () => {
  it("only live profession/state pairs and configured cities resolve", async () => {
    expect(await seo.resolveSeoPath("chiropractic", "florida")).toMatchObject({ state: "FL", stateName: "Florida" });
    expect((await seo.resolveSeoPath("chiropractic", "florida", "st-petersburg"))?.city).toBe("St Petersburg");
    expect(await seo.resolveSeoPath("chiropractic", "florida", "atlantis")).toBeNull();
    expect(await seo.resolveSeoPath("chiropractic", "atlantis")).toBeNull();
    expect(await seo.resolveSeoPath("no-such-profession", "florida")).toBeNull();
  });

  it("the sitemap lists hubs, every city page for clinics and providers, and live postings", async () => {
    const c = await makeClinic();
    const s = await makeShift(c.location.id);
    const paths = (await seo.sitemapEntries()).map((e) => e.path);
    expect(paths).toEqual(expect.arrayContaining(["/", "/for-clinics", "/jobs", "/chiropractic", "/chiropractic/florida", "/chiropractic/florida/tampa", "/jobs/chiropractic/florida/tampa", `/jobs/shift/${s.id}`]));
    expect(paths.some((p) => p.startsWith("/admin") || p.startsWith("/provider") || p.startsWith("/clinic"))).toBe(false);
    expect(new Set(paths).size).toBe(paths.length);
  });

  it("local numbers count verified providers near the city and hide small counts", async () => {
    // A geocoded practice in Tampa gives the city a center.
    await prisma.clinicProspect.create({ data: { clinicName: "Seo Test Chiro", city: "Tampa", state: "FL", lat: 27.95, lng: -82.46, publicToken: `seo${Date.now()}`.padEnd(40, "0").slice(0, 40) } });
    for (let i = 0; i < 3; i++) {
      const p = await makeProvider();
      await prisma.provider.update({ where: { id: p.id }, data: { homeLat: 27.9 + i * 0.01, homeLng: -82.4 } });
    }
    const cities = await seo.seoCities("FL");
    const d = await seo.cityPageData("DC", "FL", "Tampa", cities);
    expect(d.providersNearby).toBeGreaterThanOrEqual(3);
    expect(d.nearby).not.toContain("Tampa");
    expect(d.nearby.length).toBeGreaterThan(0);
    await setting("seo.localStatsMinimum", 100_000);
    expect((await seo.cityPageData("DC", "FL", "Tampa", cities)).providersNearby).toBeNull();
    await setting("seo.localStatsMinimum", 3);
  });
});
