import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { devOutbox, setLlmProvider, type LlmProvider } from "@cm/integrations";
import { admin as adminSvc, auth, growth, invalidateSettings, leads, setClock } from "@cm/services";
import { futureWeekday, makeClinic, makeProvider, uid } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
const DAY = 86_400_000;

async function setting(key: string, value: unknown) {
  await adminSvc.updateSetting(admin, key, value);
  invalidateSettings();
}
const comms = (entityId: string) => prisma.communication.findMany({ where: { entityId }, orderBy: { createdAt: "asc" } });
const sentTo = (email: string) => devOutbox.filter((m) => m.to === email && m.channel === "email");

beforeAll(async () => {
  await growth.ensureGrowthDefaults();
  await setting("growth.postalAddress", "1 Main St, Orlando, FL 32801");
});

afterEach(async () => {
  setClock(null);
  setLlmProvider(null);
  await setting("growth.pausedOutbound", false);
  await setting("growth.outreachMode", "review");
  await setting("growth.agents", { ...(await import("@cm/config")).defaultSettings()["growth.agents"] });
});

describe("provider pipeline: pre-licensure → credentials → coverage-ready", () => {
  it("registers through a school link, then gets only the message that fits their current state", async () => {
    const email = `grad-${uid()}@test.dev`;
    const grad = new Date(Date.now() - 35 * DAY).toISOString().slice(0, 10);
    await auth.signup({ role: "provider", name: "Casey Grad", email, password: "a-long-password-1", professionCodes: ["DC"], acceptTerms: true, campaign: "palmer", graduationDate: grad, isStudent: true });
    const p = await prisma.provider.findFirstOrThrow({ where: { user: { email } } });
    expect(p).toMatchObject({ campaignCode: "palmer", isStudent: true, growthSource: "school" });

    await growth.growthTick();
    let c = await comms(p.id);
    // Welcome + (35 days after graduation, no license) the license question. Same tick, but never two automated
    // messages inside the minimum gap: the second waits.
    expect(c.map((x) => x.promptKey)).toEqual(["PROVIDER_WELCOME"]);
    setClock(() => new Date(Date.now() + 1 * DAY));
    await growth.growthTick();
    c = await comms(p.id);
    expect(c.map((x) => x.promptKey)).toEqual(["PROVIDER_WELCOME", "PROVIDER_LICENSE_REMINDER"]);
    expect(sentTo(email).at(-1)?.subject).toBe("Have you received your chiropractic license?");

    // License uploaded → under review → no more license reminders.
    await prisma.license.create({ data: { providerId: p.id, professionCode: "DC", state: "FL", licenseNumber: `L${uid()}`, expiresAt: new Date("2030-01-01"), status: "PENDING_VERIFICATION" } });
    setClock(() => new Date(Date.now() + 40 * DAY));
    await growth.growthTick();
    expect((await comms(p.id)).length).toBe(2);
    expect((await growth.providerSnapshot(p.id))!.stage).toBe("CREDENTIAL_REVIEW");

    // License verified, malpractice missing → malpractice reminder (after the repeat spacing).
    await prisma.license.updateMany({ where: { providerId: p.id }, data: { status: "VERIFIED" } });
    setClock(() => new Date(Date.now() + 70 * DAY));
    await growth.growthTick();
    expect((await comms(p.id)).at(-1)?.promptKey).toBe("PROVIDER_MALPRACTICE_REMINDER");

    // Both verified → activation, then nothing more for a while.
    await prisma.malpracticePolicy.create({ data: { providerId: p.id, carrier: "X", policyNumber: uid(), perOccurrenceCents: 100_000_000, aggregateCents: 300_000_000, coveredProfessionCodes: ["DC"], expiresAt: new Date("2030-01-01"), documentUrl: "x.pdf", status: "VERIFIED" } });
    setClock(() => new Date(Date.now() + 72 * DAY));
    await growth.growthTick();
    expect((await comms(p.id)).at(-1)?.promptKey).toBe("PROVIDER_COVERAGE_READY");
    const n = (await comms(p.id)).length;
    setClock(() => new Date(Date.now() + 75 * DAY));
    await growth.growthTick();
    expect((await comms(p.id)).length).toBe(n);
  });

  it("the kill switch holds automated messages; nothing is lost", async () => {
    const p = await makeProvider({ licenses: [], malpractice: null, professions: [{ code: "DC", status: "ONBOARDING" }], status: "ONBOARDING" });
    await prisma.provider.update({ where: { id: p.id }, data: { createdAt: new Date(Date.now() - 40 * DAY) } });
    await setting("growth.pausedOutbound", true);
    await growth.growthTick();
    expect(await comms(p.id)).toEqual([]);
    await setting("growth.pausedOutbound", false);
    await growth.growthTick();
    expect((await comms(p.id)).map((x) => x.status)).toEqual(["SENT"]);
  });
});

describe("clinic outreach: review mode, compliance, unsubscribe", () => {
  it("drafts wait for approval, approval sends, unsubscribe stops everything", async () => {
    const email = `office-${uid()}@clinic.dev`;
    const pr = await growth.saveProspect(admin, { clinicName: "Bayside Chiropractic", ownerName: "Dr. Ana Rivera", email, city: "Tampa", zip: "33602", providerCount: 1 });
    expect((await prisma.clinicProspect.findUniqueOrThrow({ where: { id: pr.id } })).segment).toBe("solo");

    await growth.growthTick();
    expect(await comms(pr.id)).toEqual([]); // outreach agent is off until launch

    await setting("growth.agents", { ...(await import("@cm/config")).defaultSettings()["growth.agents"], clinicOutreach: true });
    await growth.growthTick();
    const [draft] = await comms(pr.id);
    expect(draft).toMatchObject({ status: "PENDING_APPROVAL", promptKey: "CLINIC_FIRST_CONTACT" });
    expect(draft.body).toContain("Dr. Rivera");
    expect(sentTo(email)).toEqual([]);

    await growth.decideApproval(admin, draft.id, "approve", { subject: "Keeping Bayside open when you're away" });
    expect(sentTo(email).at(-1)?.subject).toBe("Keeping Bayside open when you're away");
    expect((await prisma.clinicProspect.findUniqueOrThrow({ where: { id: pr.id } })).outreachStep).toBe(1);

    // Unsubscribe link → suppressed → the next step is blocked, not sent.
    const token = growth.unsubscribeToken("PROSPECT", pr.id);
    expect(await leads.unsubscribe(token)).toBe(true);
    await setting("growth.outreachMode", "auto");
    setClock(() => new Date(Date.now() + 6 * DAY));
    await growth.growthTick();
    expect((await comms(pr.id)).some((x) => x.status === "SENT" && x.promptKey === "CLINIC_VACATION_EDUCATION")).toBe(false);
    await expect(growth.sendManual(admin, "PROSPECT", pr.id, "Hi", "A personal note", "RELATIONSHIP")).rejects.toThrow(/suppressed_unsubscribe|unsubscribed/);
  });

  it("marketing email is blocked without a postal address (and waits rather than being dropped)", async () => {
    await setting("growth.postalAddress", "");
    await setting("growth.outreachMode", "auto");
    await setting("growth.agents", { ...(await import("@cm/config")).defaultSettings()["growth.agents"], clinicOutreach: true });
    const pr = await growth.saveProspect(admin, { clinicName: "North Spine", email: `n-${uid()}@clinic.dev`, city: "Orlando" });
    await growth.growthTick();
    expect(await comms(pr.id)).toEqual([]);
    await setting("growth.postalAddress", "1 Main St, Orlando, FL 32801");
    await growth.growthTick();
    expect((await comms(pr.id)).map((x) => x.status)).toEqual(["SENT"]);
  });

  it("an opt-out reply always suppresses; an interested reply escalates to a person", async () => {
    const a = await growth.saveProspect(admin, { clinicName: "Opt Out Chiro", email: `o-${uid()}@clinic.dev` });
    expect(await growth.logReply(admin, a.id, "Please remove me from your list.")).toBe("unsubscribed");
    expect(await prisma.commSuppression.findFirst({ where: { address: a.email! } })).toMatchObject({ reason: "UNSUBSCRIBE" });

    const b = await growth.saveProspect(admin, { clinicName: "Lawyer Chiro", email: `l-${uid()}@clinic.dev` });
    expect(await growth.logReply(admin, b.id, "My attorney says your contract terms are a problem.")).toBe("escalated:legal");
    // No AI configured in tests: anything else is handed to a person, never guessed.
    const c = await growth.saveProspect(admin, { clinicName: "Curious Chiro", email: `q-${uid()}@clinic.dev` });
    expect(await growth.logReply(admin, c.id, "Sounds good, can we talk next week?")).toMatch(/^escalated:/);
    expect(await prisma.escalation.count({ where: { entityId: { in: [b.id, c.id] } } })).toBe(2);
  });
});

describe("AI guardrails", () => {
  it("AI copy that adds a link or a promise falls back to the approved template", async () => {
    const fake: LlmProvider = {
      name: "anthropic",
      generate: async (req) => ({ ok: true, model: req.model, inputTokens: 100, outputTokens: 50, data: { subject: "Double your revenue", body: "Guaranteed results! Visit https://elsewhere.example now." } }),
    };
    setLlmProvider(fake);
    await setting("growth.outreachMode", "review");
    await setting("growth.agents", { ...(await import("@cm/config")).defaultSettings()["growth.agents"], clinicOutreach: true });
    const pr = await growth.saveProspect(admin, { clinicName: "Guardrail Chiro", ownerName: "Dr. Lee", email: `g-${uid()}@clinic.dev`, city: "Tampa" });
    await growth.growthTick();
    const [draft] = await comms(pr.id);
    expect(draft.subject).toBe("Keeping Guardrail Chiro open when you're away");
    expect(draft.body).not.toContain("elsewhere.example");
    expect(await prisma.agentActivity.findFirst({ where: { action: "ai_copy_rejected" }, orderBy: { createdAt: "desc" } })).toBeTruthy();
    expect(await prisma.aiUsage.count({ where: { agent: "clinicOutreach" } })).toBeGreaterThan(0);
  });

  it("a spent AI budget means no AI calls at all", async () => {
    let calls = 0;
    setLlmProvider({ name: "anthropic", generate: async (req) => { calls++; return { ok: false, error: "x", model: req.model, inputTokens: 0, outputTokens: 0 }; } });
    await setting("growth.aiDailyBudgetCents", 0);
    const r = await growth.askQuestion({ name: "Pat", email: `pat-${uid()}@clinic.dev`, question: "Can I request recurring coverage?" });
    expect(calls).toBe(0);
    expect(r.escalated).toBe(true);
    await setting("growth.aiDailyBudgetCents", 300);
  });
});

describe("signup recovery: started but unposted coverage requests", () => {
  it("follows up once per step, and multi-day requests reach the sales queue", async () => {
    const clinic = await makeClinic();
    await prisma.clinicOrg.update({ where: { id: clinic.org.id }, data: { createdAt: new Date(Date.now() - 3 * DAY) } });
    for (const days of [30, 31]) {
      const { startsAt, endsAt } = futureWeekday(days);
      await prisma.shift.create({ data: { locationId: clinic.location.id, state: "FL", professionCode: "DC", startsAt, endsAt, status: "DRAFT", clinicPriceCents: 60000, providerPayCents: 42500, createdById: clinic.user.id, createdAt: new Date(Date.now() - 6 * 3_600_000) } });
    }
    await growth.growthTick();
    await growth.growthTick();
    const c = await comms(clinic.org.id);
    expect(c.filter((x) => x.promptKey === "ABANDONED_COVERAGE_REQUEST").length).toBe(1);
    expect(await prisma.escalation.findFirst({ where: { entityType: "CLINIC", entityId: clinic.org.id, reasonCode: "unposted_request" } })).toBeTruthy();
    const queue = await growth.salesQueue(admin);
    expect(queue.find((q) => q.prospect.clinicOrgId === clinic.org.id)?.drafts.length).toBe(2);
  });
});

describe("analytics", () => {
  it("funnels and liquidity read from live data", async () => {
    await makeProvider({ home: { lat: 27.96, lng: -82.46, state: "FL" } });
    const f = await growth.growthFunnels();
    expect(f.clinic[0].label).toBe("Clinics identified");
    const tampa = (await growth.liquidity()).find((m) => m.market.key === "tampa")!;
    expect(tampa.within[25]).toBeGreaterThanOrEqual(1);
  });
});
