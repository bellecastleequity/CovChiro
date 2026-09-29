import { prisma } from "@cm/db";
import {
  autoCompleteDue, dispatch, failedDepositSweep, leads, markUnfilled, nightlyCredentialSweep, settleDueInvites, preShiftChecks, recomputeStats,
  releaseDuePayouts, revealExpiredRatings, startDueShifts,
} from "@cm/services";

/**
 * Every background job is an idempotent sweep over due rows (SPEC.md §16):
 * rather than one delayed job per shift/offer, each sweep finds whatever is
 * due "now" and acts on it. Retrying, overlapping or missing a tick is safe;
 * the next tick picks up the slack. Per-shift work takes the shift's
 * advisory lock inside the service layer.
 */
export type Schedule = { everySeconds: number } | { cron: string; tz: string };
export type Job = { name: string; schedule: Schedule; run: () => Promise<unknown> };

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
  // Growth.
  { name: "leadDrip", schedule: { everySeconds: 900 }, run: () => leads.runLeadDrip() },
  // Quality.
  { name: "ratingsReveal", schedule: { everySeconds: 3600 }, run: () => revealExpiredRatings() },
  { name: "statsRecompute", schedule: { everySeconds: 3600 }, run: () => forActiveProviders((id) => recomputeStats(id)) },
  { name: "responsivenessRecompute", schedule: { everySeconds: 3600 }, run: () => forActiveProviders((id) => dispatch.recomputeResponsiveness(id)) },
  { name: "nightlyCredentialSweep", schedule: { cron: "0 2 * * *", tz: "America/New_York" }, run: () => nightlyCredentialSweep() },
];

export const jobByName = new Map(JOBS.map((j) => [j.name, j]));
