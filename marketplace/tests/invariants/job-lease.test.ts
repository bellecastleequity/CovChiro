import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { acquireLease, releaseLease, runJobs, type Job } from "@cm/services";
import { uid } from "../factories";

describe("background job leases (no pile-up under a once-a-minute cron)", () => {
  it("a job still running is skipped by the next tick; an expired lease is taken over", async () => {
    const name = `test-${uid()}`;
    expect(await acquireLease(name, 5)).toBe(true);
    expect(await acquireLease(name, 5)).toBe(false);
    await prisma.setting.update({ where: { key: `job.lease.${name}` }, data: { value: { until: new Date(Date.now() - 1000).toISOString() } } });
    expect(await acquireLease(name, 5)).toBe(true);
    await releaseLease(name);
    expect(await acquireLease(name, 5)).toBe(true);
    await releaseLease(name);
  });

  it("long jobs start in the background and hold their lease until done", async () => {
    let finish!: () => void;
    const done = new Promise<void>((r) => (finish = r));
    let runs = 0;
    const job: Job = { name: `slow-${uid()}`, schedule: { everySeconds: 600 }, long: true, leaseMinutes: 15, run: async () => { runs++; await done; return "ok"; } };
    const first = await runJobs([job], { background: true });
    expect(first[0]).toMatchObject({ started: true });
    const second = await runJobs([job], { background: true });
    expect(second[0]).toMatchObject({ skipped: "still running" });
    expect(runs).toBe(1);
    finish();
    await new Promise((r) => setTimeout(r, 200));
    const third = await runJobs([job]);
    expect(third[0]).toMatchObject({ ok: true, result: "ok" });
    expect(runs).toBe(2);
  });
});
