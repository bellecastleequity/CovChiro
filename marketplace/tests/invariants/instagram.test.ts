import { afterEach, describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { admin as adminSvc, growth, invalidateSettings, setClock } from "@cm/services";
import { uid } from "../factories";

const admin = { userId: null, role: "PLATFORM_ADMIN" as const };
async function setting(key: string, value: unknown) {
  await adminSvc.updateSetting(admin, key, value);
  invalidateSettings();
}
const mk = (socialUrls: string[], intentScore = 0) =>
  prisma.clinicProspect.create({ data: { clinicName: `IG ${uid()}`, city: "Tampa", state: "FL", socialUrls, intentScore, publicToken: uid(), researchStatus: "DONE" } });
const status = async (id: string) => (await prisma.clinicProspect.findUniqueOrThrow({ where: { id } })).igStatus;

afterEach(async () => {
  setClock(null);
  await setting("growth.instagram.autoApprovePerDay", 0);
});

describe("instagram follow list", () => {
  it("finds handles from the clinic's own links, approves, paces and records follows", async () => {
    const a = await mk(["https://facebook.com/x", "https://www.instagram.com/IG_Alpha/"], 50);
    const b = await mk(["https://instagram.com/p/xyz"]);
    const c = await mk(["https://instagram.com/ig.charlie"]);
    const d = await mk(["https://instagram.com/ig.delta"]);
    await growth.syncInstagramHandles(5000);
    expect((await prisma.clinicProspect.findUniqueOrThrow({ where: { id: a.id } })).instagramHandle).toBe("ig_alpha");
    expect(await status(a.id)).toBe("FOUND");
    expect(await status(b.id)).toBe("NO_HANDLE");

    // 10:00 New York on a Monday: inside follow hours.
    setClock(() => new Date("2026-10-05T14:00:00Z"));
    expect((await growth.instagramDecide(admin, [a.id, c.id, d.id, b.id], "approve")).count).toBe(3); // b has no handle
    let board = await growth.instagramBoard(admin);
    expect(board.pace.readyNow).toBe(2);

    await growth.instagramDecide(admin, [a.id, c.id], "followed");
    board = await growth.instagramBoard(admin);
    expect(board.pace).toMatchObject({ readyNow: 0, reason: "window" });
    expect(board.pace.nextAt).toEqual(new Date("2026-10-05T14:05:00Z"));
    setClock(() => new Date("2026-10-05T14:05:00Z"));
    expect((await growth.instagramBoard(admin)).pace.readyNow).toBe(2);

    // Following only counts once; a followed clinic can't be re-approved by accident.
    expect((await growth.instagramDecide(admin, [a.id], "approve")).count).toBe(0);
    expect(await status(a.id)).toBe("FOLLOWED");

    await growth.setInstagramHandle(admin, b.id, "@Bravo.Chiro");
    expect(await status(b.id)).toBe("FOUND");
    await expect(growth.setInstagramHandle(admin, b.id, "https://instagram.com/p/123")).rejects.toThrow(/Instagram profile/);
  });

  it("auto-approves only up to the daily amount, best prospects first", async () => {
    const hi = await mk([`https://instagram.com/hi${uid().slice(0, 8)}`], 99);
    await mk([`https://instagram.com/lo${uid().slice(0, 8)}`], -5);
    await growth.syncInstagramHandles(5000);
    setClock(() => new Date("2026-10-07T14:00:00Z"));
    expect((await growth.autoApproveInstagram()).approved).toBe(0); // off by default
    await setting("growth.instagram.autoApprovePerDay", 1);
    const before = await prisma.clinicProspect.count({ where: { igAutoApproved: true } });
    await growth.autoApproveInstagram();
    expect(await prisma.clinicProspect.count({ where: { igAutoApproved: true } })).toBe(before + 1);
    expect(await status(hi.id)).toBe("APPROVED");
    expect((await growth.autoApproveInstagram()).approved).toBe(0); // today's 1 is used
    setClock(() => new Date("2026-10-08T14:00:00Z"));
    expect((await growth.autoApproveInstagram()).approved).toBe(1);
  });
});
