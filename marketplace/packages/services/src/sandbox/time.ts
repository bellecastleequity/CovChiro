import { AsyncLocalStorage } from "node:async_hooks";
import { prisma } from "@cm/db";

/**
 * Test site time travel. The demo history (shifts worked weeks ago, timesheets,
 * payouts, ratings) is made by running the real workflows "back then": inside
 * `atTime`, `new Date()` / `Date.now()` (and so `clock.now()`) read the chosen
 * moment, for that call chain only (AsyncLocalStorage). Every other request on
 * the server keeps real time. Installed only by the sandbox code, never on the
 * live site.
 */

const store = new AsyncLocalStorage<{ offset: number }>();
const RealDate = Date;
let installed = false;

function install() {
  if (installed) return;
  installed = true;
  const now = () => RealDate.now() + (store.getStore()?.offset ?? 0);
  // A function (not a class) so `Date()` without `new` still works.
  function SandboxDate(this: unknown, ...a: unknown[]) {
    if (!new.target) return RealDate();
    if (a.length === 0) return new RealDate(now());
    return new (RealDate as unknown as new (...x: unknown[]) => Date)(...a);
  }
  Object.setPrototypeOf(SandboxDate, RealDate);
  SandboxDate.prototype = RealDate.prototype;
  (SandboxDate as unknown as { now: () => number }).now = now;
  globalThis.Date = SandboxDate as unknown as DateConstructor;
}

/** The real time, even inside `atTime`. */
export const realNow = () => RealDate.now();

/** Run `fn` with the clock starting at `at` (it keeps ticking from there). Use `travel` inside to jump. */
export async function atTime<T>(at: Date | number, fn: () => Promise<T>): Promise<T> {
  install();
  return store.run({ offset: +at - realNow() }, fn);
}

/** Inside `atTime`: jump to another moment. */
export function travel(to: Date | number) {
  const s = store.getStore();
  if (!s) throw new Error("travel() outside atTime()");
  s.offset = +to - realNow();
}

let tables: string[] | null = null;
/**
 * The database stamps createdAt with the real time. After work done "in the past",
 * move rows created since `since` (real time) to the simulated moment, so lists
 * read "3 weeks ago" like they would have.
 */
export async function restamp(since: number, to: Date) {
  tables ??= (
    await prisma.$queryRawUnsafe<{ t: string }[]>(
      `SELECT table_name::text AS t FROM information_schema.columns WHERE table_schema = 'public' AND column_name = 'createdAt' AND table_name NOT IN ('Setting', 'SandboxMessage', 'Session', 'AuditLog')`,
    )
  ).map((r) => r.t);
  const from = new RealDate(since);
  for (const t of tables) await prisma.$executeRawUnsafe(`UPDATE "${t}" SET "createdAt" = $1 WHERE "createdAt" >= $2`, to, from);
}
