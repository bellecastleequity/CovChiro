import { purgeSpam } from "./spam";
import { nightlyBackup } from "./backups";
import { referralSweep } from "./referrals";
import { timeclockSweep } from "./timeclock";
import { volumeSweep } from "./volume";
import { recruitSweep } from "./shiftRecruit";
import { prisma } from "@cm/db";
import { DateTime } from "luxon";
import * as dispatch from "./dispatch";
import { attendanceSweep } from "./attendance";
import { sendBookingDigests } from "./digests";
import * as leads from "./leads";
import { growthTick, supplyGapSweep, weeklyBriefing } from "./growth/agents";
import { prospectingTick } from "./growth/prospecting";
import { marketSupplySweep } from "./growth/supply";
import { approvedQueueSweep } from "./growth/admin";
import { autoCompleteDue, failedDepositSweep, markUnfilled, nightlyCredentialSweep, preShiftChecks, recomputeStats, revealExpiredRatings, startDueShifts } from "./lifecycle";
import { releaseDuePayouts } from "./payouts";
import { settleDueInvites } from "./shifts";
import { standingSweep } from "./standing";
import { runPreLicensureFollowups } from "./prelicensure";
import { autoDraftSweep } from "./blog";

/**
 * Every background job is an idempotent sweep over due rows (SPEC.md §16):
 * rather than one delayed job per shift/offer, each sweep finds whatever is
 * due "now" and acts on it. Retrying, overlapping or missing a tick is safe;
 * the next tick picks up the slack. Per-shift work takes the shift's
 * advisory lock inside the service layer.
 */
export type Schedule = { everySeconds: number } | { cron: string; tz: string };
/**
 * leaseMinutes: while a run holds its lease, another tick skips the job instead of starting a
 * second copy (slow AI work under a once-a-minute cron would otherwise pile up processes).
 * long: on the external cron, the request returns without waiting; the run finishes in the background.
 */
export type Job = { name: string; schedule: Schedule; run: () => Promise<unknown>; leaseMinutes?: number; long?: boolean };

async function forActiveProviders(fn: (id: string) => Promise<unknown>) {
  const ids = await prisma.provider.findMany({ where: { status: "ACTIVE" }, select: { id: true } });
  for (const { id } of ids) await fn(id);
  return ids.length;
}

export const JOBS: Job[] = [
  // Smart Dispatch (Addendum 02): wave windows are minutes long on same-day shifts.
  { name: "dispatchTick", schedule: { everySeconds: 15 }, run: () => dispatch.tickDispatch() },
  { name: "selectionDeadline", schedule: { everySeconds: 60 }, run: () => dispatch.runSelectionDeadlines() },
  { name: "inviteSettle", schedule: { everySeconds: 60 }, run: () => settleDueInvites() },
  { name: "favoritesWindowEnd", schedule: { everySeconds: 60 }, run: () => dispatch.endFavoritesWindows() },
  // Shift lifecycle.
  { name: "shiftStart", schedule: { everySeconds: 60 }, run: () => startDueShifts() },
  { name: "markUnfilled", schedule: { everySeconds: 60 }, run: () => markUnfilled() },
  { name: "shiftAutoComplete", schedule: { everySeconds: 300 }, run: () => autoCompleteDue() },
  { name: "failedDepositSweep", schedule: { everySeconds: 300 }, run: () => failedDepositSweep() },
  { name: "preShiftEligibilityCheck", schedule: { everySeconds: 900 }, run: () => preShiftChecks() },
  // Money.
  { name: "payoutRelease", schedule: { everySeconds: 900 }, run: () => releaseDuePayouts() },
  // Reconfirmation (48h/24h) and day-of "On my way" check-in.
  { name: "attendance", schedule: { everySeconds: 60 }, run: () => attendanceSweep() },
  // Provider booking emails: each provider's local send time, so check every tick.
  { name: "bookingDigests", schedule: { everySeconds: 60 }, run: () => sendBookingDigests() },
  // Standing bookings: keep each one booked out to the horizon.
  { name: "standingBookings", schedule: { everySeconds: 3600 }, run: () => standingSweep() },
  // Growth.
  { name: "leadDrip", schedule: { everySeconds: 900 }, run: () => leads.runLeadDrip() },
  // Spam folder: delete filtered messages after spam.retentionDays.
  // Referral rewards: both sides once the invited person's first shift is done (+ hold).
  // Time clock: close forgotten punch-outs, remind clinics, auto-approve timesheets.
  { name: "timeclockSweep", schedule: { everySeconds: 900 }, run: () => timeclockSweep() },
  { name: "volumeSweep", schedule: { everySeconds: 300 }, run: () => volumeSweep() },
  { name: "recruitSweep", schedule: { everySeconds: 600 }, run: () => recruitSweep() },
  { name: "referralSweep", schedule: { everySeconds: 3600 }, run: () => referralSweep() },
  // Backups: encrypted export + Neon restore point + pruning, nightly at 3:10 ET.
  { name: "dbBackup", schedule: { cron: "10 3 * * *", tz: "America/New_York" }, run: () => nightlyBackup(), leaseMinutes: 30, long: true },
  { name: "spamCleanup", schedule: { cron: "20 4 * * *", tz: "America/New_York" }, run: () => purgeSpam() },
  // Students: one state-aware credential follow-up when due (30/60/90 days after graduation, then every 60).
  { name: "preLicensureFollowups", schedule: { cron: "15 10 * * *", tz: "America/New_York" }, run: () => runPreLicensureFollowups() },
  // Growth agents (services/src/growth): event-driven sweeps; nothing calls AI unless something is due.
  { name: "growthApprovedQueue", schedule: { everySeconds: 60 }, run: () => approvedQueueSweep(), leaseMinutes: 5 },
  { name: "growthAgents", schedule: { everySeconds: 900 }, run: () => growthTick(), leaseMinutes: 20, long: true },
  // Automatic clinic prospecting: NPI registry discovery + AI web research (budget-capped, ~2 min per run max).
  { name: "growthProspecting", schedule: { everySeconds: 600 }, run: () => prospectingTick(), leaseMinutes: 15, long: true },
  // Supply Gap agent: open shifts with no eligible provider + every market's supply status.
  { name: "growthSupplyGaps", schedule: { everySeconds: 3600 }, run: async () => ({ shifts: await supplyGapSweep(), markets: await marketSupplySweep() }), leaseMinutes: 15, long: true },
  // Blog: AI writes up to blog.autoDraftsPerWeek drafts for review (never publishes).
  { name: "blogAutoDraft", schedule: { cron: "40 9 * * *", tz: "America/New_York" }, run: () => autoDraftSweep(), leaseMinutes: 15, long: true },
  // Daily schedule slot; the briefing itself only goes out on Mondays.
  { name: "growthWeeklyBriefing", schedule: { cron: "0 8 * * *", tz: "America/New_York" }, run: () => (DateTime.now().setZone("America/New_York").weekday === 1 ? weeklyBriefing() : Promise.resolve("not Monday")), leaseMinutes: 15, long: true },
  // Quality.
  { name: "ratingsReveal", schedule: { everySeconds: 3600 }, run: () => revealExpiredRatings() },
  { name: "statsRecompute", schedule: { everySeconds: 3600 }, run: () => forActiveProviders((id) => recomputeStats(id)) },
  { name: "responsivenessRecompute", schedule: { everySeconds: 3600 }, run: () => forActiveProviders((id) => dispatch.recomputeResponsiveness(id)) },
  { name: "nightlyCredentialSweep", schedule: { cron: "0 2 * * *", tz: "America/New_York" }, run: () => nightlyCredentialSweep() },
];

export const jobByName = new Map(JOBS.map((j) => [j.name, j]));

/**
 * Jobs due on a once-a-minute external tick (cPanel cron, Cloud Scheduler):
 * sub-minute jobs run every tick; longer intervals run when the minute of the
 * day is a multiple of the interval; cron jobs run in their scheduled minute.
 */
export function jobsDueAt(now: Date): Job[] {
  const minuteOfDay = Math.floor(+now / 60_000);
  return JOBS.filter((j) => {
    if ("everySeconds" in j.schedule) return j.schedule.everySeconds <= 60 || minuteOfDay % Math.round(j.schedule.everySeconds / 60) === 0;
    const [min, hour] = j.schedule.cron.split(" ").map(Number);
    const local = DateTime.fromJSDate(now, { zone: j.schedule.tz });
    return local.hour === hour && local.minute === min;
  });
}

const leaseKey = (name: string) => `job.lease.${name}`;

/** Take a job's run lease (false = another run still holds it). Expired leases are taken over. */
export async function acquireLease(name: string, minutes: number): Promise<boolean> {
  const until = new Date(Date.now() + minutes * 60_000).toISOString();
  const rows = await prisma.$queryRawUnsafe<{ key: string }[]>(
    `INSERT INTO "Setting" ("key", "value", "updatedAt") VALUES ($1, jsonb_build_object('until', $2::text), now())
     ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()
     WHERE ("Setting"."value"->>'until')::timestamptz < now()
     RETURNING "key"::text AS key`,
    leaseKey(name), until,
  );
  return rows.length === 1;
}

export async function releaseLease(name: string) {
  await prisma.setting.deleteMany({ where: { key: leaseKey(name) } });
}

/**
 * Run jobs one after another; one failure never stops the rest. A job whose previous run is
 * still going is skipped. With `background`, long jobs are started and not awaited (cron ticks).
 */
export async function runJobs(jobs: Job[], opts: { background?: boolean } = {}) {
  const out: { job: string; ok: boolean; ms: number; result?: unknown; error?: string; skipped?: string; started?: boolean }[] = [];
  for (const j of jobs) {
    const t = Date.now();
    if (!(await acquireLease(j.name, j.leaseMinutes ?? 5).catch(() => true))) {
      out.push({ job: j.name, ok: true, ms: 0, skipped: "still running" });
      continue;
    }
    const exec = async () => {
      try {
        return { ok: true as const, result: await j.run() };
      } catch (e) {
        return { ok: false as const, error: (e as Error).message };
      } finally {
        await releaseLease(j.name).catch(() => undefined);
      }
    };
    if (opts.background && j.long) {
      void exec().then((r) => { if (!r.ok) console.error(JSON.stringify({ msg: "job.failed", job: j.name, error: r.error })); });
      out.push({ job: j.name, ok: true, ms: 0, started: true });
      continue;
    }
    const r = await exec();
    out.push({ job: j.name, ok: r.ok, ms: Date.now() - t, ...(r.ok ? { result: r.result } : { error: r.error }) });
  }
  return out;
}
