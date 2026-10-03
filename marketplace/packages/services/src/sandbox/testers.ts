import { DomainError } from "@cm/core";
import { prisma } from "@cm/db";
import { hashPassword } from "../auth";
import { audit, requireAdmin, type Actor } from "../context";
import { assertSandbox } from "./cast";

/**
 * Testers: extra admin logins on the test site for people helping evaluate it.
 * They get full admin access (and Act as) but can't build, rebuild or stop the
 * demo data, manage testers, or suspend/delete the owner's logins. Every admin
 * NOT on this list is an owner (the one made at /setup).
 */

const KEY = "sandbox.testers";

async function testerIds(): Promise<string[]> {
  const v = (await prisma.setting.findUnique({ where: { key: KEY } }))?.value;
  return Array.isArray(v) ? (v as string[]) : [];
}
async function saveTesterIds(ids: string[]) {
  const now = new Date();
  await prisma.setting.upsert({ where: { key: KEY }, create: { key: KEY, value: ids, updatedAt: now }, update: { value: ids, updatedAt: now } });
}

export async function isTester(userId: string | null | undefined) {
  return !!userId && (await testerIds()).includes(userId);
}

/** Owner-only actions on the test site (build/rebuild/stop, testers). */
export async function requireOwner(actor: Actor) {
  requireAdmin(actor);
  if (await isTester(actor.userId)) throw new DomainError("FORBIDDEN", "Only the test site's owner can do this.");
}

/** Testers may not suspend or delete an owner's login. */
export async function assertMayManageUser(actor: Actor, target: { id: string; role: string }) {
  if (target.role !== "PLATFORM_ADMIN") return;
  if ((await isTester(actor.userId)) && !(await isTester(target.id))) throw new DomainError("FORBIDDEN", "Testers can't change the owner's login.");
}

export async function listTesters(actor: Actor) {
  requireAdmin(actor);
  assertSandbox();
  const ids = await testerIds();
  if (!ids.length) return [];
  return prisma.user.findMany({ where: { id: { in: ids } }, select: { id: true, name: true, email: true, disabledAt: true, lastLoginAt: true, mfaEnabled: true, createdAt: true }, orderBy: { createdAt: "asc" } });
}

/** Owner: add a tester (a new admin login with a temporary password; two-step sign-in is set up at first login). */
export async function addTester(actor: Actor, input: { name: string; email: string; password: string }) {
  assertSandbox();
  await requireOwner(actor);
  const name = input.name.trim();
  const email = input.email.trim().toLowerCase();
  if (name.length < 2) throw new DomainError("VALIDATION", "Enter the tester's name.");
  if (!/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)) throw new DomainError("VALIDATION", "Enter a valid email address.");
  if (input.password.length < 12) throw new DomainError("VALIDATION", "Use a temporary password of at least 12 characters.");
  const existing = await prisma.user.findUnique({ where: { email } });
  const ids = await testerIds();
  let userId: string;
  if (existing) {
    // Re-adding a removed tester turns their login back on with the new password.
    if (!ids.includes(existing.id) && !existing.disabledAt) throw new DomainError("CONFLICT", "That email already has a login on the test site.");
    if (existing.role !== "PLATFORM_ADMIN") throw new DomainError("CONFLICT", "That email belongs to a demo clinic or provider login.");
    await prisma.user.update({ where: { id: existing.id }, data: { name, passwordHash: await hashPassword(input.password), disabledAt: null } });
    userId = existing.id;
  } else {
    userId = (await prisma.user.create({ data: { email, name, role: "PLATFORM_ADMIN", passwordHash: await hashPassword(input.password), emailVerifiedAt: new Date() } })).id;
  }
  if (!ids.includes(userId)) await saveTesterIds([...ids, userId]);
  await audit(prisma, actor, "sandbox.tester_added", "User", userId, null, { email });
  return `${name} can now sign in at the test site with ${email} and the temporary password. They'll set up two-step sign-in the first time.`;
}

/** Owner: remove a tester (their login is switched off and signed out). */
export async function removeTester(actor: Actor, userId: string) {
  assertSandbox();
  await requireOwner(actor);
  const ids = await testerIds();
  if (!ids.includes(userId)) throw new DomainError("NOT_FOUND", "That login isn't a tester.");
  await prisma.$transaction([
    prisma.user.update({ where: { id: userId }, data: { disabledAt: new Date() } }),
    prisma.session.deleteMany({ where: { userId } }),
  ]);
  await saveTesterIds(ids.filter((id) => id !== userId));
  await audit(prisma, actor, "sandbox.tester_removed", "User", userId);
  return "Tester removed: they're signed out and can't sign in.";
}
