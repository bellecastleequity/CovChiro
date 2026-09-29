import { resolveSettings, type SettingsMap } from "@cm/config";
import { DomainError } from "@cm/core";
import { prisma, type Prisma, type Tx } from "@cm/db";

export type Db = Tx;

/** Who is acting. `null` userId = system (jobs, webhooks). */
export interface Actor {
  userId: string | null;
  role: "CLINIC_OWNER" | "CLINIC_STAFF" | "PROVIDER" | "PLATFORM_ADMIN" | "SYSTEM";
  providerId?: string | null;
  clinicOrgId?: string | null;
}

export const SYSTEM: Actor = { userId: null, role: "SYSTEM" };

let cache: { at: number; value: SettingsMap } | null = null;

/** Settings merged over defaults. Cached for 10s per process; `fresh` bypasses the cache. */
export async function getSettings(db: Db = prisma, fresh = false): Promise<SettingsMap> {
  if (!fresh && cache && Date.now() - cache.at < 10_000) return cache.value;
  const rows = await db.setting.findMany();
  const value = resolveSettings(Object.fromEntries(rows.map((r) => [r.key, r.value])));
  cache = { at: Date.now(), value };
  return value;
}

export function invalidateSettings() {
  cache = null;
}

function toJson(v: unknown): Prisma.InputJsonValue | undefined {
  if (v === undefined || v === null) return undefined;
  return JSON.parse(JSON.stringify(v));
}

/** Append-only audit trail for every state transition and admin write. */
export async function audit(db: Db, actor: Actor, action: string, entityType: string, entityId: string, before?: unknown, after?: unknown) {
  await db.auditLog.create({
    data: { actorUserId: actor.userId, action, entityType, entityId, before: toJson(before), after: toJson(after) },
  });
}

export function requireRole(actor: Actor, ...roles: Actor["role"][]) {
  if (!roles.includes(actor.role)) throw new DomainError("FORBIDDEN", "You don't have access to that.");
}

export function requireProvider(actor: Actor): string {
  if (actor.role !== "PROVIDER" || !actor.providerId) throw new DomainError("FORBIDDEN", "Provider account required.");
  return actor.providerId;
}

export function requireClinic(actor: Actor, opts: { ownerOnly?: boolean } = {}): string {
  if ((actor.role !== "CLINIC_OWNER" && actor.role !== "CLINIC_STAFF") || !actor.clinicOrgId) throw new DomainError("FORBIDDEN", "Clinic account required.");
  if (opts.ownerOnly && actor.role !== "CLINIC_OWNER") throw new DomainError("FORBIDDEN", "Only the clinic owner can do that.");
  return actor.clinicOrgId;
}

export function requireAdmin(actor: Actor) {
  if (actor.role !== "PLATFORM_ADMIN" && actor.role !== "SYSTEM") throw new DomainError("FORBIDDEN", "Admin only.");
}

/** Run in a SERIALIZABLE-safe transaction with retry on serialization failures. */
export async function tx<T>(fn: (db: Db) => Promise<T>, opts: { isolation?: Prisma.TransactionIsolationLevel } = {}): Promise<T> {
  for (let attempt = 0; ; attempt++) {
    try {
      return await prisma.$transaction((t) => fn(t), { isolationLevel: opts.isolation, timeout: 20_000, maxWait: 10_000 });
    } catch (e) {
      const code = (e as { code?: string }).code;
      if ((code === "P2034" || /could not serialize|deadlock/i.test(String(e))) && attempt < 3) continue;
      throw e;
    }
  }
}
