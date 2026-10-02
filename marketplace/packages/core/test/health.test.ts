import { describe, expect, it } from "vitest";
import { aiFailureKind, evaluateHealth, planAlerts, type HealthFacts } from "../src/health";

const NOW = new Date("2026-10-05T14:00:00Z");
const min = (m: number) => new Date(+NOW - m * 60_000);
const base = (): HealthFacts => ({
  now: NOW,
  lastTickAt: min(1),
  jobs: [],
  email: { failStreak: 0, lastError: null, lastFailAt: null, lastOkAt: min(5) },
  sms: null,
  aiErrors: [],
  aiBudget: { dayPct: 10, monthPct: 20, researchDayPct: 0 },
  researchPause: null,
  stripeFailures: [],
  backups: { lastOkAt: min(600), lastFailure: null, enabled: true },
  missingMigrations: [],
  approvedQueue: { queued: 0, heldReason: null, heldSince: null },
});
const keys = (f: HealthFacts) => evaluateHealth(f).map((i) => i.key);

describe("system health", () => {
  it("is quiet when everything works", () => {
    expect(evaluateHealth(base())).toEqual([]);
  });

  it("flags a stopped cron as critical with the cPanel remedy", () => {
    const f = { ...base(), lastTickAt: min(25) };
    const [i] = evaluateHealth(f);
    expect(i).toMatchObject({ key: "cron", severity: "critical" });
    expect(i.title).toMatch(/25 min/);
    expect(i.remedy).toMatch(/Cron Jobs/);
    expect(keys({ ...base(), lastTickAt: null })).toContain("cron");
  });

  it("flags a job only after repeated failures, with a remedy from its error", () => {
    const job = { name: "payoutRelease", failStreak: 2, lastError: "Can't reach database server", lastErrorAt: min(1), lastOkAt: min(30), critical: true };
    expect(keys({ ...base(), jobs: [job] })).toEqual([]);
    const [i] = evaluateHealth({ ...base(), jobs: [{ ...job, failStreak: 3 }] });
    expect(i).toMatchObject({ key: "job:payoutRelease", severity: "critical" });
    expect(i.remedy).toMatch(/Neon/);
  });

  it("flags failing email and texts", () => {
    const f = { ...base(), email: { failStreak: 4, lastError: "The from address does not match a verified Sender Identity", lastFailAt: min(1), lastOkAt: min(300) }, sms: { failStreak: 3, lastError: "Account balance is insufficient", lastFailAt: min(2), lastOkAt: null } };
    const out = evaluateHealth(f);
    expect(out.map((i) => i.key)).toEqual(["email", "sms"]);
    expect(out[0].remedy).toMatch(/SendGrid/);
    expect(out[1].remedy).toMatch(/Twilio/);
  });

  it("names the AI provider whose credits ran out, once per provider", () => {
    const f = { ...base(), aiErrors: [
      { provider: "openai", agent: "research", error: "HTTP 429: You exceeded your current quota, please check your plan and billing details", at: min(3) },
      { provider: "openai", agent: "blog", error: "insufficient_quota", at: min(10) },
      { provider: "anthropic", agent: "x", error: "HTTP 503 overloaded", at: min(4) },
    ] };
    const out = evaluateHealth(f);
    expect(out.map((i) => i.key)).toEqual(["ai:openai:quota"]);
    expect(out[0].title).toMatch(/OpenAI: AI credits exhausted/);
    expect(out[0].remedy).toMatch(/platform\.openai\.com/);
    expect(aiFailureKind("HTTP 401 invalid api key")).toBe("auth");
  });

  it("separates the platform's own AI caps from provider problems", () => {
    expect(keys({ ...base(), aiBudget: { dayPct: 100, monthPct: 60, researchDayPct: 0 } })).toEqual(["ai:budget:day"]);
    expect(keys({ ...base(), aiBudget: { dayPct: 92, monthPct: 60, researchDayPct: 0 } })).toEqual(["ai:budget:near"]);
  });

  it("catches Stripe setup errors and an empty balance", () => {
    const f = { ...base(), stripeFailures: [
      { kind: "payment" as const, reason: "The provided key 'rk_live_…' does not have the required permissions for this endpoint", at: min(5) },
      { kind: "transfer" as const, reason: "You have insufficient funds in your Stripe account", at: min(6) },
    ] };
    expect(keys(f)).toEqual(["stripe:config", "stripe:balance"]);
    expect(keys({ ...base(), stripeFailures: [{ kind: "payment", reason: "Your card was declined.", at: min(1) }] })).toEqual([]);
  });

  it("flags stale backups, missing database updates and stuck outreach", () => {
    expect(keys({ ...base(), backups: { lastOkAt: min(60 * 40), lastFailure: { at: min(60), error: "EACCES" }, enabled: true } })).toEqual(["backups"]);
    expect(keys({ ...base(), backups: { lastOkAt: null, lastFailure: null, enabled: false } })).toEqual([]);
    expect(keys({ ...base(), missingMigrations: ["0025_instagram_follow"] })).toEqual(["db:migrations"]);
    expect(keys({ ...base(), approvedQueue: { queued: 12, heldReason: "outbound paused", heldSince: min(200) } })).toEqual(["growth:queue"]);
  });

  it("orders critical before warning", () => {
    const out = evaluateHealth({ ...base(), lastTickAt: min(60), missingMigrations: ["x"], backups: { lastOkAt: null, lastFailure: null, enabled: true } });
    expect(out.map((i) => i.severity)).toEqual(["critical", "critical", "warning"]);
  });
});

describe("alert planning", () => {
  const issue = { key: "cron", severity: "critical" as const, title: "Background jobs stopped", detail: "", remedy: "" };
  it("alerts new issues once, repeats on schedule, and reports resolved ones", () => {
    const a = planAlerts([issue], {}, NOW, 12);
    expect(a.fresh.map((i) => i.key)).toEqual(["cron"]);
    const b = planAlerts([issue], a.next, new Date(+NOW + 3_600_000), 12);
    expect(b.fresh).toEqual([]);
    expect(b.repeat).toEqual([]);
    const c = planAlerts([issue], a.next, new Date(+NOW + 13 * 3_600_000), 12);
    expect(c.repeat.map((i) => i.key)).toEqual(["cron"]);
    const d = planAlerts([], c.next, new Date(+NOW + 14 * 3_600_000), 12);
    expect(d.resolved.map((r) => r.key)).toEqual(["cron"]);
    expect(d.next).toEqual({});
  });
});
