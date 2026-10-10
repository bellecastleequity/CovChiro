import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { badges, badgesFor } from "@cm/services";
import type { Actor } from "@cm/services";
import { makeProvider, uid } from "../factories";

async function admin(): Promise<Actor> {
  const u = await prisma.user.create({ data: { email: `a-${uid()}@test.dev`, name: "Admin", role: "PLATFORM_ADMIN", emailVerifiedAt: new Date() } });
  return { userId: u.id, role: "PLATFORM_ADMIN", providerId: null, clinicOrgId: null };
}

describe("Rewards & Badges: custom badges and badges given by hand", () => {
  it("creates a custom badge, gives it, shows it with the earned badges, edits, archives and removes it", async () => {
    const a = await admin();
    const p = await makeProvider();
    const name = `Above ${uid()}`;
    const b = await badges.saveCustomBadge(a, { label: name, description: "Went above and beyond for a clinic.", tone: "amber" });
    expect(b.key).toMatch(/^custom_above_/);

    const r = await badges.awardBadge(a, { email: p.user.email.toUpperCase(), badgeKey: b.key, note: "October", tell: true });
    expect(r.already).toBe(false);
    expect((await badges.awardBadge(a, { email: p.user.email, badgeKey: b.key })).already).toBe(true);
    expect(await prisma.notification.count({ where: { userId: p.userId, title: { contains: name } } })).toBe(1);
    let shown = (await badgesFor([p.id])).get(p.id)!;
    expect(shown.find((x) => x.key === b.key)).toMatchObject({ label: name, kind: "earned" });

    await badges.saveCustomBadge(a, { key: b.key, label: "Clinic hero", description: "Covered a clinic on short notice.", tone: "brand" });
    shown = (await badgesFor([p.id])).get(p.id)!;
    expect(shown.find((x) => x.key === b.key)).toMatchObject({ label: "Clinic hero", tone: "brand" });

    await badges.archiveCustomBadge(a, b.key, true);
    expect((await badgesFor([p.id])).get(p.id)!.some((x) => x.key === b.key)).toBe(false);
    expect((await badges.assignableBadges()).some((x) => x.key === b.key)).toBe(false);
    await badges.archiveCustomBadge(a, b.key, false);
    expect((await badgesFor([p.id])).get(p.id)!.some((x) => x.key === b.key)).toBe(true);

    const award = (await badges.recentAwards(a)).find((x) => x.providerId === p.id && x.badgeKey === b.key)!;
    await badges.revokeBadge(a, award.id);
    expect((await badgesFor([p.id])).get(p.id)!.some((x) => x.key === b.key)).toBe(false);
  });

  it("gives an earned-style built-in, never a verification badge; admins only; checks the wording", async () => {
    const a = await admin();
    const p = await makeProvider();
    await badges.awardBadge(a, { email: p.user.email, badgeKey: "reliable", tell: false });
    expect((await badgesFor([p.id])).get(p.id)!.filter((x) => x.key === "reliable")).toHaveLength(1);
    for (const key of ["license", "malpractice", "npi", "oncall", "multi_state"]) {
      await expect(badges.awardBadge(a, { email: p.user.email, badgeKey: key })).rejects.toThrow(/Pick a badge/);
    }
    await expect(badges.saveCustomBadge(a, { label: "Board certified", description: "Board certified in sports care.", tone: "gray" })).rejects.toThrow(/license/);
    await expect(badges.awardBadge(p.actor, { email: p.user.email, badgeKey: "reliable" })).rejects.toThrow();
    await expect(badges.saveCustomBadge(p.actor, { label: "Mine", description: "I made this myself.", tone: "gray" })).rejects.toThrow();
    await expect(badges.awardBadge(a, { email: `nobody-${uid()}@test.dev`, badgeKey: "reliable" })).rejects.toThrow(/No provider login/);
  });
});
