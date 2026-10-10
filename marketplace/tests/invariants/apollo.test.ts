import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import { defaultSettings } from "@cm/config";
import { prisma } from "@cm/db";
import { ApolloError, setApolloProvider, setNppesProvider, type ApolloProvider, type ApolloRaw, type NppesRecord } from "@cm/integrations";
import { admin as adminSvc, growth, invalidateSettings } from "@cm/services";
import { checkContact, recipient } from "../../packages/services/src/growth/engine";
import { makeProvider, uid } from "../factories";

/**
 * Apollo.io as an extra Growth prospecting source (owner request Oct 2026): records land in the
 * existing prospect tables without duplicates, credits are capped, errors pause Apollo, Canada
 * outreach is gated by CASL, and nothing here touches provider eligibility.
 */
const admin = { userId: null, role: "PLATFORM_ADMIN" as const, providerId: null, clinicOrgId: null };
const KEYS = ["growth.apollo.enabled", "growth.apollo.autoDiscovery", "growth.apollo.contactEnrichment", "growth.apollo.dailyCreditCap", "growth.apollo.monthlyCreditCap", "growth.apollo.largeJobCredits", "growth.canadaOutreach", "growth.acquisitionPriorities"] as const;
async function setting(key: string, value: unknown) {
  await adminSvc.updateSetting(admin, key, value);
  invalidateSettings();
}

type Fake = ApolloProvider & { people: ApolloRaw[]; orgs: ApolloRaw[]; enriched: Map<string, ApolloRaw>; calls: string[]; fail: ApolloError | null };
function fakeApollo(): Fake {
  const f: Fake = {
    name: "fake", people: [], orgs: [], enriched: new Map(), calls: [], fail: null,
    async health() { f.calls.push("health"); return { ok: true, detail: "ok" }; },
    async searchPeople(body) {
      f.calls.push(`people:${JSON.stringify(body.person_locations ?? body.organization_locations)}`);
      if (f.fail) throw f.fail;
      return { items: f.people, total: f.people.length, page: Number(body.page ?? 1), perPage: Number(body.per_page ?? 25) };
    },
    async searchOrganizations(body) {
      f.calls.push("orgs");
      if (f.fail) throw f.fail;
      return { items: f.orgs, total: f.orgs.length, page: Number(body.page ?? 1), perPage: 25 };
    },
    async enrichPeople(details) {
      f.calls.push(`enrich:${details.length}`);
      if (f.fail) throw f.fail;
      return details.map((d) => f.enriched.get(String(d.id))).filter(Boolean) as ApolloRaw[];
    },
    async enrichOrganization() { return null; },
  };
  return f;
}

let apollo: Fake;
beforeAll(async () => {
  await setting("growth.apollo.enabled", true);
  await setting("growth.apollo.dailyCreditCap", 50);
  await setting("growth.apollo.monthlyCreditCap", 1000);
  await setting("growth.apollo.largeJobCredits", 25);
});
afterEach(() => {
  setApolloProvider(null);
  setNppesProvider(null);
});
afterAll(async () => {
  const d = defaultSettings() as Record<string, unknown>;
  for (const k of KEYS) await setting(k, d[k]);
  await prisma.dataSourceUsage.deleteMany({});
  await prisma.setting.deleteMany({ where: { key: { in: ["growth.apollo.pause", "growth.apollo.cursor"] } } });
});
const fresh = async () => {
  apollo = fakeApollo();
  setApolloProvider(apollo);
  await prisma.dataSourceUsage.deleteMany({});
  await prisma.setting.deleteMany({ where: { key: "growth.apollo.pause" } });
};

const person = (o: Partial<Record<string, unknown>> = {}): ApolloRaw => ({ id: `ap-${uid()}`, first_name: "Ana", last_name_obfuscated: "Ri***a", title: "Chiropractor", state: "Georgia", city: "Atlanta", country: "United States", ...o });

describe("Apollo prospecting", () => {
  it("searches, previews with duplicate flags, and imports into the existing CRM without duplicates", async () => {
    await fresh();
    const a = person(), b = person({ first_name: "Bo", state: "Ontario", city: "Toronto", country: "Canada" });
    apollo.people = [a, b];
    const s1 = await growth.searchApollo(admin, { side: "SUPPLY", target: "people", region: "GA" });
    expect(s1.rows.map((r) => r.key)).toEqual([a.id, b.id]);
    expect(s1.credits).toBe(0); // people search is free
    expect(apollo.calls[0]).toContain("Georgia");
    const r1 = await growth.importApolloSearch(admin, s1.id, [String(a.id), String(b.id)], { enrich: false, approved: false });
    expect(r1).toMatchObject({ inserted: 2, updated: 0, credits: 0 });
    const ana = await prisma.providerProspect.findUniqueOrThrow({ where: { apolloPersonId: String(a.id) } });
    expect(ana).toMatchObject({ npi: null, state: "GA", source: "Apollo.io", title: "Chiropractor", contactStatus: "NONE", providerId: null });
    expect((await prisma.providerProspect.findUniqueOrThrow({ where: { apolloPersonId: String(b.id) } })).state).toBe("ON");
    // Same people again: flagged in the preview and updated, never duplicated.
    const s2 = await growth.searchApollo(admin, { side: "SUPPLY", target: "people", region: "GA" });
    expect(s2.rows.every((r) => r.duplicate === "Already a provider prospect")).toBe(true);
    const r2 = await growth.importApolloSearch(admin, s2.id, [String(a.id)], { enrich: false, approved: false });
    expect(r2).toMatchObject({ inserted: 0, updated: 1 });
    expect(await prisma.providerProspect.count({ where: { apolloPersonId: String(a.id) } })).toBe(1);
    // Nothing became a provider account or touched eligibility.
    expect(await prisma.provider.count({ where: { npi: null, legalName: "Ana" } })).toBe(0);
    // Usage is logged with estimated credits.
    expect(await prisma.dataSourceUsage.count({ where: { source: "apollo", operation: "people_search" } })).toBe(2);
  });

  it("enrichment: links to the NPI registry, keeps only acceptable emails, and respects credit caps and approval", async () => {
    await fresh();
    const npi = "1497758544";
    const last = `Zz${uid().slice(0, 5)}`;
    const reg: NppesRecord = { npi, kind: "individual", name: "", firstName: "LENA", lastName: last.toUpperCase(), credential: "DC", taxonomyCodes: ["111N00000X"], location: { line1: "1 Peach St", line2: null, city: "ATLANTA", state: "GA", zip: "30301", phone: null } };
    setNppesProvider({ name: "fake", search: async () => [], lookup: async () => reg, findPeople: async (q) => (q.lastName.toUpperCase() === last.toUpperCase() ? [reg] : []) });
    // Already found by registry discovery under that NPI.
    await growth.upsertProviderProspects([{ npi, firstName: "Lena", lastName: last, credential: "DC", displayName: `Lena ${last}, DC`, address: "1 Peach St", city: "Atlanta", state: "GA", zip: "30301", addressKey: `1 PEACH ST|30301-${uid()}`, providersAtPractice: 1 }], "DC");
    const p = person({ first_name: "Lena" });
    apollo.people = [p];
    apollo.enriched.set(String(p.id), { ...p, last_name: last, email: `lena.${last.toLowerCase()}@peachchiro.example`, email_status: "verified" });
    const s = await growth.searchApollo(admin, { side: "SUPPLY", target: "people", region: "GA" });
    // A large job needs approval; a small one doesn't.
    await setting("growth.apollo.largeJobCredits", 1);
    apollo.people = [p, person(), person()];
    const big3 = await growth.searchApollo(admin, { side: "SUPPLY", target: "people", region: "GA" });
    await expect(growth.importApolloSearch(admin, big3.id, big3.rows.map((r) => r.key), { enrich: true, approved: false })).rejects.toThrow(/large job/);
    await setting("growth.apollo.largeJobCredits", 25);
    const r = await growth.importApolloSearch(admin, s.id, [String(p.id)], { enrich: true, approved: false });
    expect(r).toMatchObject({ updated: 1, inserted: 0, credits: 1, withEmail: 1 });
    // Merged into the registry prospect (same NPI) instead of a second row.
    const row = await prisma.providerProspect.findUniqueOrThrow({ where: { npi } });
    expect(row).toMatchObject({ apolloPersonId: String(p.id), email: `lena.${last.toLowerCase()}@peachchiro.example`, emailOrigin: "apollo", contactStatus: "VERIFIED" });
    expect(await prisma.providerProspect.count({ where: { apolloPersonId: String(p.id) } })).toBe(1);
    // Daily cap: estimated credits stop the next paid job.
    await setting("growth.apollo.dailyCreditCap", 1);
    const s3 = await growth.searchApollo(admin, { side: "SUPPLY", target: "people", region: "GA" });
    await expect(growth.importApolloSearch(admin, s3.id, [String(p.id)], { enrich: true, approved: true })).rejects.toThrow(/today's Apollo credit cap/);
    await setting("growth.apollo.dailyCreditCap", 50);
  });

  it("skips people already on the platform", async () => {
    await fresh();
    const pr = await makeProvider();
    const email = (await prisma.user.findUniqueOrThrow({ where: { id: pr.userId } })).email;
    const p = person();
    apollo.people = [p];
    apollo.enriched.set(String(p.id), { ...p, last_name: "Known", email, email_status: "verified" });
    const s = await growth.searchApollo(admin, { side: "SUPPLY", target: "people", region: "GA" });
    const r = await growth.importApolloSearch(admin, s.id, [String(p.id)], { enrich: true, approved: true });
    expect(r).toMatchObject({ onPlatform: 1, inserted: 0 });
  });

  it("clinic decision-makers become clinic prospects, matched to an existing prospect by website", async () => {
    await fresh();
    const domain = `sun${uid().slice(0, 6)}.example`;
    const existing = await prisma.clinicProspect.create({ data: { clinicName: "Sunshine Spine", state: "FL", city: "Orlando", website: `https://www.${domain}`, publicToken: `t-${uid()}` } });
    const owner = person({ first_name: "Cara", title: "Owner", state: "Florida", city: "Orlando", organization_id: `org-${uid()}`, organization: { name: "Sunshine Spine", primary_domain: domain } });
    const assistant = person({ title: "Chiropractic Assistant", state: "Florida", organization_id: `org-${uid()}` });
    apollo.people = [owner, assistant];
    const s = await growth.searchApollo(admin, { side: "DEMAND", target: "people", region: "FL" });
    expect(s.rows.map((r) => r.key)).toEqual([owner.id]); // decision-makers only
    apollo.enriched.set(String(owner.id), { ...owner, last_name: "Diaz", email: `cara@${domain}`, email_status: "verified" });
    const r = await growth.importApolloSearch(admin, s.id, [String(owner.id)], { enrich: true, approved: true });
    expect(r).toMatchObject({ updated: 1, inserted: 0 });
    const c = await prisma.clinicProspect.findUniqueOrThrow({ where: { id: existing.id } });
    expect(c).toMatchObject({ apolloOrganizationId: owner.organization_id, email: `cara@${domain}`, decisionMakerTitle: "Owner", ownerName: "Cara Diaz", stage: "CONTACTABLE" });
    expect(await prisma.clinicProspect.count({ where: { website: { contains: domain } } })).toBe(1);
  });

  it("Apollo refusals pause Apollo for every agent until an admin resumes", async () => {
    await fresh();
    apollo.fail = new ApolloError("rate_limit", "Too many requests", 429, 120);
    await expect(growth.searchApollo(admin, { side: "SUPPLY", target: "people", region: "GA" })).rejects.toThrow(/Too many requests/);
    expect(await growth.apolloPause()).toMatchObject({ reason: "rate_limit" });
    await expect(growth.searchApollo(admin, { side: "SUPPLY", target: "people", region: "GA" })).rejects.toThrow(/paused/);
    expect((await growth.apolloStatus()).recent[0]).toMatchObject({ ok: false });
    await growth.resumeApollo(admin);
    expect(await growth.apolloPause()).toBeNull();
  });

  it("scheduled discovery searches Prelaunch/Live markets, splitting runs by each market's priority", async () => {
    await fresh();
    // Only our Georgia target is active for this run.
    const others = await prisma.growthTarget.findMany({ where: { status: { in: ["PRELAUNCH", "LIVE"] } } });
    await prisma.growthTarget.updateMany({ where: { id: { in: others.map((o) => o.id) } }, data: { status: "OFF" } });
    const ga = await prisma.growthTarget.upsert({ where: { professionCode_state: { professionCode: "DC", state: "GA" } }, create: { professionCode: "DC", state: "GA", status: "PRELAUNCH", cities: ["Atlanta", "Savannah", "Augusta"] }, update: { status: "PRELAUNCH", cities: ["Atlanta", "Savannah", "Augusta"] } });
    await setting("growth.apollo.autoDiscovery", true);
    await setting("growth.apollo.searchesPerRun", 3);
    apollo.people = [person({ title: "Owner", organization_id: `org-${uid()}`, organization: { name: "Peach Clinic" } })];
    const out = await growth.apolloDiscoverySweep();
    expect(out.searches).toBe(3);
    // Georgia is supply first: most searches look for providers, but clinics still get one.
    const bySide = await prisma.dataSourceUsage.groupBy({ by: ["side"], where: { task: "apolloDiscovery" }, _count: { _all: true } });
    const n = (side: string) => bySide.find((b) => b.side === side)?._count._all ?? 0;
    expect(n("SUPPLY")).toBe(2);
    expect(n("DEMAND")).toBe(1);
    // Switched off = nothing called.
    await setting("growth.apollo.autoDiscovery", false);
    apollo.calls = [];
    expect((await growth.apolloDiscoverySweep()).stopped).toBe("off");
    expect(apollo.calls).toEqual([]);
    await prisma.growthTarget.update({ where: { id: ga.id }, data: { status: "OFF" } });
    for (const o of others) await prisma.growthTarget.update({ where: { id: o.id }, data: { status: o.status } });
    await setting("growth.apollo.searchesPerRun", 2);
  });
});

describe("acquisition priorities and Canada", () => {
  it("Florida is demand first, everywhere else supply first, and admins can override a market", async () => {
    await setting("growth.acquisitionPriorities", { FL: "DEMAND" });
    const ctx = await growth.priorityContext();
    expect(ctx.resolve("FL").primary).toBe("DEMAND");
    for (const st of ["GA", "PR", "VI", "ON"]) expect(ctx.resolve(st).primary).toBe("SUPPLY");
    const key = `test-${uid()}`;
    await prisma.growthMarket.create({ data: { key, name: "Test Orlando", state: "FL", professionCode: "DC", centerLat: 28.5, centerLng: -81.4 } });
    await growth.setMarketPriority(admin, key, "SUPPLY");
    expect((await growth.priorityContext()).resolve("FL", key)).toEqual({ primary: "SUPPLY", source: "market" });
    await growth.setMarketPriority(admin, key, null);
    expect((await growth.priorityContext()).resolve("FL", key).primary).toBe("DEMAND");
    await prisma.growthMarket.delete({ where: { key } });
  });

  it("the Supply Gap agent stores each market's two-sided recommendation", async () => {
    const key = `test-rec-${uid()}`;
    await prisma.growthMarket.create({ data: { key, name: "Test far market", state: "FL", professionCode: "DC", centerLat: 24.6, centerLng: -81.9, radiusMiles: 5, targetProviders: 3 } });
    await growth.marketSupplySweep();
    expect(await prisma.growthMarket.findUniqueOrThrow({ where: { key } })).toMatchObject({ recommendedSide: "DEMAND", recommendationKind: "PRIORITY" });
    await prisma.growthMarket.delete({ where: { key } });
  });

  it("Canadian provinces can prospect (Prelaunch) but never go Live", async () => {
    await expect(growth.setTargetStatus(admin, "DC", "ON", "LIVE")).rejects.toThrow(/isn't open in Canada/);
    const t = await growth.setTargetStatus(admin, "DC", "ON", "PRELAUNCH");
    expect(t.cities).toContain("Toronto");
    expect(await prisma.growthMarket.count({ where: { state: "ON" } })).toBeGreaterThan(0);
    await growth.setTargetStatus(admin, "DC", "ON", "OFF");
  });

  it("CASL: no commercial email to a Canadian prospect without Canada outreach on and a consent basis", async () => {
    const p = await prisma.providerProspect.create({ data: { professionCode: "DC", displayName: "Bo Tremblay", firstName: "Bo", lastName: "Tremblay", state: "ON", email: `bo.tremblay.${uid()}@clinic.example`, contactStatus: "VERIFIED", emailStatus: "VALID", publicToken: `t-${uid()}` } });
    // A person-written email skips the automation pause and marketing switches, never CASL.
    const check = async () => checkContact((await recipient("PROVIDER_PROSPECT", p.id))!, "EMAIL", "COMMERCIAL", false);
    await setting("growth.canadaOutreach", false);
    expect((await check()).reason).toBe("canada_outreach_off");
    await setting("growth.canadaOutreach", true);
    expect((await check()).reason).toBe("casl_consent_missing");
    await prisma.providerProspect.update({ where: { id: p.id }, data: { consentBasis: "CONSPICUOUS_PUBLICATION" } });
    expect((await check()).reason).not.toMatch(/casl|canada/);
    await setting("growth.canadaOutreach", false);
  });
});
