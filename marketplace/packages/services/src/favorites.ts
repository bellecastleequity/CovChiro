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
  } else {
    await prisma.favorite.deleteMany({ where: key });
  }
  await audit(prisma, actor, on ? "favorite.added" : "favorite.removed", key.toType, targetId);
}

export async function setBlock(actor: Actor, targetId: string, on: boolean, reason?: string) {
  const clinic = actor.role !== "PROVIDER";
  const fromId = clinic ? requireClinic(actor) : requireProvider(actor);
  const key = { fromType: clinic ? "CLINIC" : "PROVIDER", fromId, toType: clinic ? "PROVIDER" : "CLINIC", toId: targetId } as const;
  if (on) await prisma.block.upsert({ where: { fromType_fromId_toType_toId: key }, create: { ...key, reason: reason?.slice(0, 300) }, update: { reason: reason?.slice(0, 300) } });
  else await prisma.block.deleteMany({ where: key });
  await audit(prisma, actor, on ? "block.added" : "block.removed", key.toType, targetId, null, { reason });
}
