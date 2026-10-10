import { DomainError } from "@cm/core";
import { prisma } from "@cm/db";

/**
 * One login with a clinic side and a provider side (workspaces): the two sides never see each other
 * (owner decision Oct 2026). A provider is never matched to, or shown, shifts of a clinic their login
 * belongs to (owner or staff; core F14), and that clinic's users never see the provider in profiles,
 * My providers, search, favorites, blocks or hire requests.
 */

/** Prisma `where` for providers that are NOT on this clinic's own login(s). */
export const notOwnProvider = (clinicOrgId: string) => ({ user: { clinicMembers: { none: { clinicOrgId } } } });

export async function isOwnPair(providerId: string, clinicOrgId: string) {
  return (await prisma.provider.count({ where: { id: providerId, user: { clinicMembers: { some: { clinicOrgId } } } } })) > 0;
}

/** Same message as a provider that doesn't exist, so nothing leaks. */
export async function assertNotOwnPair(providerId: string, clinicOrgId: string) {
  if (await isOwnPair(providerId, clinicOrgId)) throw new DomainError("NOT_FOUND", "Provider not found");
}
