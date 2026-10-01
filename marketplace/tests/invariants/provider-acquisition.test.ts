import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { devOutbox, setEmailVerifier, setLlmProvider, setNppesProvider, type LlmProvider, type NppesQuery, type NppesRecord } from "@cm/integrations";
import { admin as adminSvc, auth, growth, invalidateSettings, leads } from "@cm/services";
import { makeClinic, makeProvider, makeShift, uid } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
async function setting(key: string, value: unknown) {
  await adminSvc.updateSetting(admin, key, value);
  invalidateSettings();
}
const agents = async (on: Record<string, boolean>) => setting("growth.agents", { ...(await import("@cm/config")).defaultSettings()["growth.agents"], ...on });

const n = () => String(1000000000 + Math.floor(Math.random() * 8_999_999_999)).slice(0, 10);
const loc = (city: string, line1: string, zip = "33602") => ({ line1, line2: null, city: city.toUpperCase(), state: "FL", zip, phone: null });
const DC = ["111N00000X"];

/** A city with a two-doctor practice (org + 2 DCs) and a solo DC. */
function registry(city: string) {
  const group = `${100 + Math.floor(Math.random() * 800)} Bay St`, solo = `${100 + Math.floor(Math.random() * 800)} Palm Ave`;
  const recs: NppesRecord[] = [
    { npi: n(), kind: "organization", name: "BAY FAMILY CHIROPRACTIC LLC", firstName: null, lastName: null, credential: null, taxonomyCodes: DC, location: loc(city, group) },
    { npi: n(), kind: "individual", name: "", firstName: "ANA", lastName: "RIVERA", credential: "D.C.", taxonomyCodes: DC, location: loc(city, group) },
    { npi: n(), kind: "individual", name: "", firstName: "MARK", lastName: "HALE", credential: "DC", taxonomyCodes: DC, location: loc(city, group) },
    { npi: n(), kind: "individual", name: "", firstName: "PRIYA", lastName: "NAIR", credential: "DC", taxonomyCodes: DC, location: loc(city, solo) },
  ];
  return { recs, search: async (q: NppesQuery) => (q.skip ? [] : recs.filter((r) => (q.enumerationType === "NPI-2") === (r.kind === "organization"))) };
}

function researcher(answer: (user: string) => Record<string, unknown>): LlmProvider {
  return {
    name: "anthropic",
    generate: async (req) => ({ ok: false, error: "unused", model: req.model, inputTokens: 0, outputTokens: 0 }),
    research: async (req) => ({ ok: true, data: answer(req.user), model: req.model, inputTokens: 5000, outputTokens: 300, searches: 2, fetches: 1 }),
  };
}

async function discover() {
  const city = `Acq${uid()}`;
  const reg = registry(city);
  setNppesProvider({ name: "fake", search: reg.search });
  await growth.discoverySweep({ cities: [city] });
  return { city, reg };
}

beforeAll(async () => {
  await growth.ensureGrowthDefaults();
  await setting("growth.postalAddress", "1 Main St, Orlando, FL 32801");
});

afterEach(async () => {
  setNppesProvider(null);
  setLlmProvider(null);
  setEmailVerifier(null);
  await setting("growth.agents", { ...(await import("@cm/config")).defaultSettings()["growth.agents"] });
  await setting("growth.providerOutreachMode", "review");
});

describe("provider discovery", () => {
  it("the same registry pass yields provider prospects, linked to their practice; anyone already on the platform is skipped", async () => {
    const city = `Disc${uid()}`;
    const reg = registry(city);
    const already = await makeProvider();
    await prisma.provider.update({ where: { id: already.id }, data: { npi: reg.recs[2].npi } });
    setNppesProvider({ name: "fake", search: reg.search });
    const out = await growth.discoverySweep({ cities: [city] });
    expect(out).toMatchObject({ providersNew: 2 });
    const rows = await prisma.providerProspect.findMany({ where: { city }, orderBy: { lastName: "asc" } });
    expect(rows.map((r) => [r.displayName, r.providersAtPractice, r.practiceRole, r.stage])).toEqual([["Priya Nair, DC", 1, "OWNER", "DISCOVERED"], ["Ana Rivera, D.C.", 2, "UNKNOWN", "DISCOVERED"]]);
    expect(rows.every((r) => r.clinicProspectId && r.email === null && r.professionCode === "DC")).toBe(true);
    // Re-running doesn't duplicate.
    await growth.discoverySweep({ cities: [city] });
    expect(await prisma.providerProspect.count({ where: { city } })).toBe(2);
  });

  it("the Provider Discovery switch stops it (clinic discovery carries on)", async () => {
    await agents({ providerDiscovery: false });
    const { city } = await discover();
    expect(await prisma.providerProspect.count({ where: { city } })).toBe(0);
    expect(await prisma.clinicProspect.count({ where: { city } })).toBe(2);
  });
});

describe("contact discovery", () => {
  it("a researched solo practice's email reaches its owner for free; a group practice's shared inbox is never used", async () => {
    const { city } = await discover();
    const [nair, rivera] = await Promise.all([
      prisma.providerProspect.findFirstOrThrow({ where: { city, lastName: "Nair" } }),
      prisma.providerProspect.findFirstOrThrow({ where: { city, lastName: "Rivera" } }),
    ]);
    await prisma.clinicProspect.update({ where: { id: nair.clinicProspectId! }, data: { researchStatus: "DONE", email: `info@nair${uid()}.com`, website: "https://nairchiro.com", providerCount: 1 } });
    await prisma.clinicProspect.update({ where: { id: rivera.clinicProspectId! }, data: { researchStatus: "DONE", email: `frontdesk@bayfamily${uid()}.com`, providerCount: 2 } });
    expect(await growth.discoverContact(nair.id)).toBe("verified");
    const n1 = await prisma.providerProspect.findUniqueOrThrow({ where: { id: nair.id } });
    expect(n1).toMatchObject({ contactStatus: "VERIFIED", stage: "CONTACT_VERIFIED", emailOrigin: "practice", researchCostMicroUsd: 0 });
    // Rivera: no AI under test → waits, never takes the shared inbox.
    expect(await growth.discoverContact(rivera.id)).toBe("ai_unavailable");
    expect((await prisma.providerProspect.findUniqueOrThrow({ where: { id: rivera.id } })).email).toBeNull();
  });

  it("web research: a cited email in their name is kept and verified; personal free-mail and ambiguous matches are not", async () => {
    const { city } = await discover();
    const rivera = await prisma.providerProspect.findFirstOrThrow({ where: { city, lastName: "Rivera" } });
    const hale = await prisma.providerProspect.findFirstOrThrow({ where: { city, lastName: "Hale" } }).catch(() => null);
    const base = { found: true, ambiguous: false, confidence: 0.9, practiceName: "Bay Family Chiropractic", practiceWebsite: "https://bayfamilychiro.com", role: "associate", providersAtPractice: 2, sources: ["https://bayfamilychiro.com/team"] };
    setLlmProvider(researcher(() => ({ ...base, email: "arivera@bayfamilychiro.com", emailSourceUrl: "https://bayfamilychiro.com/team" })));
    expect(await growth.discoverContact(rivera.id)).toBe("verified");
    expect(await prisma.providerProspect.findUniqueOrThrow({ where: { id: rivera.id } })).toMatchObject({ email: "arivera@bayfamilychiro.com", emailOrigin: "research", contactStatus: "VERIFIED", practiceRole: "ASSOCIATE" });
    expect((await prisma.aiUsage.findFirstOrThrow({ where: { agent: "contactDiscovery" }, orderBy: { createdAt: "desc" } })).costMicroUsd).toBeGreaterThan(0);

    const nair = await prisma.providerProspect.findFirstOrThrow({ where: { city, lastName: "Nair" } });
    setLlmProvider(researcher(() => ({ ...base, role: "owner", providersAtPractice: 1, email: "priya.nair@gmail.com", emailSourceUrl: "https://nairchiro.com/contact" })));
    expect(await growth.discoverContact(nair.id)).toBe("rejected");
    expect((await prisma.providerProspect.findUniqueOrThrow({ where: { id: nair.id } })).email).toBeNull();

    if (hale) {
      setLlmProvider(researcher(() => ({ ...base, ambiguous: true, email: null, emailSourceUrl: null })));
      expect(await growth.discoverContact(hale.id)).toBe("ambiguous");
      expect(await prisma.providerProspect.findUniqueOrThrow({ where: { id: hale.id } })).toMatchObject({ needsReview: true, researchStatus: "AMBIGUOUS" });
    }
  });

  it("a domain that doesn't take mail isn't verified", async () => {
    const { city } = await discover();
    const nair = await prisma.providerProspect.findFirstOrThrow({ where: { city, lastName: "Nair" } });
    await growth.updateProviderProspect(admin, nair.id, { email: "dr.nair@nairchiro.invalid" });
    expect(await prisma.providerProspect.findUniqueOrThrow({ where: { id: nair.id } })).toMatchObject({ contactStatus: "INVALID", needsReview: true });
  });
});

describe("recruitment outreach", () => {
  async function verifiedProspect(state = "FL") {
    const { city } = await discover();
    const p = await prisma.providerProspect.findFirstOrThrow({ where: { city, lastName: "Nair" } });
    await prisma.providerProspect.update({ where: { id: p.id }, data: { state, email: `dr.nair${uid()}@nairchiro.com`, contactStatus: "VERIFIED", stage: "CONTACT_VERIFIED" } });
    // Keep other tests' verified prospects out of this run.
    await prisma.providerProspect.updateMany({ where: { id: { not: p.id }, contactStatus: "VERIFIED", providerId: null }, data: { outreachPaused: true } });
    return prisma.providerProspect.findUniqueOrThrow({ where: { id: p.id } });
  }

  it("off by default; in review mode the first email waits for approval, approval sends it and advances the sequence", async () => {
    const p = await verifiedProspect();
    await growth.growthTick();
    expect(await prisma.communication.count({ where: { entityId: p.id } })).toBe(0); // launch switch is off

    await agents({ providerOutreach: true });
    await growth.growthTick();
    const [draft] = await prisma.communication.findMany({ where: { entityId: p.id } });
    expect(draft).toMatchObject({ entityType: "PROVIDER_PROSPECT", status: "PENDING_APPROVAL", promptKey: "PROVIDER_RECRUIT_FIRST_CONTACT" });
    expect(draft.body).toContain("Dr. Nair");
    expect(draft.body).toContain(`c=${p.publicToken}`);

    await growth.decideApproval(admin, draft.id, "approve");
    expect(devOutbox.filter((m) => m.to === p.email).length).toBe(1);
    expect(await prisma.providerProspect.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ outreachStep: 1, stage: "CONTACTED" });

    // Their unsubscribe link suppresses the address everywhere.
    expect(await leads.unsubscribe(growth.unsubscribeToken("PROVIDER_PROSPECT", p.id))).toBe(true);
    expect(await prisma.providerProspect.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ emailStatus: "UNSUBSCRIBED", outreachPaused: true });
  });

  it("only in prelaunch/live markets", async () => {
    const p = await verifiedProspect("ND"); // no growth target in North Dakota
    await agents({ providerOutreach: true });
    await growth.growthTick();
    expect(await prisma.communication.count({ where: { entityId: p.id } })).toBe(0);
  });

  it("signing up through their link links the account and attributes it", async () => {
    const p = await verifiedProspect();
    const email = `nair-${uid()}@test.dev`;
    await auth.signup({ role: "provider", name: "Priya Nair", email, password: "a-long-password-1", professionCodes: ["DC"], acceptTerms: true, prospectToken: p.publicToken });
    const prov = await prisma.provider.findFirstOrThrow({ where: { user: { email } } });
    expect(prov.growthSource).toBe("ai_prospecting");
    expect(await prisma.providerProspect.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ providerId: prov.id, stage: "REGISTERED" });
    expect((await growth.attributionDetail()).providerBySource.find((r) => r.key === "ai_prospecting")?.registered).toBeGreaterThanOrEqual(1);
  });

  it("replies: an opt-out suppresses; anything else goes to a person", async () => {
    const a = await verifiedProspect();
    expect(await growth.logProviderReply(admin, a.id, "Please remove me from your list")).toBe("unsubscribed");
    expect(await prisma.providerProspect.findUniqueOrThrow({ where: { id: a.id } })).toMatchObject({ stage: "NOT_INTERESTED" });
    const b = await verifiedProspect();
    expect(await growth.logProviderReply(admin, b.id, "Sounds interesting, how does pay work?")).toMatch(/^escalated/);
    expect(await prisma.escalation.count({ where: { entityType: "PROVIDER_PROSPECT", entityId: b.id } })).toBe(1);
  });
});

describe("supply & demand", () => {
  it("a market with demand and no coverage-ready providers is CRITICAL and goes to a person", async () => {
    const key = `test-${uid()}`;
    const clinic = await makeClinic();
    await prisma.growthMarket.create({ data: { key, name: `Test metro ${key}`, state: "FL", professionCode: "DC", centerLat: clinic.location.lat, centerLng: clinic.location.lng, radiusMiles: 1, targetProviders: 1000 } });
    await makeShift(clinic.location.id, { status: "OPEN", days: 9 });
    await growth.marketSupplySweep();
    const m = await prisma.growthMarket.findUniqueOrThrow({ where: { key } });
    expect(m.supplyStatus).toBe("CRITICAL");
    expect(await prisma.escalation.count({ where: { entityType: "MARKET", entityId: key, reasonCode: "supply_critical" } })).toBe(1);
    const [row] = await growth.marketSupply({ key });
    // Other test files put clinics at the same default address, so at least this one.
    expect(row.upcomingRequests).toBeGreaterThanOrEqual(1);
    expect(row).toMatchObject({ priority: "CRITICAL", readiness: "BUILDING_SUPPLY" });
  });
});

describe("command center", () => {
  it("every Growth view computes from live data", async () => {
    const [today, attention, board, ai, econ, funnel, schools, content, feed] = await Promise.all([
      growth.todayNumbers(), growth.needsAttention(), growth.agentBoard(), growth.aiCosts(), growth.economics(), growth.providerFunnel({ state: "FL" }), growth.schoolFunnel(), growth.contentStats(), growth.activityFeed({ limit: 10 }),
    ]);
    expect(today.providerProspects).toBeGreaterThan(0);
    expect(attention).toHaveProperty("markets");
    expect(board.map((b) => b.key)).toEqual(expect.arrayContaining(["providerDiscovery", "contactDiscovery", "providerOutreach", "providerReactivation", "content"]));
    expect(board.find((b) => b.key === "providerOutreach")?.on).toBe(false);
    expect(ai.byCategory.some((c) => c.key === "Prospect research")).toBe(true);
    expect(econ.totals.aiCents).toBeGreaterThanOrEqual(0);
    expect(funnel.steps.map((s) => s.stage)).toEqual(["DISCOVERED", "CONTACT_FOUND", "CONTACT_VERIFIED", "CONTACTED", "ENGAGED", "REGISTERED", "CREDENTIALING", "COVERAGE_READY", "FIRST_SHIFT", "REPEAT_PROVIDER"]);
    expect(funnel.steps[0].count).toBeGreaterThanOrEqual(funnel.steps[1].count);
    expect(Array.isArray(schools)).toBe(true);
    expect(content.counts).toBeDefined();
    expect(feed.length).toBeGreaterThan(0);
  });
});
