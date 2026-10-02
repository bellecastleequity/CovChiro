import { DateTime } from "luxon";
import { evaluateHealth, planAlerts, type AlertState, type HealthFacts, type HealthIssue } from "@cm/core";
import { brand } from "@cm/config";
import { missingMigrations, prisma } from "@cm/db";
import { clock, getSettings, requireAdmin, type Actor } from "./context";
import { absoluteUrl, notify, sendEmail } from "./notify";
import { healthKey } from "./healthstate";
import { researchPause } from "./growth/aihealth";
import { aiSpendCents } from "./growth/engine";

/**
 * System health monitor. Every 5 minutes (job systemHealth, and from /api/health
 * so a stopped cron still gets reported) it gathers facts, runs core
 * evaluateHealth, and emails admins about new problems (with the remedy),
 * reminds while they last, and says when they're resolved.
 */

/** Jobs whose failure stops bookings, money or attendance; the rest are warnings. */
const CRITICAL_JOBS = new Set(["dispatchTick", "selectionDeadline", "inviteSettle", "shiftStart", "markUnfilled", "attendance", "payoutRelease", "failedDepositSweep", "volumeSweep", "timeclockSweep", "shiftAutoComplete"]);
const LOOKBACK_H = 6;

type Track = { failStreak: number; lastError: string | null; lastFailAt: string | null; lastOkAt: string | null };
const d = (s: string | null | undefined) => (s ? new Date(s) : null);

export async function gatherHealthFacts(now = clock.now()): Promise<HealthFacts> {
  const s = await getSettings();
  const since = new Date(+now - LOOKBACK_H * 3_600_000);
  const tz = "America/New_York";
  const dayStart = DateTime.fromJSDate(now, { zone: tz }).startOf("day").toJSDate();
  const monthStart = DateTime.fromJSDate(now, { zone: tz }).startOf("month").toJSDate();
  const [rows, aiErrs, dayCents, monthCents, pause, payFails, transferFails, okBackup, failBackup, missing, queued] = await Promise.all([
    prisma.setting.findMany({ where: { key: { startsWith: "health." } } }),
    prisma.aiUsage.findMany({ where: { ok: false, createdAt: { gte: since } }, orderBy: { createdAt: "desc" }, take: 50, select: { provider: true, agent: true, error: true, createdAt: true } }),
    aiSpendCents(dayStart).catch(() => 0),
    aiSpendCents(monthStart).catch(() => 0),
    researchPause().catch(() => null),
    prisma.payment.findMany({ where: { status: "FAILED", updatedAt: { gte: new Date(+now - 24 * 3_600_000) }, failureReason: { not: null } }, orderBy: { updatedAt: "desc" }, take: 20, select: { failureReason: true, updatedAt: true } }),
    prisma.payoutTransfer.findMany({ where: { status: "FAILED", createdAt: { gte: new Date(+now - 24 * 3_600_000) }, failureReason: { not: null } }, orderBy: { createdAt: "desc" }, take: 20, select: { failureReason: true, createdAt: true } }),
    prisma.backupRun.findFirst({ where: { kind: "EXPORT", status: "DONE" }, orderBy: { startedAt: "desc" }, select: { startedAt: true } }),
    prisma.backupRun.findFirst({ where: { kind: "EXPORT", status: "FAILED" }, orderBy: { startedAt: "desc" }, select: { startedAt: true, error: true } }),
    missingMigrations(prisma),
    prisma.communication.count({ where: { status: "QUEUED" } }),
  ]);
  const byKey = new Map(rows.map((r) => [r.key, r.value]));
  const track = (key: string) => {
    const v = byKey.get(key) as Track | undefined;
    return v ? { failStreak: v.failStreak, lastError: v.lastError, lastFailAt: d(v.lastFailAt), lastOkAt: d(v.lastOkAt) } : null;
  };
  const jobs = rows
    .filter((r) => r.key.startsWith("health.job."))
    .map((r) => {
      const v = r.value as Track;
      const name = r.key.slice("health.job.".length);
      return { name, failStreak: v.failStreak, lastError: v.lastError, lastErrorAt: d(v.lastFailAt), lastOkAt: d(v.lastOkAt), critical: CRITICAL_JOBS.has(name) };
    });
  const held = (await prisma.setting.findUnique({ where: { key: "growth.approvedQueueHeld" } }))?.value as { reason?: string; since?: string; at?: string } | null;
  const pct = (cents: number, cap: number) => (cap > 0 ? (cents / cap) * 100 : 0);
  return {
    now,
    lastTickAt: d((byKey.get(healthKey.tick) as { at?: string } | undefined)?.at),
    jobs,
    email: track(healthKey.channel("email")),
    sms: track(healthKey.channel("sms")),
    aiErrors: aiErrs.map((e) => ({ provider: e.provider, agent: e.agent, error: e.error ?? "", at: e.createdAt })),
    aiBudget: { dayPct: pct(dayCents, s["growth.aiDailyBudgetCents"]), monthPct: pct(monthCents, s["growth.aiMonthlyBudgetCents"]), researchDayPct: 0 },
    researchPause: pause,
    stripeFailures: [
      ...payFails.map((p) => ({ kind: "payment" as const, reason: p.failureReason!, at: p.updatedAt })),
      ...transferFails.map((t) => ({ kind: "transfer" as const, reason: t.failureReason!, at: t.createdAt })),
    ],
    backups: { lastOkAt: okBackup?.startedAt ?? null, lastFailure: failBackup ? { at: failBackup.startedAt, error: failBackup.error ?? "" } : null, enabled: s["backups.enabled"] },
    missingMigrations: missing,
    approvedQueue: { queued, heldReason: held?.reason ?? null, heldSince: queued && held ? d(held.since ?? held.at) : null },
  };
}

export async function currentIssues(now = clock.now()) {
  const s = await getSettings();
  const facts = await gatherHealthFacts(now);
  const issues = evaluateHealth(facts, {
    cronStaleMinutes: s["health.cronStaleMinutes"], jobFailStreak: s["health.failStreak"], channelFailStreak: s["health.failStreak"],
    backupMaxAgeHours: s["health.backupMaxAgeHours"], aiBudgetWarnPct: 90, queueHeldHours: 2,
  });
  return { facts, issues };
}

function issueParagraphs(i: HealthIssue) {
  return [`${i.severity === "critical" ? "🔴 CRITICAL" : "🟠 Warning"}: ${i.title}`, `What's happening: ${i.detail}`, `How to fix it: ${i.remedy}`];
}

/** Sends the alert email(s): every admin (email + in-app, text if critical) plus the extra addresses. */
async function sendAlert(issues: { fresh: HealthIssue[]; repeat: HealthIssue[]; resolved: { title: string; since: Date }[] }, test = false) {
  const s = await getSettings();
  const all = [...issues.fresh, ...issues.repeat];
  const critical = all.some((i) => i.severity === "critical");
  const name = brand().name;
  const title = test
    ? `${name}: test alert from System health`
    : all.length
      ? `${critical ? "🔴" : "🟠"} ${name}: ${all.length} problem${all.length === 1 ? "" : "s"} need${all.length === 1 ? "s" : ""} attention`
      : `✅ ${name}: problem resolved`;
  const details = [
    ...(test ? ["This is a test. If you can read it, system health alerts reach you."] : []),
    ...issues.fresh.flatMap(issueParagraphs),
    ...(issues.repeat.length ? ["Still not fixed:", ...issues.repeat.flatMap(issueParagraphs)] : []),
    ...(issues.resolved.length ? ["Resolved:", ...issues.resolved.map((r) => `✅ ${r.title}`)] : []),
    "Live status: Admin → System health.",
  ];
  const body = all.length ? all.map((i) => i.title).join(" · ") : issues.resolved.map((r) => `Resolved: ${r.title}`).join(" · ") || "System health test";
  const admins = await prisma.user.findMany({ where: { role: "PLATFORM_ADMIN", disabledAt: null }, select: { id: true } });
  // In the app (and by text when critical) for every admin; the email goes to the admin inbox, not personal logins.
  for (const a of admins) {
    await notify(prisma, a.id, { template: "system_health", title, body, link: "/admin/health", details, ctaLabel: "Open System health", email: false, emailFallback: false, sms: critical && s["health.textCritical"], push: true });
  }
  const to = [...new Map([s["email.adminInbox"], ...s["health.alertEmails"]].map((e) => [e.toLowerCase(), e])).values()];
  for (const addr of to) {
    await sendEmail(addr, { subject: title, heading: title, paragraphs: [body, ...details], cta: { label: "Open System health", url: absoluteUrl("/admin/health") } });
  }
}

/** Run the checks and send what's due. Safe to call often: a lease limits it to once per ~4 minutes. */
export async function systemHealthSweep(opts: { force?: boolean } = {}) {
  const s = await getSettings();
  if (!s["health.enabled"] && !opts.force) return { skipped: "off" };
  const now = clock.now();
  if (!opts.force) {
    const rows = await prisma.$queryRawUnsafe<{ key: string }[]>(
      `INSERT INTO "Setting" ("key", "value", "updatedAt") VALUES ($1, jsonb_build_object('at', $2::text), now())
       ON CONFLICT ("key") DO UPDATE SET "value" = EXCLUDED."value", "updatedAt" = now()
       WHERE ("Setting"."value"->>'at')::timestamptz < now() - interval '4 minutes'
       RETURNING "key"::text AS key`,
      healthKey.lastRun, now.toISOString(),
    );
    if (!rows.length) return { skipped: "recent" };
  }
  const { issues } = await currentIssues(now);
  const prev = ((await prisma.setting.findUnique({ where: { key: healthKey.state } }))?.value as AlertState | null) ?? {};
  const plan = planAlerts(issues, prev, now, s["health.repeatHours"]);
  if (plan.fresh.length || plan.repeat.length || plan.resolved.length) await sendAlert(plan);
  await prisma.setting.upsert({ where: { key: healthKey.state }, create: { key: healthKey.state, value: plan.next }, update: { value: plan.next } });
  return { issues: issues.length, fresh: plan.fresh.length, repeat: plan.repeat.length, resolved: plan.resolved.length };
}

/** Public watchdog summary for an uptime monitor: no details, just whether anything critical is open. */
export async function healthSummary() {
  void systemHealthSweep().catch(() => undefined); // keeps alerts flowing even when cron has stopped
  const { issues } = await currentIssues();
  const status = issues.some((i) => i.severity === "critical") ? "critical" : issues.length ? "warning" : "ok";
  return { status, checks: issues.map((i) => i.key) };
}

// ---------------- admin ----------------

export async function healthBoard(actor: Actor) {
  requireAdmin(actor);
  const { facts, issues } = await currentIssues();
  const state = ((await prisma.setting.findUnique({ where: { key: healthKey.state } }))?.value as AlertState | null) ?? {};
  const lastRun = d(((await prisma.setting.findUnique({ where: { key: healthKey.lastRun } }))?.value as { at?: string } | null)?.at);
  return { facts, issues: issues.map((i) => ({ ...i, since: d(state[i.key]?.since), lastAlertAt: d(state[i.key]?.lastAlertAt) })), lastRun };
}

export async function runHealthNow(actor: Actor) {
  requireAdmin(actor);
  return systemHealthSweep({ force: true });
}

export async function sendTestAlert(actor: Actor) {
  requireAdmin(actor);
  await sendAlert({ fresh: [], repeat: [], resolved: [] }, true);
}

/** Clears a job's failure record (after fixing it), so it stops alerting until it fails again. */
export async function clearJobHealth(actor: Actor, name: string) {
  requireAdmin(actor);
  await prisma.setting.deleteMany({ where: { key: healthKey.job(name) } });
}
