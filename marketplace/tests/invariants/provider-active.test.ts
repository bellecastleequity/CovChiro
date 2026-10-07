import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { activity } from "@cm/services";
import { makeClinic, makeProvider, makeShift } from "../factories";

const DAY = 86_400_000;
const ago = (d: number) => new Date(Date.now() - d * DAY);

/** Backdate everything that counts as activity, so the sweep (run at the real "now") sees it as idle. */
async function idleFor(providerId: string, days: number) {
  await prisma.provider.update({ where: { id: providerId }, data: { activeConfirmedAt: ago(days), adminApprovedAt: ago(days), createdAt: ago(days) } });
}
const notes = (userId: string, template: string) => prisma.notification.findMany({ where: { userId, template } });

describe("provider active status", () => {
  it("reminds at day 23, pauses after 30 days (no new offers), and one tap brings them back", async () => {
    const p = await makeProvider();
    await idleFor(p.id, 23);
    await activity.activitySweep();
    await activity.activitySweep(); // once only
    expect(await notes(p.userId, "provider_active_reminder")).toHaveLength(1);

    await idleFor(p.id, 31);
    await activity.activitySweep();
    const paused = await prisma.provider.findUniqueOrThrow({ where: { id: p.id } });
    expect(paused.breakReason).toBe("INACTIVE");
    expect(paused.breakStartsAt).not.toBeNull();
    expect(await notes(p.userId, "provider_paused_inactive")).toHaveLength(1);
    expect((await activity.activityStatus(p.id)).paused).toBe(true);


    // One tap from the link.
    const id = activity.providerIdFromActiveToken(activity.activeToken(p.id));
    expect(id).toBe(p.id);
    expect(await activity.confirmActive(id!, "link")).toMatch(/active again/);
    const back = await prisma.provider.findUniqueOrThrow({ where: { id: p.id } });
    expect(back.breakStartsAt).toBeNull();
    expect(back.breakReason).toBeNull();
    expect(activity.providerIdFromActiveToken(`${p.id}.forged`)).toBeNull();
  });

  it("an application counts as activity; unopened markets and breaks they chose are skipped", async () => {
    const applied = await makeProvider();
    await idleFor(applied.id, 40);
    const clinic = await makeClinic();
    const sh = await makeShift(clinic.location.id, { days: 25 });
    await prisma.application.create({ data: { shiftId: sh.id, providerId: applied.id, scoreAtApply: 0.5 } });

    const elsewhere = await makeProvider({ licenses: [{ professionCode: "DC", state: "WY" }] });
    await idleFor(elsewhere.id, 40);

    const onBreak = await makeProvider();
    await idleFor(onBreak.id, 40);
    await prisma.provider.update({ where: { id: onBreak.id }, data: { breakStartsAt: ago(5) } });

    await activity.activitySweep();
    for (const p of [applied, elsewhere]) expect((await prisma.provider.findUniqueOrThrow({ where: { id: p.id } })).breakReason).toBeNull();
    expect((await prisma.provider.findUniqueOrThrow({ where: { id: onBreak.id } })).breakReason).toBeNull();
    expect(await notes(elsewhere.userId, "provider_active_reminder")).toHaveLength(0);
  });
});
