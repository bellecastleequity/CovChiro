import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { devOutbox, setHumanVerifier, setLlmProvider } from "@cm/integrations";
import { auth, growth, leads, spam } from "@cm/services";
import { uid } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };

const PITCH = `Hi,

I wanted to quickly flag something we found while checking your website. Your SEO (Search Engine Optimization) setup appears to have some incomplete technical elements affecting search-engine crawling, indexing, and overall visibility on Google and Bing.

If you have a few minutes, reply with your phone number and a convenient time.

Thanks,
Daniel Edwards`;

const questionsFrom = (email: string) => prisma.escalation.findMany({ where: { entityType: "QUESTION", entityLabel: { contains: email } }, orderBy: { createdAt: "asc" } });

afterEach(() => {
  setHumanVerifier(null);
  setLlmProvider(null);
});

describe("Ask a question: spam folder", () => {
  it("files a cold SEO pitch in Spam: resolved, no notification, same reply as everyone", async () => {
    const email = `daniel-${uid()}@gmail.com`;
    const adminUser = await prisma.user.create({ data: { email: `admin-${uid()}@test.dev`, name: "Owner", role: "PLATFORM_ADMIN", emailVerifiedAt: new Date() } });
    const r = await growth.askQuestion({ name: "Daniel Edwards", email, question: PITCH });
    expect(r.escalated).toBe(true);
    const rows = await questionsFrom(email);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ status: "RESOLVED", spamCategory: "solicitation", reasonCode: "spam" });
    expect(rows[0].spamReasons).toContain("SEO pitch");
    expect(await prisma.notification.count({ where: { userId: adminUser.id, template: "growth_escalation" } })).toBe(0);
    // Not in the open queue or "include resolved"; only in the Spam view.
    expect((await growth.escalations(admin, "open")).some((e) => e.id === rows[0].id)).toBe(false);
    expect((await growth.escalations(admin, "all")).some((e) => e.id === rows[0].id)).toBe(false);
    expect((await growth.escalations(admin, "spam")).some((e) => e.id === rows[0].id)).toBe(true);

    // "Not spam" puts it back in the open queue.
    await spam.setEscalationSpam(admin, rows[0].id, false);
    expect(await prisma.escalation.findUniqueOrThrow({ where: { id: rows[0].id } })).toMatchObject({ status: "OPEN", spamCategory: null });
  });

  it("real questions still reach a person, each as its own item", async () => {
    const a = `a-${uid()}@smithchiro.com`;
    await growth.askQuestion({ name: "Jane Smith", email: a, question: "Do you cover Saturday mornings in Tampa? We'd need two in March." });
    await growth.askQuestion({ name: "Jane Smith", email: a, question: "Also, can the same provider come back every month?" });
    const rows = await questionsFrom(a);
    expect(rows.length).toBe(2);
    expect(rows.every((e) => !e.spamCategory && e.status !== "RESOLVED")).toBe(true);
  });

  it("the AI can file a sales pitch the rules missed", async () => {
    setLlmProvider({ name: "anthropic", generate: async (req) => ({ ok: true, model: req.model, inputTokens: 10, outputTokens: 10, data: { answer: "", needsHuman: true, highIntent: false, confidence: 0.2, category: "sales_pitch" } }) });
    const email = `vendor-${uid()}@agency.dev`;
    await growth.askQuestion({ name: "Kim Lee", email, question: "We help clinics like yours with patient intake software. Could we set up a demo next week?" });
    const rows = await questionsFrom(email);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({ spamCategory: "solicitation", status: "RESOLVED" });
  });

  it("bots are dropped quietly (honeypot, instant submit); a failed Turnstile check asks to retry", async () => {
    const email = `bot-${uid()}@test.dev`;
    await growth.askQuestion({ name: "Bot", email, question: "Do you cover Saturdays?", website: "http://spam.example" }, "203.0.113.5");
    await growth.askQuestion({ name: "Bot", email, question: "Do you cover Saturdays?", startedAt: Date.now() }, "203.0.113.5");
    expect(await questionsFrom(email)).toHaveLength(0);

    setHumanVerifier({ name: "test", verify: async () => ({ ok: false, result: "fail" }) });
    await expect(growth.askQuestion({ name: "Pat", email: `pat-${uid()}@test.dev`, question: "Do you cover Saturdays?", startedAt: Date.now() - 20_000 }, "203.0.113.6")).rejects.toThrow(/verify you're human/);
    // Internal calls (no IP) never need the widget.
    await expect(growth.askQuestion({ name: "Pat", email: `pat-${uid()}@test.dev`, question: "Do you cover Saturdays?" })).resolves.toBeTruthy();
  });

  it("a blocked domain goes straight to Spam; public email providers can't be blocked as a domain", async () => {
    const domain = `pitchy-${uid()}.dev`;
    await spam.blockSender(admin, `someone@${domain}`, "DOMAIN", "SEO agency");
    const email = `new@${domain}`;
    await growth.askQuestion({ name: "Sam", email, question: "How do I post a shift?" });
    expect((await questionsFrom(email))[0]).toMatchObject({ spamCategory: "spam" });
    await expect(spam.blockSender(admin, "gmail.com", "DOMAIN")).rejects.toThrow(/public email provider/);
  });
});

describe("lead forms: spam folder", () => {
  it("a spam signup gets no code and no email; Not spam replays it normally", async () => {
    const email = `x-${uid()}@mailinator.com`;
    const r = await leads.captureLead({ name: "Pat Cole", email, source: "popup", audience: "CLINIC" });
    expect(r.code).toBeNull();
    const row = await prisma.lead.findFirstOrThrow({ where: { email } });
    expect(row).toMatchObject({ status: "LOST", promoCode: null, nextDripAt: null });
    expect(row.spamReasons).toContain("throwaway email address");
    expect(devOutbox.some((m) => m.to === email)).toBe(false);
    expect((await leads.listLeads(admin, {})).rows.some((l) => l.id === row.id)).toBe(false);
    expect((await leads.listLeads(admin, { spam: true })).rows.some((l) => l.id === row.id)).toBe(true);

    const back = await leads.setLeadSpam(admin, row.id, false);
    const restored = await prisma.lead.findUniqueOrThrow({ where: { id: back.leadId! } });
    expect(restored).toMatchObject({ spamCategory: null, status: "NURTURING", campaignCode: "" });
    expect(restored.promoCode).toBeTruthy();
    expect(devOutbox.some((m) => m.to === email)).toBe(true);
    expect(await prisma.lead.findUnique({ where: { id: row.id } })).toBeNull();
  });

  it("an address whose domain can't receive mail is filed as spam", async () => {
    const email = `y-${uid()}@nomx-domain.dev`;
    await leads.captureLead({ name: "Lee Park", email, source: "contact", message: "Do you cover Saturdays?" });
    expect((await prisma.lead.findFirstOrThrow({ where: { email } })).spamReasons).toContain("email domain can't receive mail");
  });

  it("marking a real lead as spam stops its emails and can block the sender", async () => {
    const email = `z-${uid()}@test.dev`;
    const r = await leads.captureLead({ name: "Alex Ford", email, source: "popup", audience: "CLINIC" });
    await leads.setLeadSpam(admin, r.leadId!, true, "EMAIL");
    expect(await prisma.lead.findUniqueOrThrow({ where: { id: r.leadId! } })).toMatchObject({ status: "LOST", nextDripAt: null, spamCategory: "spam" });
    expect(await spam.blockedSenderFor(email)).toBeTruthy();
  });
});

describe("signups are flagged, never blocked", () => {
  it("adds 'Possible spam' to the owner's new-signup email", async () => {
    const adminUser = await prisma.user.create({ data: { email: `admin-${uid()}@test.dev`, name: "Owner", role: "PLATFORM_ADMIN", emailVerifiedAt: new Date() } });
    const email = `p-${uid()}@yopmail.com`;
    const user = await auth.signup({ role: "provider", name: "Sam Diaz", email, password: "correct-horse-battery", professionCodes: ["DC"], acceptTerms: true });
    expect(user.email).toBe(email);
    const note = await prisma.notification.findFirstOrThrow({ where: { userId: adminUser.id, template: "admin_new_signup", body: { contains: email } } });
    expect(note.title).toMatch(/^Possible spam — New provider signup/);
  });

  it("a bot filling the hidden field can't sign up", async () => {
    await expect(auth.signup({ role: "clinic", name: "Bot", email: `b-${uid()}@test.dev`, password: "correct-horse-battery", organization: "X", acceptTerms: true }, { ip: "203.0.113.9", guard: { honeypot: "http://x" } })).rejects.toThrow(/try again/);
  });
});

describe("retention", () => {
  it("deletes spam older than the retention period, nothing else", async () => {
    const old = new Date(Date.now() - 40 * 86_400_000);
    const s = await spam.fileSpamQuestion({ name: "Old", email: `old-${uid()}@test.dev`, question: "buy backlinks", category: "spam", reasons: ["x"], via: "rules" });
    await prisma.escalation.update({ where: { id: s.id }, data: { createdAt: old } });
    const keep = await prisma.escalation.create({ data: { entityType: "QUESTION", entityLabel: "Real <r@test.dev>", reasonCode: "needs_answer", reason: "r", createdAt: old } });
    const r = await spam.purgeSpam();
    expect(r.escalations).toBeGreaterThanOrEqual(1);
    expect(await prisma.escalation.findUnique({ where: { id: s.id } })).toBeNull();
    expect(await prisma.escalation.findUnique({ where: { id: keep.id } })).toBeTruthy();
  });
});

describe("Human check on sign-in, forgot password and resend confirmation", () => {
  const strict = () => setHumanVerifier({ name: "test", verify: async (t) => (t === "good" ? { ok: true, result: "pass" } : { ok: false, result: t ? "fail" : "missing" }) });

  it("sign-in needs the check only after repeated failures; success resets the count", async () => {
    strict();
    const email = `login-${uid()}@test.dev`;
    const ip = `ip-${uid()}`;
    await prisma.user.create({ data: { email, name: "Front Desk", role: "CLINIC_STAFF", passwordHash: await auth.hashPassword("correct-horse-battery"), emailVerifiedAt: new Date() } });
    await expect(auth.login(email, "correct-horse-battery", ip)).resolves.toBeTruthy();
    expect(await auth.loginChallengeNeeded(ip)).toBe(false);
    for (let n = 0; n < 2; n++) await expect(auth.login(email, "wrong-password-1", ip)).rejects.toThrow("That email and password don't match.");
    // The 3rd failure tells the form to show the check.
    await expect(auth.login(email, "wrong-password-1", ip)).rejects.toThrow(auth.LOGIN_MISMATCH_CHECK);
    expect(await auth.loginChallengeNeeded(ip)).toBe(true);
    // Now even the right password needs the check.
    await expect(auth.login(email, "correct-horse-battery", ip)).rejects.toThrow(auth.LOGIN_CHALLENGE);
    await expect(auth.login(email, "correct-horse-battery", ip, { humanToken: "bad" })).rejects.toThrow(auth.LOGIN_CHALLENGE);
    await expect(auth.login(email, "correct-horse-battery", ip, { humanToken: "good" })).resolves.toBeTruthy();
    // The email's count was reset; a new address gets straight in.
    await expect(auth.login(email, "correct-horse-battery", `${ip}9`)).resolves.toBeTruthy();
    // The guessing address itself still has to pass the check.
    await expect(auth.login(email, "correct-horse-battery", ip)).rejects.toThrow(auth.LOGIN_CHALLENGE);
  });

  it("locks an email after 5 wrong passwords; a password reset unlocks it", async () => {
    const email = `lock-${uid()}@test.dev`;
    const user = await prisma.user.create({ data: { email, name: "Front Desk", role: "CLINIC_STAFF", passwordHash: await auth.hashPassword("correct-horse-battery"), emailVerifiedAt: new Date() } });
    for (let n = 0; n < 4; n++) await expect(auth.login(email, "wrong-password-1", `ip-${uid()}`)).rejects.toThrow(/don't match/);
    await expect(auth.login(email, "wrong-password-1", `ip-${uid()}`)).rejects.toThrow(auth.LOGIN_LOCKED);
    // Even the right password waits, from any address.
    await expect(auth.login(email, "correct-horse-battery", `ip-${uid()}`)).rejects.toThrow(auth.LOGIN_LOCKED);
    await auth.requestPasswordReset(email);
    const link = devOutbox.filter((m) => m.to === email).at(-1)!.body.match(/token=([\w-]+)/)![1];
    await auth.resetPassword(link, "brand-new-password-2");
    await expect(auth.login(email, "brand-new-password-2", `ip-${uid()}`)).resolves.toBeTruthy();
    expect(user.id).toBeTruthy();
  });

  it("forgot password from the public form needs the check; an admin-sent reset doesn't", async () => {
    strict();
    const email = `reset-${uid()}@test.dev`;
    await prisma.user.create({ data: { email, name: "Front Desk", role: "CLINIC_STAFF", emailVerifiedAt: new Date() } });
    const sent = () => devOutbox.filter((m) => m.to === email).length;
    await expect(auth.requestPasswordReset(email, `ip-${uid()}`, { token: null })).rejects.toThrow(/verify you're human/);
    await expect(auth.requestPasswordReset(email, `ip-${uid()}`, { token: "good", honeypot: "http://spam" })).rejects.toThrow(/verify you're human/);
    expect(sent()).toBe(0);
    await auth.requestPasswordReset(email, `ip-${uid()}`, { token: "good" });
    await auth.requestPasswordReset(email);
    expect(sent()).toBe(2);
  });

  it("“Email me a new link” on an expired confirmation link needs the check", async () => {
    strict();
    await expect(auth.resendVerificationFromLink("anything", { token: "bad" })).rejects.toThrow(/verify you're human/);
  });
});
