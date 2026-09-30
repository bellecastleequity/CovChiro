import { DomainError } from "@cm/core";
import { prisma } from "@cm/db";
import { audit, requireClinic, requireProvider, type Actor } from "./context";

/**
 * Favorites & blocks (SPEC §12). A clinic can favorite a provider only after
 * a completed shift together; a provider can favorite a clinic only after a
 * completed shift there. Blocks can be set any time and are enforced by F9.
 */

async function workedTogether(clinicOrgId: string, providerId: string) {
  return (await prisma.assignment.count({ where: { providerId, status: "COMPLETED", shift: { location: { clinicOrgId } } } })) > 0;
}

export async function setFavorite(actor: Actor, targetId: string, on: boolean) {
  const clinic = actor.role !== "PROVIDER";
  const fromId = clinic ? requireClinic(actor) : requireProvider(actor);
  const [clinicOrgId, providerId] = clinic ? [fromId, targetId] : [targetId, fromId];
  const key = { fromType: clinic ? "CLINIC" : "PROVIDER", fromId, toType: clinic ? "PROVIDER" : "CLINIC", toId: targetId } as const;
  if (on) {
    if (!(await workedTogether(clinicOrgId, providerId))) throw new DomainError("FORBIDDEN", "You can favorite after completing a shift together.");
    await prisma.favorite.upsert({ where: { fromType_fromId_toType_toId: key }, create: key, update: {} });
    await prisma.block.deleteMany({ where: key }); // a favorite is never also blocked
  } else {
    await prisma.favorite.deleteMany({ where: key });
  }
  await audit(prisma, actor, on ? "favorite.added" : "favorite.removed", key.toType, targetId);
}

export async function setBlock(actor: Actor, targetId: string, on: boolean, reason?: string) {
  const clinic = actor.role !== "PROVIDER";
  const fromId = clinic ? requireClinic(actor) : requireProvider(actor);
  const key = { fromType: clinic ? "CLINIC" : "PROVIDER", fromId, toType: clinic ? "PROVIDER" : "CLINIC", toId: targetId } as const;
  if (on) {
    await prisma.block.upsert({ where: { fromType_fromId_toType_toId: key }, create: { ...key, reason: reason?.slice(0, 300) }, update: { reason: reason?.slice(0, 300) } });
    await prisma.favorite.deleteMany({ where: key });
  } else await prisma.block.deleteMany({ where: key });
  await audit(prisma, actor, on ? "block.added" : "block.removed", key.toType, targetId, null, { reason });
}

/** The clinic's "My providers" page: favorites and blocked providers. */
export async function clinicRelationships(actor: Actor) {
  const orgId = requireClinic(actor);
  const [favs, blocks] = await Promise.all([
    prisma.favorite.findMany({ where: { fromType: "CLINIC", fromId: orgId, toType: "PROVIDER" }, orderBy: { createdAt: "desc" } }),
    prisma.block.findMany({ where: { fromType: "CLINIC", fromId: orgId, toType: "PROVIDER" }, orderBy: { createdAt: "desc" } }),
  ]);
  const people = await prisma.provider.findMany({ where: { id: { in: [...favs, ...blocks].map((x) => x.toId) } }, select: { id: true, displayName: true, photoUrl: true, homeCity: true, homeState: true } });
  const pBy = new Map(people.map((p) => [p.id, p]));
  const shifts = await prisma.assignment.groupBy({ by: ["providerId"], where: { providerId: { in: favs.map((f) => f.toId) }, status: "COMPLETED", shift: { location: { clinicOrgId: orgId } } }, _count: true });
  const countBy = new Map(shifts.map((x) => [x.providerId, x._count]));
  return {
    favorites: favs.filter((f) => pBy.has(f.toId)).map((f) => ({ ...pBy.get(f.toId)!, since: f.createdAt, shiftsTogether: countBy.get(f.toId) ?? 0 })),
    blocked: blocks.filter((b) => pBy.has(b.toId)).map((b) => ({ ...pBy.get(b.toId)!, since: b.createdAt, reason: b.reason })),
  };
}

/** Upcoming shifts already booked with a provider (blocking doesn't cancel these). */
export async function upcomingWith(actor: Actor, providerId: string) {
  const orgId = requireClinic(actor);
  return prisma.assignment.findMany({
    where: { providerId, status: { in: ["CONFIRMED", "IN_PROGRESS"] }, shift: { location: { clinicOrgId: orgId } } },
    select: { shiftId: true, startsAt: true },
    orderBy: { startsAt: "asc" },
  });
}

export async function clinicRelationshipWith(actor: Actor, providerId: string) {
  const orgId = requireClinic(actor);
  const key = { fromType: "CLINIC", fromId: orgId, toType: "PROVIDER", toId: providerId } as const;
  const [fav, block, worked] = await Promise.all([
    prisma.favorite.findUnique({ where: { fromType_fromId_toType_toId: key } }),
    prisma.block.findUnique({ where: { fromType_fromId_toType_toId: key } }),
    workedTogether(orgId, providerId),
  ]);
  return { favorite: !!fav, blocked: !!block, workedTogether: worked };
}
