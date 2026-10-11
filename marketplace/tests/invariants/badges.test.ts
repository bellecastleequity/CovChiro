import { describe, expect, it } from "vitest";
import { prisma } from "@cm/db";
import { badges, badgesFor, rewards } from "@cm/services";
import type { Actor } from "@cm/services";
import { makeClinic, makeProvider, uid } from "../factories";

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

  it("finds providers by name (any word order) or email, and gives a badge to the one picked", async () => {
    const a = await admin();
    const tag = uid();
    const p = await makeProvider();
    await prisma.provider.update({ where: { id: p.id }, data: { displayName: `Dr. Jordan Vale${tag}, DC`, legalName: `Jordan Q Vale${tag}` } });
    expect((await badges.findProviders(a, `vale${tag} jordan`)).map((h) => h.id)).toContain(p.id);
    expect((await badges.findProviders(a, `Q Vale${tag}`)).map((h) => h.id)).toContain(p.id);
    expect((await badges.findProviders(a, p.user.email.slice(0, 12))).map((h) => h.id)).toContain(p.id);
    expect(await badges.findProviders(a, "x")).toEqual([]);
    await expect(badges.findProviders(p.actor, `Vale${tag}`)).rejects.toThrow();
    const r = await badges.awardBadge(a, { providerId: p.id, badgeKey: "reliable", tell: false });
    expect(r).toMatchObject({ already: false, label: "Reliable" });
    expect(await prisma.badgeAward.count({ where: { providerId: p.id, badgeKey: "reliable" } })).toBe(1);
    await expect(badges.awardBadge(a, { providerId: `nope${tag}`, badgeKey: "reliable" })).rejects.toThrow(/wasn't found/);
    await expect(badges.awardBadge(a, { badgeKey: "reliable" })).rejects.toThrow(/pick them from the list/);
  });

  it("give or take points: finds providers and clinics by name or login email", async () => {
    const a = await admin();
    const tag = uid();
    const p = await makeProvider();
    await prisma.provider.update({ where: { id: p.id }, data: { displayName: `Dr. Remy Stone${tag}` } });
    const c = await makeClinic();
    await prisma.clinicOrg.update({ where: { id: c.org.id }, data: { displayName: `Stone${tag} Family Chiropractic`, legalName: `Stone${tag} Chiro LLC` } });
    const both = await rewards.findAccounts(a, `stone${tag}`);
    expect(both.find((h) => h.type === "PROVIDER")?.id).toBe(p.id);
    expect(both.find((h) => h.type === "CLINIC")?.id).toBe(c.org.id);
    expect((await rewards.findAccounts(a, `family stone${tag}`)).map((h) => h.id)).toEqual([c.org.id]);
    expect((await rewards.findAccounts(a, c.user.email)).map((h) => `${h.type}:${h.id}`)).toContain(`CLINIC:${c.org.id}`);
    // Badges: providers only.
    expect((await badges.findProviders(a, `stone${tag}`)).map((h) => h.type)).toEqual(["PROVIDER"]);
    await rewards.awardPoints(a, { accountType: "CLINIC", accountId: c.org.id, points: 50, note: "Contest" });
    expect(await prisma.rewardEvent.count({ where: { accountType: "CLINIC", accountId: c.org.id, kind: "manual" } })).toBe(1);
  });
});

