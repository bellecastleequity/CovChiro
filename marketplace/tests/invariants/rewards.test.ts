import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { invalidateSettings, rewards } from "@cm/services";
import { insertAssignment, makeClinic, makeProvider, makeShift } from "../factories";

/** Rewards: points from facts, idempotent, level-up notices after the first catch-up, admin awards. */

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };

describe("Rewards", () => {
  it("provider: setup steps once, a completed shift, no double counting; level-up notice; manual award shows in history", async () => {
    await prisma.setting.upsert({ where: { key: "rewards.levels" }, create: { key: "rewards.levels", value: { silver: 100, gold: 200, platinum: 5000 } }, update: { value: { silver: 100, gold: 200, platinum: 5000 } } });
    invalidateSettings();
    const clinic = await makeClinic();
    const provider = await makeProvider();
    const first = await rewards.syncProvider(provider.id);
    expect(first).toBeGreaterThan(0);
    expect(await rewards.syncProvider(provider.id)).toBe(0); // idempotent
    const kinds = (await prisma.rewardEvent.findMany({ where: { accountId: provider.id } })).map((e) => e.kind);
    expect(kinds).toContain("p.license");
    expect(new Set(kinds).size).toBe(kinds.length);

    const shift = await makeShift(clinic.location.id, { days: 15 });
    const a = await insertAssignment(shift.id, provider.id);
    await prisma.assignment.update({ where: { id: a.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    const before = (await rewards.rewardsChip("PROVIDER", provider.id))!;
    expect(await rewards.syncProvider(provider.id)).toBe(1);
    const after = (await rewards.rewardsChip("PROVIDER", provider.id))!;
    expect(after.points - before.points).toBe(50);
    if (after.level !== before.level) expect(await prisma.notification.count({ where: { userId: provider.userId, template: "rewards_level" } })).toBe(1);

    await expect(rewards.awardPoints(admin, { accountType: "PROVIDER", accountId: provider.id, points: 25, note: "" })).rejects.toThrow(/reason/);
    await rewards.awardPoints(admin, { accountType: "PROVIDER", accountId: provider.id, points: 25, note: "October giveaway" });
    const mine = await rewards.myProviderRewards(provider.actor);
    expect(mine.points).toBe(after.points + 25);
    expect(mine.history[0].label).toBe("October giveaway");
    const board = await rewards.leaderboard(admin, { audience: "PROVIDER" });
    expect(board.some((r) => r.accountId === provider.id)).toBe(true);
    await prisma.setting.deleteMany({ where: { key: "rewards.levels" } });
    invalidateSettings();
  });

  it("clinic: setup and a completed shift; a provider can't read a clinic's rewards", async () => {
    const clinic = await makeClinic();
    const provider = await makeProvider();
    const shift = await makeShift(clinic.location.id, { days: 16 });
    const a = await insertAssignment(shift.id, provider.id);
    await prisma.assignment.update({ where: { id: a.id }, data: { status: "COMPLETED", completedAt: new Date() } });
    const r = await rewards.myClinicRewards(clinic.actor);
    expect(r.history.some((h) => h.label === "A covered shift is completed")).toBe(true);
    expect(r.rules.every((x) => x.audience === "CLINIC")).toBe(true);
    await expect(rewards.myClinicRewards(provider.actor)).rejects.toThrow();
  });

  it("training: points once per passed lesson and a bonus for the whole course", async () => {
    const provider = await makeProvider();
    const lessons = ["welcome", "ready", "finding"];
    expect(await rewards.recordLesson(provider.actor, "welcome", lessons)).toBe(1);
    expect(await rewards.recordLesson(provider.actor, "welcome", lessons)).toBe(0);
    expect(await rewards.recordLesson(provider.actor, "nope", lessons)).toBe(0);
    await rewards.recordLesson(provider.actor, "ready", lessons);
    expect(await rewards.recordLesson(provider.actor, "finding", lessons)).toBe(2); // last lesson + course bonus
    const kinds = (await prisma.rewardEvent.findMany({ where: { accountId: provider.id, kind: { in: ["p.lesson", "p.course"] } } })).map((e) => e.kind);
    expect(kinds.filter((k) => k === "p.lesson")).toHaveLength(3);
    expect(kinds.filter((k) => k === "p.course")).toHaveLength(1);
  });
});
