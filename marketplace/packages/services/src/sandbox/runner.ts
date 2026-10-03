import { DateTime } from "luxon";
import { isSandbox } from "@cm/config";
import { DomainError } from "@cm/core";
import { prisma } from "@cm/db";
import { requireAdmin, type Actor } from "../context";
import { assertSafeDatabase, assertSandbox } from "./cast";
import { requireOwner } from "./testers";
import { recordError } from "./errors";
import { initialPlan, topUpPlan } from "./plan";
import { runSpec, SPEC_LABEL, ZONE, type Spec } from "./steps";

/**
 * The demo is built by a queue of small steps kept in Setting "sandbox.queue".
 * The admin button starts it in the background and each cron tick picks it up
 * again (one runner at a time), so a build of a few hundred steps never ties
 * up a web request. While it's
 * running, the site's normal background jobs pause (they'd act on half-made
 * history).
 */

const KEY = "sandbox.queue";
const LAST_KEY = "sandbox.lastRun";
const WEEKLY_KEY = "sandbox.lastWeekly";

export interface QueueState {
  label: string;
  specs: Spec[];
  done: number;
  errors: { step: number; kind: Spec["k"]; message: string }[];
  startedAt: string;
  finishedAt?: string | null;
  adminUserId: string | null;
}

async function read(key: string) {
  return (await prisma.setting.findUnique({ where: { key } }))?.value as unknown;
}
async function write(key: string, value: unknown) {
  const now = new Date();
  await prisma.setting.upsert({ where: { key }, create: { key, value: value as object, updatedAt: now }, update: { value: value as object, updatedAt: now } });
}

export async function queueState(): Promise<QueueState | null> {
  return ((await read(KEY)) as QueueState | undefined) ?? null;
}
export async function lastRun(): Promise<QueueState | null> {
  return ((await read(LAST_KEY)) as QueueState | undefined) ?? null;
}

/** True while a build/top-up is in progress: the other jobs wait. */
export async function sandboxBusy() {
  if (!isSandbox()) return false;
  const q = await queueState().catch(() => null);
  return !!q && q.done < q.specs.length;
}

async function enqueue(label: string, specs: Spec[], adminUserId: string | null, replace = false) {
  const q = await queueState();
  if (q && q.done < q.specs.length && !replace) {
    q.specs.push(...specs);
    q.label = `${q.label} + ${label}`;
    await write(KEY, q);
    return q;
  }
  const fresh: QueueState = { label, specs, done: 0, errors: [], startedAt: new Date().toISOString(), finishedAt: null, adminUserId };
  await write(KEY, fresh);
  return fresh;
}

/** Work through the queue until it's empty or `budgetMs` is spent. Safe to call from several places (leased). */
export async function runQueue(budgetMs = 45_000) {
  if (!isSandbox()) return "not the test site";
  // Loaded lazily: jobs.ts also loads this file.
  const { acquireLease, releaseLease } = await import("../jobs");
  if (!(await acquireLease("sandbox.queue", 3))) return "already running";
  const t0 = Date.now();
  let ran = 0;
  try {
    for (;;) {
      const q = await queueState();
      if (!q || q.done >= q.specs.length) return ran ? `${ran} steps` : "nothing to do";
      if (Date.now() - t0 > budgetMs) return `${ran} steps (more next tick)`;
      // Keep the lease fresh for long runs.
      await prisma.setting.update({ where: { key: "job.lease.sandbox.queue" }, data: { value: { until: new Date(Date.now() + 3 * 60_000).toISOString() } } }).catch(() => undefined);
      const i = q.done;
      const spec = q.specs[i];
      const admin: Actor = { userId: q.adminUserId, role: "PLATFORM_ADMIN", providerId: null, clinicOrgId: null };
      if (spec.k === "topup") {
        const more = await topUpPlan();
        q.specs.splice(i + 1, 0, ...more);
      } else {
        try {
          await runSpec(spec, i * 7 + 3, admin);
        } catch (e) {
          q.errors.push({ step: i, kind: spec.k, message: (e as Error).message.slice(0, 300) });
          await recordError({ source: "build", message: `${spec.k}: ${(e as Error).message}`, detail: `${JSON.stringify(spec)}\n${(e as Error).stack ?? ""}` });
          console.error(`[sandbox] step ${i} (${spec.k}) failed:`, (e as Error).message);
        }
      }
      q.done = i + 1;
      ran++;
      if (q.done >= q.specs.length) {
        q.finishedAt = new Date().toISOString();
        await write(LAST_KEY, { ...q, specs: [] , total: q.specs.length });
        await prisma.setting.deleteMany({ where: { key: KEY } });
        return `${ran} steps, finished`;
      }
      await write(KEY, q);
    }
  } finally {
    await releaseLease("sandbox.queue").catch(() => undefined);
  }
}

/**
 * Kick the queue without making the caller wait (an admin click returns at once).
 * It keeps going for up to 30 minutes; if the process is recycled, the next cron tick resumes it.
 */
function kick() {
  void runQueue(30 * 60_000).catch((e) => console.error("[sandbox] runQueue", e));
}

/** Admin: (re)build the whole demo: wipe, people, three weeks of history, special cases, the next 37 days. */
export async function startBuild(actor: Actor) {
  await requireOwner(actor);
  await assertSafeDatabase();
  const q = await queueState();
  if (q && q.done < q.specs.length) throw new DomainError("CONFLICT", "A build is already running. Watch its progress below.");
  await enqueue("Build demo data", await initialPlan(), actor.userId, true);
  kick();
  return "Building the demo data. This takes 15 to 30 minutes; the page shows the progress.";
}

/** Admin: add whatever is missing for the next 37 days now (what Sunday evening does). */
export async function startTopUp(actor: Actor) {
  requireAdmin(actor);
  assertSandbox();
  if (!(await prisma.setting.findUnique({ where: { key: "sandbox.builtAt" } }))) throw new DomainError("VALIDATION", "Build the demo data first.");
  await enqueue("Top up shifts", [{ k: "topup" }], actor.userId);
  kick();
  return "Adding shifts for the next 37 days.";
}

/** Admin: stop a stuck build (what's done stays). */
export async function cancelQueue(actor: Actor) {
  await requireOwner(actor);
  assertSandbox();
  const q = await queueState();
  if (q) await write(LAST_KEY, { ...q, specs: [], total: q.specs.length, finishedAt: new Date().toISOString(), cancelled: true });
  await prisma.setting.deleteMany({ where: { key: KEY } });
  const { releaseLease } = await import("../jobs");
  await releaseLease("sandbox.queue").catch(() => undefined);
  return "Stopped.";
}

/**
 * Job (hourly): every Sunday from 6 PM Eastern, once, top up the next 37 days
 * so there are always a month of future shifts to work with.
 */
export async function weeklyTopUp(now = new Date()) {
  if (!isSandbox()) return "not the test site";
  if (!(await prisma.setting.findUnique({ where: { key: "sandbox.builtAt" } }))) return "no demo yet";
  const et = DateTime.fromJSDate(now, { zone: ZONE });
  if (et.weekday !== 7 || et.hour < 18) return "not Sunday evening";
  const today = et.toISODate();
  if ((await read(WEEKLY_KEY)) === today) return "already done this week";
  await write(WEEKLY_KEY, today);
  await enqueue("Sunday top-up", [{ k: "topup" }], null);
  return runQueue();
}

export const stepLabel = (k: Spec["k"]) => SPEC_LABEL[k];
