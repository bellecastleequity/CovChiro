import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { FakeSiteFinder, setLlmProvider, setSiteFinder, type LlmProvider } from "@cm/integrations";
import { admin as adminSvc, growth, invalidateSettings } from "@cm/services";
import { uid } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
async function setting(key: string, value: unknown) {
  await adminSvc.updateSetting(admin, key, value);
  invalidateSettings();
}

/** Fake AI research that records how many searches it was allowed. */
function researcher(calls: { user: string; maxSearches: number }[], answer: Record<string, unknown> = { found: false, confidence: 0 }): LlmProvider {
  return {
    name: "anthropic",
    generate: async (req) => ({ ok: false, error: "unused", model: req.model, inputTokens: 0, outputTokens: 0 }),
    research: async (req) => {
      calls.push({ user: req.user, maxSearches: req.maxSearches });
      return { ok: true, data: answer, model: req.model, inputTokens: 1000, outputTokens: 100, searches: 1, fetches: 0 };
    },
  };
}

function cf(email: string, key = 0x42) {
  return [key, ...[...email].map((c) => c.charCodeAt(0) ^ key)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

async function clinic(o: { name?: string; website?: string | null; zip?: string; address?: string } = {}) {
  const n = uid();
  return prisma.clinicProspect.create({
    data: {
      clinicName: o.name ?? `Harbor Chiropractic ${n}`, publicToken: `t${n}`, state: "FL", city: "Tampa", address: o.address ?? `${100 + Math.floor(Math.random() * 800)} Bay St`, zip: o.zip ?? "33602",
      website: o.website ?? null, source: "test",
    },
  });
}

let fake: FakeSiteFinder;
beforeAll(async () => {
  await growth.ensureGrowthDefaults();
});
afterEach(async () => {
  setSiteFinder(null);
  setLlmProvider(null);
  await prisma.setting.deleteMany({ where: { key: "growth.placesPause" } });
  await setting("growth.researchSiteFirst", true);
  await setting("growth.researchAiFallback", true);
  await setting("growth.researchDailyBudgetCents", 500);
  await setting("growth.researchPlacesMonthlyCap", 1000);
});

function newFake() {
  fake = new FakeSiteFinder();
  setSiteFinder(fake);
  return fake;
}

describe("website-first email finding (no AI)", () => {
  it("keeps the front-desk email from the clinic's own contact page and never calls the AI", async () => {
    const f = newFake();
    const p = await clinic({ website: "https://harbor-chiro.test" });
    f.pages.set("https://harbor-chiro.test", `<a href="/contact-us">Contact</a> <a href="/blog/1">Blog</a> Site by <a href="mailto:hello@chirowebdesigns.test">us</a>`);
    f.pages.set("https://harbor-chiro.test/contact-us", `<form><input type="email"><textarea></textarea></form> <a href="mailto:Info@Harbor-Chiro.test">Email</a> <a href="https://www.instagram.com/harborchiro/">IG</a>`);
    const calls: { user: string; maxSearches: number }[] = [];
    setLlmProvider(researcher(calls));
    expect(await growth.researchProspect(p.id)).toBe("done");
    const row = await prisma.clinicProspect.findUniqueOrThrow({ where: { id: p.id } });
    expect(row).toMatchObject({ email: "info@harbor-chiro.test", researchStatus: "DONE", hasContactForm: true, socialUrls: ["https://www.instagram.com/harborchiro/"] });
    expect(row.sourceUrls).toContain("https://harbor-chiro.test/contact-us");
    expect(calls).toHaveLength(0);
  });

  it("finds a missing website on Google Maps only when the listing matches the address, then reads it", async () => {
    const f = newFake();
    const p = await clinic({ name: `Seaside Spine ${uid()}`, address: "412 Bay St", zip: "33602" });
    f.places.set(p.clinicName, [
      { name: "Seaside Spine (other office)", address: "9 Elm Rd, Orlando, FL 32801, USA", website: "https://wrong.test", phone: null, status: "OPERATIONAL" },
      { name: "Seaside Spine & Rehab", address: "412 Bay St, Tampa, FL 33602, USA", website: "https://seasidespine.test/?utm_source=gmb", phone: "(813) 555-0142", status: "OPERATIONAL" },
    ]);
    f.pages.set("https://seasidespine.test", `<span data-cfemail="${cf("frontdesk@seasidespine.test")}">[email protected]</span>`);
    const before = await prisma.dataSourceUsage.count({ where: { source: "google_places" } });
    expect(await growth.researchProspect(p.id)).toBe("done");
    expect(await prisma.clinicProspect.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ website: "https://seasidespine.test", email: "frontdesk@seasidespine.test", phone: "(813) 555-0142" });
    expect(await prisma.dataSourceUsage.count({ where: { source: "google_places" } })).toBe(before + 1);
    expect(f.calls).not.toContain("page:https://wrong.test");
  });

  it("no email on the site: AI tries with the smaller search limit, and waits (without re-reading the site) while over budget", async () => {
    const f = newFake();
    const p = await clinic({ website: "https://quiet-chiro.test" });
    f.pages.set("https://quiet-chiro.test", `<a href="/contact">Contact</a><form><textarea></textarea></form>`);
    f.pages.set("https://quiet-chiro.test/contact", `<p>Call us!</p>`);
    const calls: { user: string; maxSearches: number }[] = [];
    setLlmProvider(researcher(calls));
    await setting("growth.researchDailyBudgetCents", 0);
    expect(await growth.researchProspect(p.id)).toBe("site_only");
    expect((await prisma.clinicProspect.findUniqueOrThrow({ where: { id: p.id } })).researchStatus).toBe("SITE_SCANNED");
    const pagesRead = f.calls.length;
    await setting("growth.researchDailyBudgetCents", 500);
    await growth.researchProspect(p.id);
    expect(f.calls.length).toBe(pagesRead);
    expect(calls).toHaveLength(1);
    expect(calls[0].maxSearches).toBe(2);
    expect(calls[0].user).toMatch(/already read/);
  });

  it("with the AI fallback off, a site without an email is finished without any AI cost", async () => {
    const f = newFake();
    await setting("growth.researchAiFallback", false);
    const p = await clinic({ website: "https://formonly.test" });
    f.pages.set("https://formonly.test", `<form action="/send"><input type="email"></form>`);
    const calls: { user: string; maxSearches: number }[] = [];
    setLlmProvider(researcher(calls));
    expect(await growth.researchProspect(p.id)).toBe("not_found");
    expect(await prisma.clinicProspect.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ researchStatus: "DONE", hasContactForm: true, email: null });
    expect(calls).toHaveLength(0);
  });

  it("a refused Google Maps key pauses lookups; nothing checked means research runs as before", async () => {
    const f = newFake();
    f.placesError = "Places API (New) has not been used in project 123 before or it is disabled.";
    const calls: { user: string; maxSearches: number }[] = [];
    setLlmProvider(researcher(calls));
    const p = await clinic();
    await growth.researchProspect(p.id);
    expect(await prisma.setting.findUnique({ where: { key: "growth.placesPause" } })).not.toBeNull();
    expect(calls[0].maxSearches).toBe(5);
    const q = await clinic();
    const lookups = f.calls.filter((c) => c.startsWith("places:")).length;
    await growth.researchProspect(q.id);
    expect(f.calls.filter((c) => c.startsWith("places:")).length).toBe(lookups);
  });

  it("finds a provider's own address on their practice's team page", async () => {
    const f = newFake();
    const practice = await clinic({ website: "https://groupchiro.test" });
    await prisma.clinicProspect.update({ where: { id: practice.id }, data: { providerCount: 3, researchStatus: "DONE" } });
    f.pages.set("https://groupchiro.test", `<a href="/our-team">Meet the team</a> <a href="mailto:info@groupchiro.test">x</a>`);
    f.pages.set("https://groupchiro.test/our-team", `Dr. Dana Whitfield — dwhitfield@groupchiro.test`);
    const n = uid();
    const pp = await prisma.providerProspect.create({
      data: { professionCode: "DC", displayName: "Dana Whitfield, DC", firstName: "Dana", lastName: "Whitfield", state: "FL", publicToken: `pp${n}`, clinicProspectId: practice.id, providersAtPractice: 3, practiceRole: "ASSOCIATE" },
    });
    const r = await growth.discoverContact(pp.id);
    expect(["found", "verified", "mx"]).toContain(r);
    expect(await prisma.providerProspect.findUniqueOrThrow({ where: { id: pp.id } })).toMatchObject({ email: "dwhitfield@groupchiro.test", emailOrigin: "website" });
  });

  it("providers with no known website: one Google Maps lookup per practice address, shared with everyone there", async () => {
    const f = newFake();
    const key = `addr-${uid()}`;
    const make = (first: string, last: string) => prisma.providerProspect.create({
      data: { professionCode: "DC", displayName: `${first} ${last}, DC`, firstName: first, lastName: last, state: "FL", publicToken: `pp${uid()}`, address: "77 Palm Ave", city: "Tampa", zip: "33606", addressKey: key, providersAtPractice: 2, practiceRole: "ASSOCIATE" },
    });
    const a = await make("Lena", "Ortiz");
    const b = await make("Sam", "Kerr");
    f.places.set("Lena Ortiz", [{ name: "Palm Ave Chiropractic", address: "77 Palm Ave, Tampa, FL 33606, USA", website: "https://palmavechiro.test", phone: null, status: "OPERATIONAL" }]);
    f.pages.set("https://palmavechiro.test", `<a href="/team">Our team</a>`);
    f.pages.set("https://palmavechiro.test/team", `Dr. Lena Ortiz: lortiz@palmavechiro.test · Dr. Sam Kerr: skerr@palmavechiro.test`);
    await growth.discoverContact(a.id);
    expect(await prisma.providerProspect.findUniqueOrThrow({ where: { id: b.id } })).toMatchObject({ website: "https://palmavechiro.test" });
    await growth.discoverContact(b.id);
    expect(f.calls.filter((c) => c.startsWith("places:"))).toHaveLength(1);
    expect((await prisma.providerProspect.findUniqueOrThrow({ where: { id: a.id } })).email).toBe("lortiz@palmavechiro.test");
    expect((await prisma.providerProspect.findUniqueOrThrow({ where: { id: b.id } })).email).toBe("skerr@palmavechiro.test");

    // An address Google Maps has no website for: the others there skip straight to the short AI fallback.
    const key2 = `addr-${uid()}`;
    const c = await prisma.providerProspect.create({ data: { professionCode: "DC", displayName: "Ira Blum, DC", firstName: "Ira", lastName: "Blum", state: "FL", publicToken: `pp${uid()}`, address: "5 Oak St", city: "Tampa", zip: "33607", addressKey: key2 } });
    const d = await prisma.providerProspect.create({ data: { professionCode: "DC", displayName: "Joy Park, DC", firstName: "Joy", lastName: "Park", state: "FL", publicToken: `pp${uid()}`, address: "5 Oak St", city: "Tampa", zip: "33607", addressKey: key2 } });
    f.places.set("Ira Blum", [{ name: "Oak St Wellness", address: "5 Oak St, Tampa, FL 33607, USA", website: null, phone: null, status: "OPERATIONAL" }]);
    await growth.discoverContact(c.id);
    expect((await prisma.providerProspect.findUniqueOrThrow({ where: { id: d.id } })).researchStatus).toBe("SITE_SCANNED");
  });
});
