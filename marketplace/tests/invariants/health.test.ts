import { afterEach, beforeAll, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { devOutbox } from "@cm/integrations";
import { admin as adminSvc, health, invalidateSettings, recordChannel, runJobs, setClock } from "@cm/services";
import { uid } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
let adminEmail = "";
const mailsTo = (to: string) => devOutbox.filter((m) => m.to === to && m.channel === "email");

beforeAll(async () => {
  adminEmail = `ops-${uid()}@test.dev`;
  await prisma.user.create({ data: { email: adminEmail, name: "Ops Admin", role: "PLATFORM_ADMIN", passwordHash: "x" } });
  // The test database has no backups; that check is covered in core.
  await adminSvc.updateSetting(admin, "backups.enabled", false);
  invalidateSettings();
});
afterEach(async () => {
  setClock(null);
  invalidateSettings();
});

async function clean() {
  await prisma.setting.deleteMany({ where: { key: { startsWith: "health." } } });
  await prisma.aiUsage.deleteMany({ where: { agent: "healthTest" } });
}

describe("system health monitor", () => {
  it("emails admins once when AI credits run out, with the fix, then says when it's resolved", async () => {
    await clean();
    await runJobs([]); // records a background tick
    const t0 = new Date();
    await prisma.aiUsage.create({ data: { agent: "healthTest", task: "research", provider: "openai", model: "gpt", ok: false, error: "HTTP 429: You exceeded your current quota, please check your plan and billing details." } });

    const before = mailsTo(adminEmail).length;
    const r = await health.systemHealthSweep({ force: true });
    expect(r).toMatchObject({ fresh: 1 });
    const mail = mailsTo(adminEmail).at(-1)!;
    expect(mail.subject).toMatch(/1 problem needs attention/);
    expect(mail.body).toMatch(/OpenAI: AI credits exhausted/);
    expect(mail.body).toMatch(/platform\.openai\.com/);
    expect(mailsTo(adminEmail).length).toBe(before + 1);

    // Still broken a few minutes later: no duplicate email.
    setClock(() => new Date(+t0 + 10 * 60_000));
    await runJobs([]);
    expect(await health.systemHealthSweep({ force: true })).toMatchObject({ fresh: 0, repeat: 0 });
    expect(mailsTo(adminEmail).length).toBe(before + 1);

    // Errors age out of the window (credits added) → one "resolved" email.
    setClock(() => new Date(+t0 + 7 * 3_600_000));
    await runJobs([]);
    expect(await health.systemHealthSweep({ force: true })).toMatchObject({ resolved: 1 });
    expect(mailsTo(adminEmail).at(-1)!.subject).toMatch(/problem resolved/);
  });

  it("tracks failing jobs and email sending, and spots a stopped cron", async () => {
    await clean();
    const boom = { name: `testJob${uid().slice(0, 6)}`, schedule: { everySeconds: 60 }, run: async () => { throw new Error("Can't reach database server at neon"); } };
    for (let i = 0; i < 3; i++) await runJobs([boom]);
    for (let i = 0; i < 3; i++) await recordChannel("email", false, "The from address does not match a verified Sender Identity");
    let { issues } = await health.currentIssues();
    expect(issues.map((i) => i.key)).toEqual(expect.arrayContaining([`job:${boom.name}`, "email"]));
    expect(issues.find((i) => i.key === `job:${boom.name}`)!.remedy).toMatch(/Neon/);

    // One success clears each.
    await runJobs([{ ...boom, run: async () => "ok" }]);
    await recordChannel("email", true);
    ({ issues } = await health.currentIssues());
    expect(issues.map((i) => i.key)).not.toContain(`job:${boom.name}`);
    expect(issues.map((i) => i.key)).not.toContain("email");

    // No tick for 20 minutes → cron alert; the public summary reports critical.
    setClock(() => new Date(Date.now() + 20 * 60_000));
    ({ issues } = await health.currentIssues());
    expect(issues[0]).toMatchObject({ key: "cron", severity: "critical" });
    expect((await health.healthSummary()).status).toBe("critical");
  });
});
