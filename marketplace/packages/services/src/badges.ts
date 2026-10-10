import { ASSIGNABLE_BUILTIN_BADGES, customBadgeKey, customBadgeProblems, DomainError, type BadgeTone, type CustomBadgeDef } from "@cm/core";
import { prisma } from "@cm/db";
import { audit, requireAdmin, type Actor } from "./context";
import { notify } from "./notify";

/**
 * Rewards & Badges (owner request Oct 2026): admins create custom badges and give badges to providers
 * by hand. Shown wherever badges are (profile, candidate cards) via profiles.badgesFor → core
 * withAwardedBadges. Status/fact badges (license, insurance, NPI…) can never be given by hand.
 */

/** Active custom badges (for badgesFor and the admin page). */
export async function customBadges(): Promise<CustomBadgeDef[]> {
  const rows = await prisma.customBadge.findMany({ where: { archivedAt: null }, orderBy: { label: "asc" } });
  return rows.map((r) => ({ key: r.key, label: r.label, description: r.description, tone: r.tone as BadgeTone }));
}

/** Every badge an admin can give: the earned-style built-ins, then active custom ones. */
export async function assignableBadges() {
  return [
    ...Object.entries(ASSIGNABLE_BUILTIN_BADGES).map(([key, d]) => ({ key, ...d, custom: false })),
    ...(await customBadges()).map((d) => ({ ...d, custom: true })),
  ];
}

export async function saveCustomBadge(actor: Actor, input: { key?: string | null; label: string; description: string; tone: string }) {
  requireAdmin(actor);
  const problem = customBadgeProblems(input);
  if (problem) throw new DomainError("VALIDATION", problem);
  const data = { label: input.label.trim(), description: input.description.trim(), tone: input.tone };
  if (input.key) {
    const row = await prisma.customBadge.update({ where: { key: input.key }, data });
    await audit(prisma, actor, "badge.custom.updated", "CustomBadge", row.id, null, data);
    return row;
  }
  let key = customBadgeKey(data.label);
  for (let n = 2; await prisma.customBadge.findUnique({ where: { key } }); n++) key = `${customBadgeKey(data.label)}_${n}`;
  const row = await prisma.customBadge.create({ data: { ...data, key, createdById: actor.userId } });
  await audit(prisma, actor, "badge.custom.created", "CustomBadge", row.id, null, { key, ...data });
  return row;
}

/** Archive (stop offering and showing) or bring back a custom badge. Awards are kept. */
export async function archiveCustomBadge(actor: Actor, key: string, archived: boolean) {
  requireAdmin(actor);
  const row = await prisma.customBadge.update({ where: { key }, data: { archivedAt: archived ? new Date() : null } });
  await audit(prisma, actor, archived ? "badge.custom.archived" : "badge.custom.restored", "CustomBadge", row.id);
}

/** Give a badge to a provider (found by login email). Giving it again is a no-op. */
export async function awardBadge(actor: Actor, input: { email: string; badgeKey: string; note?: string | null; tell?: boolean }) {
  requireAdmin(actor);
  const def = (await assignableBadges()).find((b) => b.key === input.badgeKey);
  if (!def) throw new DomainError("VALIDATION", "Pick a badge.");
  const user = await prisma.user.findFirst({ where: { email: { equals: input.email.trim(), mode: "insensitive" } }, select: { id: true, provider: { select: { id: true, displayName: true } } } });
  if (!user?.provider) throw new DomainError("NOT_FOUND", "No provider login with that email.");
  const existing = await prisma.badgeAward.findUnique({ where: { providerId_badgeKey: { providerId: user.provider.id, badgeKey: def.key } } });
  if (existing) return { name: user.provider.displayName, label: def.label, already: true };
  const note = input.note?.trim().slice(0, 200) || null;
  const row = await prisma.badgeAward.create({ data: { providerId: user.provider.id, badgeKey: def.key, note, awardedById: actor.userId } });
  await audit(prisma, actor, "badge.awarded", "Provider", user.provider.id, null, { badgeKey: def.key, note, awardId: row.id });
  if (input.tell !== false) {
    await notify(prisma, user.id, { template: "badge_awarded", title: `You earned the ${def.label} badge`, body: `${def.description} Clinics see it on your profile.`, link: "/provider/profile/public", ctaLabel: "See my profile", email: false }).catch(() => undefined);
  }
  return { name: user.provider.displayName, label: def.label, already: false };
}

export async function revokeBadge(actor: Actor, awardId: string) {
  requireAdmin(actor);
  const row = await prisma.badgeAward.delete({ where: { id: awardId } });
  await audit(prisma, actor, "badge.revoked", "Provider", row.providerId, { badgeKey: row.badgeKey, note: row.note }, null);
}

/** Recent hand-given badges for the admin page. */
export async function recentAwards(actor: Actor, take = 50) {
  requireAdmin(actor);
  const [rows, defs] = await Promise.all([
    prisma.badgeAward.findMany({ orderBy: { createdAt: "desc" }, take, include: { provider: { select: { id: true, displayName: true } } } }),
    prisma.customBadge.findMany(),
  ]);
  const labelOf = (k: string) => ASSIGNABLE_BUILTIN_BADGES[k]?.label ?? defs.find((d) => d.key === k)?.label ?? k;
  return rows.map((r) => ({ id: r.id, providerId: r.provider.id, provider: r.provider.displayName, badgeKey: r.badgeKey, label: labelOf(r.badgeKey), note: r.note, at: r.createdAt }));
}

/** Admin page: every custom badge (archived too) with how many providers hold it. */
export async function customBadgeList(actor: Actor) {
  requireAdmin(actor);
  const [rows, counts] = await Promise.all([
    prisma.customBadge.findMany({ orderBy: [{ archivedAt: { sort: "asc", nulls: "first" } }, { label: "asc" }] }),
    prisma.badgeAward.groupBy({ by: ["badgeKey"], _count: true }),
  ]);
  const n = new Map(counts.map((c) => [c.badgeKey, c._count]));
  return rows.map((r) => ({ key: r.key, label: r.label, description: r.description, tone: r.tone as BadgeTone, archived: !!r.archivedAt, holders: n.get(r.key) ?? 0 }));
}
