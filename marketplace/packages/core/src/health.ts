/**
 * System health rules: facts in, issues out (each with a plain-language remedy).
 * Pure so every alert is testable; services/health.ts gathers the facts and
 * sends the emails. An issue's `key` is stable while the problem lasts, so
 * alerts can be sent once, repeated on a schedule, and marked resolved.
 */

export type Severity = "critical" | "warning";
export interface HealthIssue { key: string; severity: Severity; title: string; detail: string; remedy: string; link?: string }

export interface ChannelFacts { failStreak: number; lastError: string | null; lastFailAt: Date | null; lastOkAt: Date | null }
export interface JobFacts { name: string; failStreak: number; lastError: string | null; lastErrorAt: Date | null; lastOkAt: Date | null; critical: boolean }

export interface HealthFacts {
  now: Date;
  /** Last background-job tick (cron or worker); null = never recorded. */
  lastTickAt: Date | null;
  jobs: JobFacts[];
  email: ChannelFacts | null;
  sms: ChannelFacts | null;
  /** Failed AI calls in the lookback window, newest first. */
  aiErrors: { provider: string; agent: string; error: string; at: Date }[];
  aiBudget: { dayPct: number; monthPct: number; researchDayPct: number };
  researchPause: { reason: string; error: string; until: Date } | null;
  /** Stripe failures in the lookback window (payments and provider transfers). */
  stripeFailures: { kind: "payment" | "transfer"; reason: string; at: Date }[];
  backups: { lastOkAt: Date | null; lastFailure: { at: Date; error: string } | null; enabled: boolean };
  missingMigrations: string[];
  approvedQueue: { queued: number; heldReason: string | null; heldSince: Date | null };
}

export interface HealthRules {
  cronStaleMinutes: number;
  jobFailStreak: number;
  channelFailStreak: number;
  backupMaxAgeHours: number;
  aiBudgetWarnPct: number;
  queueHeldHours: number;
}

export const DEFAULT_HEALTH_RULES: HealthRules = { cronStaleMinutes: 10, jobFailStreak: 3, channelFailStreak: 3, backupMaxAgeHours: 30, aiBudgetWarnPct: 90, queueHeldHours: 2 };

export type AiFailureKind = "quota" | "auth" | "rate_limited" | "transient" | "other";
export function aiFailureKind(error: string): AiFailureKind {
  const e = error.toLowerCase();
  if (/insufficient_quota|quota|billing|credit|balance|exceeded your current/.test(e)) return "quota";
  if (/http 429|rate.?limit|too many requests/.test(e)) return "rate_limited";
  if (/http 40[13]|invalid.?api.?key|unauthori[sz]ed|permission|incorrect api key/.test(e)) return "auth";
  if (/http 5\d\d|timeout|timed out|aborted|fetch failed|econnreset|socket|overloaded/.test(e)) return "transient";
  return "other";
}

const PROVIDER_BILLING: Record<string, string> = {
  openai: "platform.openai.com → Settings → Billing",
  anthropic: "console.anthropic.com → Plans & Billing",
  gemini: "aistudio.google.com → your project's billing",
};
const providerName = (p: string) => ({ openai: "OpenAI", anthropic: "Anthropic (Claude)", gemini: "Google Gemini" })[p] ?? p;

const ago = (from: Date, now: Date) => {
  const m = Math.round((+now - +from) / 60_000);
  return m < 1 ? "under a minute" : m < 90 ? `${m} min` : m < 48 * 60 ? `${Math.round(m / 60)} hours` : `${Math.round(m / 1440)} days`;
};

/** A remedy for a failing job, picked from its error. */
export function jobRemedy(error: string): string {
  const e = error.toLowerCase();
  if (/prisma|database|neon|econnrefused|connect|p1001|p2024|connection|too many clients|timeout/.test(e))
    return "Looks like a database connection problem. Check the Neon console (is the project suspended, over its compute limit, or the password changed?) and that DATABASE_URL in Setup Node.js App is correct, then restart the app.";
  if (/stripe|api key|permission/.test(e)) return "Looks like a Stripe problem. Check the key's permissions in Stripe → Developers → API keys (see the Stripe check below if one is listed).";
  if (/memory|heap|cagefs|fork|resource/.test(e)) return "The hosting account hit a resource limit. Check cPanel → Resource Usage, then restart the app in Setup Node.js App.";
  if (/column|relation .* does not exist|does not exist|migration/.test(e)) return "The database is missing an update. Run the newest update SQL from the last release in Neon's SQL Editor.";
  return "Open Admin → System health for the full error. If it keeps failing after a restart of the app, send it to your developer.";
}

export function evaluateHealth(f: HealthFacts, r: HealthRules = DEFAULT_HEALTH_RULES): HealthIssue[] {
  const out: HealthIssue[] = [];
  const now = f.now;

  // Background jobs (cron).
  if (!f.lastTickAt || +now - +f.lastTickAt > r.cronStaleMinutes * 60_000) {
    out.push({
      key: "cron",
      severity: "critical",
      title: f.lastTickAt ? `Background jobs stopped ${ago(f.lastTickAt, now)} ago` : "Background jobs have never run",
      detail: "Offers, reminders, payouts, emails from the growth system and backups all run on the once-a-minute background tick. None of them run until it's back.",
      remedy: "cPanel → Cron Jobs: make sure the once-a-minute job calling /api/cron is there and not commented out (no # in front), and that CRON_SECRET in Setup Node.js App matches the one in the cron command. If the site itself is down or slow, check cPanel → Resource Usage and restart the app.",
      link: "/admin/health",
    });
  }
  for (const j of f.jobs) {
    if (j.failStreak < r.jobFailStreak) continue;
    out.push({
      key: `job:${j.name}`,
      severity: j.critical ? "critical" : "warning",
      title: `Job "${j.name}" is failing (${j.failStreak} runs in a row)`,
      detail: `Last error${j.lastErrorAt ? ` (${ago(j.lastErrorAt, now)} ago)` : ""}: ${(j.lastError ?? "unknown").slice(0, 400)}${j.lastOkAt ? ` · last success ${ago(j.lastOkAt, now)} ago` : " · no success recorded"}`,
      remedy: jobRemedy(j.lastError ?? ""),
      link: "/admin/health",
    });
  }

  // Email and texts.
  if (f.email && f.email.failStreak >= r.channelFailStreak) {
    out.push({
      key: "email",
      severity: "critical",
      title: `Emails are not being sent (${f.email.failStreak} failures in a row)`,
      detail: `Last error: ${(f.email.lastError ?? "unknown").slice(0, 400)}${f.email.lastOkAt ? ` · last email sent ${ago(f.email.lastOkAt, now)} ago` : ""}. Signup confirmations, booking emails and these alerts may not arrive.`,
      remedy: "Log in to SendGrid: check the account isn't suspended or over its plan's limit, that the sender (the From address) is still verified, and that the API key still exists. If you created a new key, update SENDGRID_API_KEY in Setup Node.js App and restart.",
    });
  }
  if (f.sms && f.sms.failStreak >= r.channelFailStreak) {
    out.push({
      key: "sms",
      severity: "warning",
      title: `Text messages are failing (${f.sms.failStreak} in a row)`,
      detail: `Last error: ${(f.sms.lastError ?? "unknown").slice(0, 400)}. Texts fall back to email where they can.`,
      remedy: "Log in to Twilio: check the balance (add funds or turn on auto-recharge), that the sending number or messaging service is active, and that A2P 10DLC registration is approved.",
    });
  }

  // AI.
  const byProvider = new Map<string, { kind: AiFailureKind; error: string; at: Date }>();
  for (const e of f.aiErrors) {
    const kind = aiFailureKind(e.error);
    if ((kind === "quota" || kind === "auth") && !byProvider.has(e.provider)) byProvider.set(e.provider, { kind, error: e.error, at: e.at });
  }
  for (const [p, e] of byProvider) {
    out.push({
      key: `ai:${p}:${e.kind}`,
      severity: "warning",
      title: e.kind === "quota" ? `${providerName(p)}: AI credits exhausted` : `${providerName(p)}: AI key rejected`,
      detail: `Last error ${ago(e.at, now)} ago: ${e.error.slice(0, 300)}. Prospecting research, outreach drafts, blog drafts and the AI message checks that use ${providerName(p)} are paused or falling back.`,
      remedy: e.kind === "quota"
        ? `Add credits or raise the spending limit at ${PROVIDER_BILLING[p] ?? "the provider's billing page"}. Research resumes automatically; Growth → Prospecting → "Resume now" restarts it right away.`
        : `The API key was rejected. Create a new key with ${providerName(p)} and update it in Setup Node.js App (${p === "openai" ? "OPENAI_API_KEY" : p === "anthropic" ? "ANTHROPIC_API_KEY" : "GEMINI_API_KEY"}), then restart the app.`,
      link: "/admin/growth/prospects",
    });
  }
  const capHit = (pct: number) => pct >= 100;
  if (capHit(f.aiBudget.dayPct) || capHit(f.aiBudget.monthPct)) {
    out.push({
      key: `ai:budget:${capHit(f.aiBudget.monthPct) ? "month" : "day"}`,
      severity: "warning",
      title: capHit(f.aiBudget.monthPct) ? "AI monthly budget used up" : "AI daily budget used up",
      detail: `The platform's own AI spending cap is reached (today ${Math.round(f.aiBudget.dayPct)}%, this month ${Math.round(f.aiBudget.monthPct)}%). AI drafting stops until it resets.`,
      remedy: "Nothing is broken; this is your own safety cap. Raise it in Admin → Settings → Growth (AI daily / monthly budget) if you want more, or let it reset.",
      link: "/admin/settings",
    });
  } else if (f.aiBudget.dayPct >= r.aiBudgetWarnPct || f.aiBudget.monthPct >= r.aiBudgetWarnPct) {
    out.push({
      key: "ai:budget:near",
      severity: "warning",
      title: "AI budget almost used up",
      detail: `Today ${Math.round(f.aiBudget.dayPct)}%, this month ${Math.round(f.aiBudget.monthPct)}% of your AI spending caps.`,
      remedy: "Raise the caps in Admin → Settings → Growth if needed; otherwise AI drafting pauses when they're reached.",
      link: "/admin/settings",
    });
  }
  if (f.researchPause && (f.researchPause.reason === "quota" || f.researchPause.reason === "auth") && !out.some((i) => i.key.startsWith("ai:") && !i.key.startsWith("ai:budget"))) {
    out.push({
      key: `research:${f.researchPause.reason}`,
      severity: "warning",
      title: f.researchPause.reason === "quota" ? "Prospecting research paused: AI credits exhausted" : "Prospecting research paused: AI key rejected",
      detail: f.researchPause.error.slice(0, 300),
      remedy: f.researchPause.reason === "quota" ? "Add credits with the research AI provider (Growth → Settings shows which), then Growth → Prospecting → Resume now." : "Replace the research provider's API key in Setup Node.js App and restart, then Resume now.",
      link: "/admin/growth/prospects",
    });
  }

  // Stripe.
  const config = f.stripeFailures.filter((s) => /permission|api key|authenticat|platform profile|not.*enabled|connect|restricted key|account.*(disabled|rejected)/i.test(s.reason));
  if (config.length) {
    const s = config[0];
    out.push({
      key: "stripe:config",
      severity: "critical",
      title: "Stripe is refusing requests (setup or permission problem)",
      detail: `${config.length} failure(s); latest ${ago(s.at, now)} ago: ${s.reason.slice(0, 400)}`,
      remedy: "Stripe's message usually names the fix: a key permission to turn on (Developers → API keys → edit the restricted key, \"In your account\" column), a Connect setting, or an account notice on the Stripe home page. Fix it, then retry the payment or payout from Admin.",
      link: "/admin/payments",
    });
  }
  const balance = f.stripeFailures.filter((s) => s.kind === "transfer" && /insufficient|balance|funds/i.test(s.reason));
  if (balance.length) {
    out.push({
      key: "stripe:balance",
      severity: "critical",
      title: "Provider payouts failing: not enough in the Stripe balance",
      detail: `${balance.length} provider transfer(s) failed; latest ${ago(balance[0].at, now)} ago: ${balance[0].reason.slice(0, 300)}`,
      remedy: "Clinic payments need to settle before providers can be paid from them. Check Stripe → Balance; if bonuses or adjustments are paid from the platform balance, add funds (Balance → Add to balance). Failed payouts retry automatically.",
      link: "/admin/payouts",
    });
  }

  // Backups.
  if (f.backups.enabled) {
    if (!f.backups.lastOkAt || +now - +f.backups.lastOkAt > r.backupMaxAgeHours * 3_600_000) {
      out.push({
        key: "backups",
        severity: "warning",
        title: f.backups.lastOkAt ? `No successful backup in ${ago(f.backups.lastOkAt, now)}` : "No successful backup yet",
        detail: f.backups.lastFailure ? `Last failure ${ago(f.backups.lastFailure.at, now)} ago: ${f.backups.lastFailure.error.slice(0, 300)}` : "The nightly backup runs at 3:10 AM Eastern.",
        remedy: "Admin → Backups & restore → Back up now. If it fails, the error there names the cause (storage folder permissions, or the database connection).",
        link: "/admin/backups",
      });
    }
  }

  // Database updates.
  if (f.missingMigrations.length) {
    out.push({
      key: "db:migrations",
      severity: "critical",
      title: "Database update needed",
      detail: `The installed app expects database updates that haven't been run: ${f.missingMigrations.join(", ")}. Some pages and jobs will fail until they are.`,
      remedy: "Run the update SQL file(s) that came with the latest release in Neon's SQL Editor, in number order. They're safe to run twice.",
    });
  }

  // Approved outreach that can't go out.
  if (f.approvedQueue.queued && f.approvedQueue.heldSince && +now - +f.approvedQueue.heldSince > r.queueHeldHours * 3_600_000) {
    out.push({
      key: "growth:queue",
      severity: "warning",
      title: `${f.approvedQueue.queued} approved outreach email(s) stuck`,
      detail: `Held for ${ago(f.approvedQueue.heldSince, now)}: ${f.approvedQueue.heldReason ?? "unknown reason"}.`,
      remedy: "Usually Growth's own pause switch, daily send cap or quiet hours. Check Growth → Settings; they send automatically once it clears.",
      link: "/admin/growth/approvals",
    });
  }

  return out.sort((a, b) => (a.severity === b.severity ? 0 : a.severity === "critical" ? -1 : 1));
}

/**
 * Alert bookkeeping: which issues to email now. New issues alert at once;
 * ongoing ones repeat every `repeatHours`; cleared ones get one "resolved" note.
 */
export interface AlertState { [key: string]: { since: string; lastAlertAt: string; title: string; severity: Severity } }
export function planAlerts(issues: HealthIssue[], prev: AlertState, now: Date, repeatHours: number) {
  const next: AlertState = {};
  const fresh: HealthIssue[] = [], repeat: HealthIssue[] = [];
  for (const i of issues) {
    const p = prev[i.key];
    if (!p) {
      fresh.push(i);
      next[i.key] = { since: now.toISOString(), lastAlertAt: now.toISOString(), title: i.title, severity: i.severity };
    } else if (+now - +new Date(p.lastAlertAt) >= repeatHours * 3_600_000) {
      repeat.push(i);
      next[i.key] = { ...p, lastAlertAt: now.toISOString(), title: i.title, severity: i.severity };
    } else {
      next[i.key] = { ...p, title: i.title, severity: i.severity };
    }
  }
  const resolved = Object.entries(prev).filter(([k]) => !next[k]).map(([key, v]) => ({ key, title: v.title, since: new Date(v.since) }));
  return { next, fresh, repeat, resolved };
}
