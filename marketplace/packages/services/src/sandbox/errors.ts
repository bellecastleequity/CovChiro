import { createHash } from "node:crypto";
import { isSandbox } from "@cm/config";
import { DomainError } from "@cm/core";
import { prisma } from "@cm/db";
import { requireAdmin, type Actor } from "../context";
import { realNow } from "./time";

/**
 * Test site error log: every server error, failed job, unexpected bot failure,
 * browser error and failed self-check, grouped into one row per distinct problem
 * (same source + message shape + page) with a count. Recording never throws and
 * does nothing on the live site.
 */

export type ErrorSource = "server" | "job" | "bot" | "browser" | "build" | "selfcheck";

/** Ids, numbers and quoted values vary between occurrences of the same problem. */
const shape = (s: string) =>
  s
    .replace(/\bc[a-z0-9]{20,30}\b/g, "<id>")
    .replace(/[0-9a-f]{8}-[0-9a-f-]{27,}/gi, "<id>")
    .replace(/\d+/g, "#")
    .replace(/"[^"]{0,80}"/g, '"…"')
    .slice(0, 300);

const pathShape = (p: string | null | undefined) => (p ? shape(p.split("?")[0]) : "");

export async function recordError(e: { source: ErrorSource; message: string; detail?: string | null; path?: string | null; userId?: string | null }) {
  if (!isSandbox()) return;
  try {
    const message = (e.message || "Unknown error").split("\n").find((l) => l.trim())?.trim().slice(0, 500) ?? "Unknown error";
    const fingerprint = createHash("sha256").update(`${e.source}|${shape(message)}|${pathShape(e.path)}`).digest("hex").slice(0, 40);
    // Real time even inside the self-check's time travel.
    const now = new Date(realNow());
    await prisma.sandboxError.upsert({
      where: { fingerprint },
      create: { fingerprint, source: e.source, message, detail: e.detail?.slice(0, 8000) ?? null, path: e.path?.slice(0, 500) ?? null, userId: e.userId ?? null, firstAt: now, lastAt: now },
      // Seen again: count it, keep the newest details, and reopen it if it was marked fixed.
      update: { count: { increment: 1 }, lastAt: now, resolvedAt: null, detail: e.detail?.slice(0, 8000) ?? undefined, path: e.path?.slice(0, 500) ?? undefined, userId: e.userId ?? undefined },
    });
  } catch (err) {
    console.error("[sandbox] could not record error", err);
  }
}

/** Expected refusals (validation, conflicts) aren't bugs; anything else is. */
export const isUnexpected = (e: unknown) => !(e instanceof DomainError);

export async function listErrors(actor: Actor, opts: { resolved?: boolean; take?: number } = {}) {
  requireAdmin(actor);
  return prisma.sandboxError.findMany({ where: { resolvedAt: opts.resolved ? { not: null } : null }, orderBy: { lastAt: "desc" }, take: opts.take ?? 50 });
}

export async function resolveError(actor: Actor, id: string | "all") {
  requireAdmin(actor);
  const r = await prisma.sandboxError.updateMany({ where: id === "all" ? { resolvedAt: null } : { id }, data: { resolvedAt: new Date() } });
  return id === "all" ? `${r.count} marked fixed. Any that happen again will reappear.` : "Marked fixed. If it happens again it comes back.";
}

/** Errors around a moment (for a problem report): this person's, plus server errors from the last few minutes. */
export async function recentErrors(userId: string | null, minutes = 15) {
  const since = new Date(realNow() - minutes * 60_000);
  return prisma.sandboxError.findMany({
    where: { lastAt: { gte: since }, OR: [...(userId ? [{ userId }] : []), { source: { in: ["server", "job"] } }] },
    orderBy: { lastAt: "desc" },
    take: 8,
    select: { id: true, source: true, message: true, path: true, lastAt: true, count: true },
  });
}
