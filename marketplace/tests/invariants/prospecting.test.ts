import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { setLlmProvider, setNppesProvider, type LlmProvider, type NppesQuery, type NppesRecord } from "@cm/integrations";
import { admin as adminSvc, growth, invalidateSettings } from "@cm/services";
import { uid } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };

async function setting(key: string, value: unknown) {
  await adminSvc.updateSetting(admin, key, value);
  invalidateSettings();
}

// A fake registry: one city with a 2-DC group (org + two people), a solo DC, and an out-of-state record.
function registry(city: string, zipBase: string): (q: NppesQuery) => NppesRecord[] {
  const street = `${Math.floor(Math.random() * 9000) + 100} Gulf Blvd`;
  const loc = (line1: string, zip: string, state = "FL") => ({ line1, line2: null, city: city.toUpperCase(), state, zip, phone: "7275550100" });
  const n = () => String(1000000000 + Math.floor(Math.random() * 8_999_999_999)).slice(0, 10);
  const recs: NppesRecord[] = [
    { npi: n(), kind: "organization", name: "GULF COAST FAMILY CHIROPRACTIC LLC", firstName: null, lastName: null, credential: null, taxonomyCodes: ["111N00000X"], location: loc(`${street} Suite 4`, `${zipBase}1234`) },
    { npi: n(), kind: "individual", name: "", firstName: "ANA", lastName: "RIVERA", credential: "D.C.", taxonomyCodes: ["111N00000X"], location: loc(`${street} STE 4`, zipBase) },
    { npi: n(), kind: "individual", name: "", firstName: "MARK", lastName: "HALE", credential: "DC", taxonomyCodes: ["111N00000X"], location: loc(`${street}, Suite 4`, zipBase) },
    { npi: n(), kind: "individual", name: "", firstName: "PRIYA", lastName: "NAIR", credential: "DC", taxonomyCodes: ["111N00000X"], location: loc(`${street.replace("Gulf", "Bay")}`, zipBase) },
    { npi: n(), kind: "individual", name: "", firstName: "OUT", lastName: "STATE", credential: "DC", taxonomyCodes: ["111N00000X"], location: loc("1 Peachtree St", "30303", "GA") },
  ];
  return (q) => (q.skip ? [] : recs.filter((r) => (q.enumerationType === "NPI-2" ? r.kind === "organization" : r.kind === "individual")));
}

function researcher(answer: (user: string) => Record<string, unknown>, calls: string[] = []): LlmProvider {
  return {
    name: "anthropic",
    generate: async (req) => ({ ok: false, error: "unused", model: req.model, inputTokens: 0, outputTokens: 0 }),
    research: async (req) => {
      calls.push(req.user);
      return { ok: true, data: answer(req.user), model: req.model, inputTokens: 20_000, outputTokens: 800, searches: 3, fetches: 2 };
    },
  };
}

const found = (o: Record<string, unknown> = {}) => ({
  found: true, closed: false, confidence: 0.9, practiceName: "Nair Spine & Wellness", website: "https://nairspinefl.com", email: "office@nairspinefl.com",
  emailSourceUrl: "https://nairspinefl.com/contact", phone: null, hasContactForm: true, practiceType: "family", multidisciplinary: false, franchiseName: null,
  locationsCount: 1, providerCount: 1, doctors: ["Dr. Priya Nair"], socialUrls: ["https://www.facebook.com/nairspine"], sources: ["https://nairspinefl.com/"], ...o,
});

beforeAll(async () => {
  await growth.ensureGrowthDefaults();
});

afterEach(async () => {
  setNppesProvider(null);
  setLlmProvider(null);
  await setting("growth.researchDailyBudgetCents", 500);
  await setting("growth.agents", { ...(await import("@cm/config")).defaultSettings()["growth.agents"] });
});

describe("automatic prospecting: registry discovery", () => {
  it("turns registry records into one prospect per practice location, and a re-run doesn't duplicate", async () => {
    const city = `Testville${uid()}`;
    const zip = "33706";
    const fake = registry(city, zip);
    setNppesProvider({ name: "fake", search: async (q) => fake(q) });

    const out = await growth.discoverySweep({ cities: [city] });
    expect(out).toMatchObject({ practices: 2, inserted: 2 });
    const rows = await prisma.clinicProspect.findMany({ where: { city }, orderBy: { clinicName: "asc" } });
    expect(rows.map((r) => [r.clinicName, r.providerCount, r.nameFromRegistry, r.researchStatus])).toEqual([
      ["Dr. Priya Nair, D.C.", 1, true, "PENDING"],
      ["Gulf Coast Family Chiropractic", 2, false, "PENDING"],
    ]);
    expect(rows[1].npis).toHaveLength(3);
    expect(rows[1].source).toBe("NPPES NPI registry");
    expect(rows[1].phone).toBe("(727) 555-0100");
    expect(rows.every((r) => r.email === null)).toBe(true); // the registry never supplies email

    const again = await growth.discoverySweep({ cities: [city] });
    expect(again).toMatchObject({ inserted: 0 });
    expect(await prisma.clinicProspect.count({ where: { city } })).toBe(2);
  });

  it("merges into a clinic someone entered by hand at the same address, without overwriting it", async () => {
    const city = `Mergeton${uid()}`;
    const fake = registry(city, "33701");
    const orgAddress = fake({ taxonomy: "Chiropractor", state: "FL", city, enumerationType: "NPI-2" })[0].location!.line1;
    const manual = await growth.saveProspect(admin, { clinicName: "Gulf Coast Chiro (my notes)", email: `front-${uid()}@gulf.example.com`, address: orgAddress.replace("Suite", "Ste"), city, zip: "33701" });
    setNppesProvider({ name: "fake", search: async (q) => fake(q) });
    await growth.discoverySweep({ cities: [city] });
    const row = await prisma.clinicProspect.findUniqueOrThrow({ where: { id: manual.id } });
    expect(row.clinicName).toBe("Gulf Coast Chiro (my notes)");
    expect(row.email).toBe(manual.email);
    expect(row.npis).toHaveLength(3);
    expect(row.addressKey).not.toBeNull();
  });

  it("rotates through the configured cities and remembers what it searched", async () => {
    const searched: string[] = [];
    setNppesProvider({ name: "fake", search: async (q) => { searched.push(q.city); return []; } });
    const before = await growth.prospectingTick();
    expect(before.discovery).toMatchObject({ errors: [] });
    const first = new Set(searched);
    expect(first.size).toBe(3); // growth.discoveryAreasPerRun
    searched.length = 0;
    await growth.prospectingTick();
    expect(searched.some((c) => first.has(c))).toBe(false);
  });
});

describe("automatic prospecting: AI web research", () => {
  async function solo() {
    const city = `Research${uid()}`;
    const fake = registry(city, "34102");
    setNppesProvider({ name: "fake", search: async (q) => fake(q) });
    await growth.discoverySweep({ cities: [city] });
    // Keep earlier tests' PENDING rows out of this batch.
    await prisma.clinicProspect.updateMany({ where: { researchStatus: "PENDING", NOT: { city } }, data: { researchStatus: "SKIPPED" } });
    return prisma.clinicProspect.findFirstOrThrow({ where: { city, nameFromRegistry: true } });
  }

  it("fills website, business email and practice name from cited research; logs cost", async () => {
    const p = await solo();
    const calls: string[] = [];
    setLlmProvider(researcher(() => found(), calls));
    const out = await growth.researchSweep();
    expect(out.researched).toBeGreaterThanOrEqual(1);
    const row = await prisma.clinicProspect.findUniqueOrThrow({ where: { id: p.id } });
    expect(row).toMatchObject({
      clinicName: "Nair Spine & Wellness", nameFromRegistry: false, website: "https://nairspinefl.com", email: "office@nairspinefl.com",
      researchStatus: "DONE", hasContactForm: true, segment: "solo", stage: "CONTACTABLE",
    });
    expect(row.sourceUrls).toContain("https://nairspinefl.com/contact");
    expect(calls.some((c) => c.includes(row.address!))).toBe(true);
    const usage = await prisma.aiUsage.findFirstOrThrow({ where: { task: "research" }, orderBy: { createdAt: "desc" } });
    expect(usage.costMicroUsd).toBeGreaterThan(30_000); // 3 searches alone = 3¢
  });

  it("a personal address or an uncited email is never stored; low confidence changes nothing", async () => {
    const p = await solo();
    setLlmProvider(researcher(() => found({ email: "priya.nair88@gmail.com" })));
    await growth.researchSweep();
    expect((await prisma.clinicProspect.findUniqueOrThrow({ where: { id: p.id } })).email).toBeNull();

    const q = await solo();
    setLlmProvider(researcher(() => found({ confidence: 0.2 })));
    await growth.researchSweep();
    expect(await prisma.clinicProspect.findUniqueOrThrow({ where: { id: q.id } })).toMatchObject({ researchStatus: "NOT_FOUND", website: null, email: null, clinicName: "Dr. Priya Nair, D.C." });
  });

  it("a closed practice is paused; without AI or over budget nothing is lost", async () => {
    const p = await solo();
    // No AI provider: stays PENDING.
    expect(await growth.researchProspect(p.id)).toBe("ai_unavailable");
    expect((await prisma.clinicProspect.findUniqueOrThrow({ where: { id: p.id } })).researchStatus).toBe("PENDING");
    // Over budget: stays PENDING.
    setLlmProvider(researcher(() => found({ closed: true })));
    await setting("growth.researchDailyBudgetCents", 0);
    expect(await growth.researchProspect(p.id)).toBe("budget");
    await setting("growth.researchDailyBudgetCents", 500);
    expect(await growth.researchProspect(p.id)).toBe("done");
    expect(await prisma.clinicProspect.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ outreachPaused: true });
  });

  it("the Clinic Prospecting switch (with Provider Discovery off too) stops the registry search and research", async () => {
    await setting("growth.agents", { ...(await import("@cm/config")).defaultSettings()["growth.agents"], clinicProspecting: false, providerDiscovery: false });
    let called = false;
    setNppesProvider({ name: "fake", search: async () => { called = true; return []; } });
    expect(await growth.discoverySweep()).toMatchObject({ skipped: "agent off" });
    expect(await growth.researchSweep()).toMatchObject({ stopped: "agent off" });
    expect(called).toBe(false);
  });
});

describe("research when the AI provider refuses", () => {
  const refusing = (error: string): LlmProvider => ({
    name: "openai",
    generate: async (req) => ({ ok: false, error: "unused", model: req.model, inputTokens: 0, outputTokens: 0 }),
    research: async (req) => ({ ok: false, error, model: req.model, inputTokens: 900, outputTokens: 0, searches: 0, fetches: 0 }),
  });
  afterEach(async () => {
    await prisma.setting.deleteMany({ where: { key: "growth.researchPause" } });
  });

  it("out of credits: the clinic goes back in the queue untouched, research pauses, and resumes on request", async () => {
    const city = `Quota${uid()}`;
    const fake = registry(city, "33701");
    setNppesProvider({ name: "fake", search: async (q) => fake(q) });
    await growth.discoverySweep({ cities: [city] });
    const p = await prisma.clinicProspect.findFirstOrThrow({ where: { city } });
    setLlmProvider(refusing("HTTP 429 insufficient_quota: You exceeded your current quota, please check your plan and billing details."));
    expect(await growth.researchProspect(p.id, { force: true })).toBe("quota");
    expect(await prisma.clinicProspect.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ researchStatus: "PENDING", researchAttempts: 0 });
    expect((await growth.researchPause())?.reason).toBe("quota");
    // While paused nothing is spent.
    const calls = await prisma.aiUsage.count({ where: { task: "research" } });
    expect(await growth.researchSweep()).toMatchObject({ stopped: "paused" });
    expect(await prisma.aiUsage.count({ where: { task: "research" } })).toBe(calls);
    await growth.resumeResearchNow(admin);
    expect(await growth.researchPause()).toBeNull();
  });

  it("a short per-minute limit is waited out once, not failed", async () => {
    const tpm = "HTTP 429 rate_limit_exceeded: Rate limit reached for gpt-5.4-mini on tokens per min (TPM): Limit 200000, Used 186380, Requested 17874. Please try again in 300ms.";
    expect(growth.retryAfterMs(tpm)).toBe(300);
    expect(growth.retryAfterMs("Please try again in 1.276s")).toBe(1276);
    let calls = 0;
    const r = await growth.withRateLimitRetry(async () => (++calls === 1 ? { ok: false, error: tpm } : { ok: true }));
    expect(r.ok).toBe(true);
    expect(calls).toBe(2);
    // A daily limit is never "waited out".
    calls = 0;
    await growth.withRateLimitRetry(async () => (++calls, { ok: false, error: "HTTP 429 rate_limit_exceeded: requests per day (RPD). Please try again in 2s." }));
    expect(calls).toBe(1);
  });

  it("errors are told apart; a real failure counts an attempt and 'Retry failed' resets it", async () => {
    expect(growth.classifyAiError("HTTP 429 rate_limit_exceeded: Rate limit reached for gpt-6-luna on requests per day (RPD)")).toBe("rate_limited");
    expect(growth.classifyAiError("HTTP 401 invalid_api_key: Incorrect API key provided")).toBe("auth");
    expect(growth.classifyAiError("HTTP 503: overloaded")).toBe("transient");
    expect(growth.classifyAiError("unparseable output")).toBe("other");
    const city = `Retry${uid()}`;
    const fake = registry(city, "33702");
    setNppesProvider({ name: "fake", search: async (q) => fake(q) });
    await growth.discoverySweep({ cities: [city] });
    const p = await prisma.clinicProspect.findFirstOrThrow({ where: { city } });
    setLlmProvider(refusing("unparseable output"));
    expect(await growth.researchProspect(p.id, { force: true })).toBe("failed");
    expect(await prisma.clinicProspect.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ researchStatus: "FAILED", researchAttempts: 1 });
    expect(await growth.retryFailedResearch(admin, "clinics")).toBeGreaterThanOrEqual(1);
    expect(await prisma.clinicProspect.findUniqueOrThrow({ where: { id: p.id } })).toMatchObject({ researchStatus: "PENDING", researchAttempts: 0 });
  });
});
