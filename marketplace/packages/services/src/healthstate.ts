import { prisma, type Prisma } from "@cm/db";
import { clock } from "./context";

/**
 * Cheap health bookkeeping for the system health monitor (health.ts), kept in
 * Setting rows (no schema). Writes happen on failures, on recovery, and at
 * most every few minutes on success, so normal traffic costs nearly nothing.
 * Never throws: health bookkeeping must not break the thing it watches.
 */

type Track = { failStreak: number; lastError: string | null; lastFailAt: string | null; lastOkAt: string | null };
const memo = new Map<string, { failing: boolean; okWrittenAt: number }>();
const OK_REFRESH_MS = 10 * 60_000;

async function put(key: string, value: unknown) {
  const v = value as Prisma.InputJsonValue;
  await prisma.setting.upsert({ where: { key }, create: { key, value: v }, update: { value: v } });
}

async function track(key: string, ok: boolean, error?: string | null) {
  try {
    const m = memo.get(key);
    const now = +clock.now();
    if (ok && m && !m.failing && now - m.okWrittenAt < OK_REFRESH_MS) return;
    const row = await prisma.setting.findUnique({ where: { key } });
    const prev = (row?.value as Track | null) ?? { failStreak: 0, lastError: null, lastFailAt: null, lastOkAt: null };
    const iso = new Date(now).toISOString();
    const next: Track = ok
      ? { ...prev, failStreak: 0, lastOkAt: iso }
      : { ...prev, failStreak: prev.failStreak + 1, lastError: (error ?? "unknown error").slice(0, 500), lastFailAt: iso };
    await put(key, next);
    memo.set(key, { failing: !ok, okWrittenAt: ok ? now : m?.okWrittenAt ?? 0 });
  } catch {
    /* never let monitoring break sending or jobs */
  }
}

export const healthKey = { tick: "health.tick", job: (n: string) => `health.job.${n}`, channel: (c: "email" | "sms") => `health.channel.${c}`, state: "health.alertState", lastRun: "health.lastRun" };

/** Every background tick (cron request or worker loop). Written at most once a minute per process. */
let lastTickWrite = 0;
export async function recordTick() {
  const now = +clock.now();
  if (Math.abs(now - lastTickWrite) < 50_000) return;
  lastTickWrite = now;
  await put(healthKey.tick, { at: new Date(now).toISOString() }).catch(() => undefined);
}

export const recordJobResult = (name: string, ok: boolean, error?: string | null) => track(healthKey.job(name), ok, error);
export const recordChannel = (channel: "email" | "sms", ok: boolean, error?: string | null) => track(healthKey.channel(channel), ok, error);
