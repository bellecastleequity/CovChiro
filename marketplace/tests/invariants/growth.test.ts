import { readFileSync } from "node:fs";
import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { devOutbox, mailProvider, setLlmProvider, type LlmProvider } from "@cm/integrations";
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
  // These tests move the clock across days: keep the prospecting send window open all week.
  await setting("growth.outreachSendDays", [0, 1, 2, 3, 4, 5, 6]);
  await setting("growth.outreachSendFrom", "00:00");
  await setting("growth.outreachSendUntil", "23:59");
  await setting("growth.clinicMarketing", true);
});

afterEach(async () => {
  setClock(null);
  setLlmProvider(null);
  await setting("growth.pausedOutbound", false);
  await setting("growth.providerMarketing", true);
  await setting("growth.clinicMarketing", true);
  await setting("growth.outreachMode", "review");
  await setting("growth.agents", { ...(await import("@cm/config")).defaultSettings()["growth.agents"] });
});

describe("provider pipeline: pre-licensure → credentials → coverage-ready", () => {
  it("registers through a school link, then gets only the message that fits their current state", async () => {
    const email = `grad-${uid()}@test.dev`;
    const grad = new Date(Date.now() - 35 * DAY).toISOString().slice(0, 10);
    await auth.signup({ role: "provider", name: "Casey Grad", email, password: "a-long-password-1", professionCodes: ["DC"], acceptTerms: true, campaign: "palmer", graduationDate: grad, isStudent: true });
    const p = await prisma.provider.findFirstOrThrow({ where: { user: { email } } });
    // "palmer" is a student-path recruitment link (Admin → Recruitment), so Growth credits it as such.
    expect(p).toMatchObject({ campaignCode: "palmer", isStudent: true, growthSource: "recruitment" });

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

describe("failed sends don't loop", () => {
  it("a rejected welcome email is retried at most 3 times, 6 hours apart, with the provider's own error kept", async () => {
    const m = mailProvider() as { send: (x: unknown) => Promise<boolean>; lastError?: string | null };
    const real = m.send;
    m.send = async () => ((m.lastError = "SendGrid 400: Does not contain a valid address."), false);
    try {
      const p = await makeProvider({ licenses: [], malpractice: null, professions: [{ code: "DC", status: "ONBOARDING" }], status: "ONBOARDING" });
      const failed = async () => (await comms(p.id)).filter((x) => x.promptKey === "PROVIDER_WELCOME" && x.status === "FAILED");
      await growth.growthTick();
      expect((await failed()).map((x) => x.error)).toEqual([expect.stringContaining("SendGrid 400: Does not contain a valid address.")]);
      // The next sweeps (every 15 minutes) leave it alone until 6 hours have passed.
      setClock(() => new Date(Date.now() + 15 * 60_000));
      await growth.growthTick();
      expect(await failed()).toHaveLength(1);
      setClock(() => new Date(Date.now() + 7 * 3600_000));
      await growth.growthTick();
      setClock(() => new Date(Date.now() + 14 * 3600_000));
      await growth.growthTick();
      expect(await failed()).toHaveLength(3);
      // Three strikes: it gives up instead of trying every sweep for two weeks.
      setClock(() => new Date(Date.now() + 21 * 3600_000));
      await growth.growthTick();
      setClock(() => new Date(Date.now() + 28 * 3600_000));
      await growth.growthTick();
      expect(await failed()).toHaveLength(3);
      // Giving up is recorded once, not on every sweep.
      expect((await comms(p.id)).filter((x) => x.promptKey === "PROVIDER_WELCOME" && x.blockReason === "send_failed_gave_up")).toHaveLength(1);
    } finally {
      m.send = real;
    }
  });

  it("our own account failing (out of credits) never makes it give up: the email goes once the account works", async () => {
    const m = mailProvider() as { send: (x: unknown) => Promise<boolean>; lastError?: string | null };
    const real = m.send;
    m.send = async () => ((m.lastError = "SendGrid 401: Maximum credits exceeded (from info@coverageoncall.com)"), false);
    try {
      const p = await makeProvider({ licenses: [], malpractice: null, professions: [{ code: "DC", status: "ONBOARDING" }], status: "ONBOARDING" });
      const welcome = async () => (await comms(p.id)).filter((x) => x.promptKey === "PROVIDER_WELCOME");
      for (const h of [0, 7, 14, 21, 28]) {
        setClock(() => new Date(Date.now() + h * 3600_000));
        await growth.growthTick();
      }
      expect((await welcome()).map((x) => x.status)).toEqual(["FAILED", "FAILED", "FAILED", "FAILED", "FAILED"]);
      m.send = real;
      setClock(() => new Date(Date.now() + 35 * 3600_000));
      await growth.growthTick();
      expect((await welcome()).filter((x) => x.status === "SENT")).toHaveLength(1);
    } finally {
      m.send = real;
    }
  });
});

describe("provider and clinic marketing switch independently", () => {
  it("provider marketing first: providers hear from us, clinics wait until clinic marketing is on", async () => {
    await setting("growth.clinicMarketing", false);
    await setting("growth.agents", { ...(await import("@cm/config")).defaultSettings()["growth.agents"], clinicOutreach: true });
    const p = await makeProvider({ licenses: [], malpractice: null, professions: [{ code: "DC", status: "ONBOARDING" }], status: "ONBOARDING" });
    const pr = await growth.saveProspect(admin, { clinicName: "Supply First Chiro", email: `sf-${uid()}@clinic.dev`, city: "Tampa" });
    await growth.growthTick();
    expect((await comms(p.id)).map((x) => x.promptKey)).toEqual(["PROVIDER_WELCOME"]);
    expect(await comms(pr.id)).toEqual([]);
    // Even a direct automated send to a clinic-side recipient waits (engine gate, not just the sweeps).
    const r = (await growth.recipient("PROSPECT", pr.id))!;
    await expect(growth.sendGrowthEmail(r, { subject: "x", body: "y" }, { agent: "clinicOutreach", purpose: "COMMERCIAL" })).rejects.toThrow(/audience_marketing_off/);

    await setting("growth.clinicMarketing", true);
    await growth.growthTick();
    expect((await comms(pr.id)).map((x) => x.status)).toEqual(["PENDING_APPROVAL"]);
  });

  it("clinic marketing alone: provider follow-ups wait", async () => {
    await setting("growth.providerMarketing", false);
    const p = await makeProvider({ licenses: [], malpractice: null, professions: [{ code: "DC", status: "ONBOARDING" }], status: "ONBOARDING" });
    await growth.growthTick();
    expect(await comms(p.id)).toEqual([]);
    await setting("growth.providerMarketing", true);
    await growth.growthTick();
    expect((await comms(p.id)).map((x) => x.promptKey)).toEqual(["PROVIDER_WELCOME"]);
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

  it("bulk approve queues drafts, sends them in the background and waits out a pause instead of dropping them", async () => {
    await setting("growth.agents", { ...(await import("@cm/config")).defaultSettings()["growth.agents"], clinicOutreach: true });
    const a = await growth.saveProspect(admin, { clinicName: "Bulk One Chiropractic", ownerName: "Dr. Lee One", email: `bulk1-${uid()}@clinic.dev`, city: "Tampa", zip: "33602", providerCount: 1 });
    const b = await growth.saveProspect(admin, { clinicName: "Bulk Two Chiropractic", ownerName: "Dr. Lee Two", email: `bulk2-${uid()}@clinic.dev`, city: "Tampa", zip: "33602", providerCount: 1 });
    await growth.growthTick();
    const drafts = [(await comms(a.id))[0], (await comms(b.id))[0]];
    expect(drafts.map((d) => d.status)).toEqual(["PENDING_APPROVAL", "PENDING_APPROVAL"]);
    expect((await growth.approvals(admin)).filter((m) => drafts.some((d) => d.id === m.id)).map((m) => m.kind)).toEqual(["clinic", "clinic"]);

    expect((await growth.bulkDecide(admin, drafts.map((d) => d.id), "approve")).count).toBe(2);
    expect((await comms(a.id))[0].status).toBe("QUEUED");
    // The outreach agent never drafts a second message while one is queued.
    await growth.growthTick();
    expect((await comms(a.id)).length).toBe(1);

    await setting("growth.pausedOutbound", true);
    const held = await growth.approvedQueueSweep();
    expect(held.sent).toBe(0);
    expect(held.held).toBeTruthy();
    expect((await comms(a.id))[0].status).toBe("QUEUED");
    expect((await growth.approvalQueue(admin)).heldReason).toBeTruthy();

    await setting("growth.pausedOutbound", false);
    await growth.approvedQueueSweep(500);
    expect((await comms(a.id))[0].status).toBe("APPROVED");
    expect((await comms(b.id))[0].status).toBe("APPROVED");
    expect((await prisma.clinicProspect.findUniqueOrThrow({ where: { id: a.id } })).outreachStep).toBe(1);
    expect(sentTo((await prisma.clinicProspect.findUniqueOrThrow({ where: { id: b.id } })).email!).length).toBe(1);
  });

  it("an approved draft whose send fails releases its step, so outreach writes it again (and update 054 repairs old ones)", async () => {
    await setting("growth.agents", { ...(await import("@cm/config")).defaultSettings()["growth.agents"], clinicOutreach: true });
    const pr = await growth.saveProspect(admin, { clinicName: "Outage Chiropractic", ownerName: "Dr. Out Age", email: `outage-${uid()}@clinic.dev`, city: "Tampa", zip: "33602", providerCount: 1 });
    await growth.growthTick();
    const draft = (await comms(pr.id))[0];
    expect(draft.status).toBe("PENDING_APPROVAL");
    await growth.bulkDecide(admin, [draft.id], "approve");
    const m = mailProvider() as { send: (x: unknown) => Promise<boolean>; lastError?: string | null };
    const real = m.send;
    m.send = async () => ((m.lastError = "SendGrid 401: Maximum credits exceeded"), false);
    try {
      await growth.approvedQueueSweep();
    } finally {
      m.send = real;
    }
    const after = await prisma.communication.findUniqueOrThrow({ where: { id: draft.id } });
    expect(after.status).toBe("FAILED");
    expect(after.dedupeKey).toBeNull();
    // Six hours on, the outreach agent drafts the step again for approval.
    setClock(() => new Date(Date.now() + 7 * 3600_000));
    await growth.growthTick();
    expect((await comms(pr.id)).filter((x) => x.status === "PENDING_APPROVAL" && x.promptKey === draft.promptKey)).toHaveLength(1);

    // Update 054: a draft left REJECTED (with its key) by the old code after a failed send is released;
    // one a person rejected is not.
    const fresh = (await comms(pr.id)).find((x) => x.status === "PENDING_APPROVAL")!;
    await prisma.communication.update({ where: { id: fresh.id }, data: { status: "REJECTED", createdById: admin.userId } });
    await prisma.communication.create({ data: { entityType: "PROSPECT", entityId: pr.id, channel: "EMAIL", agent: fresh.agent, purpose: fresh.purpose, promptKey: fresh.promptKey, status: "FAILED", error: "SendGrid 401", createdById: admin.userId } });
    const other = await growth.saveProspect(admin, { clinicName: "Said No Chiropractic", email: `no-${uid()}@clinic.dev`, city: "Tampa" });
    const rejected = await prisma.communication.create({ data: { entityType: "PROSPECT", entityId: other.id, channel: "EMAIL", agent: "clinicOutreach", purpose: "COMMERCIAL", promptKey: fresh.promptKey, status: "REJECTED", dedupeKey: `outreach:${other.id}:0`, createdById: admin.userId } });
    const sql = readFileSync(new URL("../../packages/db/prisma/migrations/0057_release_failed_drafts/migration.sql", import.meta.url), "utf8");
    await prisma.$executeRawUnsafe(sql);
    await prisma.$executeRawUnsafe(sql);
    expect(await prisma.communication.findUniqueOrThrow({ where: { id: fresh.id } })).toMatchObject({ status: "FAILED", dedupeKey: null });
    expect(await prisma.communication.findUniqueOrThrow({ where: { id: rejected.id } })).toMatchObject({ status: "REJECTED", dedupeKey: `outreach:${other.id}:0` });
  });

  it("prospects sharing one inbox get each email once, never three copies or a repeat", async () => {
    await setting("growth.outreachMode", "auto");
    await setting("growth.agents", { ...(await import("@cm/config")).defaultSettings()["growth.agents"], clinicOutreach: true });
    const email = `records-${uid()}@complete-care.test`;
    const loc = (n: string) => prisma.clinicProspect.create({ data: { clinicName: `Complete Care ${n}`, city: "Orlando", state: "FL", email: n === "B" ? email.toUpperCase() : email, emailStatus: "VALID", stage: "CONTACTABLE", publicToken: uid(), researchStatus: "DONE" } });
    const [a, b, c] = [await loc("A"), await loc("B"), await loc("C")];
    const sentTo = () => prisma.communication.findMany({ where: { toAddress: email, status: "SENT" }, orderBy: { createdAt: "asc" } });
    await growth.growthTick();
    expect((await sentTo()).map((x) => x.promptKey)).toEqual(["CLINIC_FIRST_CONTACT"]);
    // Next run: the other two locations are caught up to what the inbox already got (no email).
    await growth.growthTick();
    expect(await sentTo()).toHaveLength(1);
    const steps = await prisma.clinicProspect.findMany({ where: { id: { in: [a.id, b.id, c.id] } }, select: { outreachStep: true } });
    expect(steps.map((x) => x.outreachStep)).toEqual([1, 1, 1]);
    // "Send the first email now" refuses a location whose inbox already got it.
    const ready = await growth.outreachReadiness(c.id);
    expect(ready.firstNow).toBe(false);
    // The follow-up goes once, to the inbox, when it's due.
    setClock(() => new Date(Date.now() + 8 * DAY));
    await growth.growthTick();
    await growth.growthTick();
    expect((await sentTo()).map((x) => x.promptKey)).toEqual(["CLINIC_FIRST_CONTACT", "CLINIC_VACATION_EDUCATION"]);
    // A reply from any location stops the inbox for all of them.
    await prisma.clinicProspect.update({ where: { id: b.id }, data: { stage: "ENGAGED" } });
    setClock(() => new Date(Date.now() + 30 * DAY));
    await growth.growthTick();
    expect(await sentTo()).toHaveLength(2);
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

describe("student path × Growth: no overlaps", () => {
  const credentialMail = async (id: string) => (await comms(id)).filter((x) => x.promptKey === "PROVIDER_LICENSE_REMINDER" || x.promptKey === "PROVIDER_MALPRACTICE_REMINDER");
  const student = async (extra: Record<string, unknown> = {}) => {
    const p = await makeProvider({ status: "ONBOARDING", licenses: [], malpractice: null, professions: [{ code: "DC", status: "ONBOARDING" }] });
    await prisma.provider.update({ where: { id: p.id }, data: { preLicensure: true, preLicensureSince: new Date(Date.now() - 100 * DAY), graduationDate: new Date(Date.now() - 40 * DAY), ...extra } });
    return p;
  };

  it("students on the student path never get Growth's credential reminders — opted out or not", async () => {
    const a = await student();
    const b = await student({ credFollowupOptOut: true });
    for (const d of [1, 30, 70]) {
      setClock(() => new Date(Date.now() + d * DAY));
      await growth.growthTick();
    }
    expect(await credentialMail(a.id)).toHaveLength(0);
    expect(await credentialMail(b.id)).toHaveLength(0);
  });

  it("unsubscribing from Growth email also stops the student follow-ups", async () => {
    const { prelicensure } = await import("@cm/services");
    const p = await student({ graduationDate: new Date(Date.now() - 45 * DAY) });
    const u = await prisma.user.findUniqueOrThrow({ where: { id: (await prisma.provider.findUniqueOrThrow({ where: { id: p.id } })).userId } });
    await growth.suppress("EMAIL", u.email, "UNSUBSCRIBED", "test");
    const before = sentTo(u.email).length;
    await prelicensure.runPreLicensureFollowups();
    expect(sentTo(u.email).length).toBe(before);
  });

  it("a /join code can't exist in both campaign lists", async () => {
    const { prelicensure } = await import("@cm/services");
    await expect(growth.saveCampaign(admin, { code: "palmer", name: "Palmer again", audience: "PROVIDER", kind: "school" })).rejects.toThrow(/already a recruitment link/);
    const code = `g-${uid()}`.toLowerCase().slice(0, 20);
    await growth.saveCampaign(admin, { code, name: "A Growth link", audience: "PROVIDER", kind: "event" });
    await expect(prelicensure.saveCampaign(admin, { slug: code, name: "Same code", kind: "EVENT" })).rejects.toThrow(/already a Growth campaign code/);
    // Growth's starter school links never duplicate the student path's.
    expect(await prisma.growthCampaign.count({ where: { code: { in: ["palmer", "keiser"] } } })).toBe(0);
  });

  it("no second 'you're ready' email when the platform already sent one", async () => {
    const p = await makeProvider();
    await prisma.digestSend.create({ data: { key: `ready:${p.id}:DC`, userId: p.userId } });
    await growth.growthTick();
    expect((await comms(p.id)).map((x) => x.promptKey)).not.toContain("PROVIDER_COVERAGE_READY");
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: p.id } })).activationCount).toBe(1);
  });
});

describe("prospecting send window", () => {
  it("Ready to go out lists researched prospects due at the next window, without sending", async () => {
    await setting("growth.outreachSendDays", [1, 2, 3, 4, 5]);
    await setting("growth.outreachSendFrom", "08:15");
    await setting("growth.outreachSendUntil", "17:00");
    await setting("growth.outreachMode", "auto");
    await setting("growth.agents", { ...(await import("@cm/config")).defaultSettings()["growth.agents"], clinicOutreach: true });
    const email = `ready-${uid()}@clinic.test`;
    const p = await prisma.clinicProspect.create({ data: { clinicName: `Ready ${uid()}`, city: "Orlando", state: "FL", email, emailStatus: "VALID", stage: "CONTACTABLE", intentScore: 99, publicToken: uid(), researchStatus: "DONE" } });
    try {
      setClock(() => new Date("2026-10-17T13:30:00Z")); // Saturday 9:30 ET
      const up = await growth.upNext(admin);
      expect(up.windowOpen).toBe(false);
      expect(up.sendAt?.toISOString()).toBe("2026-10-19T12:15:00.000Z"); // Monday 8:15 ET
      const row = up.clinic.rows.find((r) => r.id === p.id);
      expect(row).toMatchObject({ email, step: 0, emailKey: "CLINIC_FIRST_CONTACT" });
      expect(await prisma.communication.count({ where: { entityId: p.id } })).toBe(0);
      // Unsubscribed addresses never show.
      await prisma.clinicProspect.update({ where: { id: p.id }, data: { doNotContact: true } });
      expect((await growth.upNext(admin)).clinic.rows.some((r) => r.id === p.id)).toBe(false);
    } finally {
      await prisma.clinicProspect.delete({ where: { id: p.id } });
      await setting("growth.outreachSendDays", [0, 1, 2, 3, 4, 5, 6]);
      await setting("growth.outreachSendFrom", "00:00");
      await setting("growth.outreachSendUntil", "23:59");
    }
  });

  it("clinic and provider outreach only run on the set days and hours (Eastern)", async () => {
    await setting("growth.outreachSendDays", [1, 2, 3, 4, 5]);
    await setting("growth.outreachSendFrom", "08:15");
    await setting("growth.outreachSendUntil", "17:00");
    await setting("growth.agents", { ...(await import("@cm/config")).defaultSettings()["growth.agents"], clinicOutreach: true, providerOutreach: true });
    try {
      setClock(() => new Date("2026-10-17T13:30:00Z")); // Saturday 9:30 ET
      expect(await growth.outreachSweep()).toMatchObject({ outsideWindow: true, sent: 0, drafts: 0 });
      expect(await growth.providerOutreachSweep()).toMatchObject({ outsideWindow: true, sent: 0, drafts: 0 });
      setClock(() => new Date("2026-10-19T12:10:00Z")); // Monday 8:10 ET: not yet
      expect((await growth.outreachSweep()).outsideWindow).toBe(true);
      setClock(() => new Date("2026-10-19T12:15:00Z")); // Monday 8:15 ET
      expect((await growth.outreachSweep()).outsideWindow).toBe(false);
      expect((await growth.providerOutreachSweep()).outsideWindow).toBe(false);
    } finally {
      await setting("growth.outreachSendDays", [0, 1, 2, 3, 4, 5, 6]);
      await setting("growth.outreachSendFrom", "00:00");
      await setting("growth.outreachSendUntil", "23:59");
    }
  });
});
