import { DomainError, emailDomain, spamScore, submittedTooFast, type SpamCategory } from "@cm/core";
import { prisma } from "@cm/db";
import { emailVerifier, humanVerifier } from "@cm/integrations";
import { audit, clock, getSettings, requireAdmin, type Actor } from "./context";

/**
 * Spam management for public forms (Ask a question, lead / contact / waitlist forms, signups).
 *  1. checkHuman: hidden honeypot field, too-fast submits (bots, quietly dropped) and Cloudflare
 *     Turnstile when TURNSTILE_SECRET_KEY is set (a failed check asks the person to retry).
 *  2. assessSender: the blocked-sender list, core spamScore and an MX check on the email domain.
 *     At or over spam.threshold the message is filed in the Spam folder: no notification, no reply,
 *     no promo code or emails. Signups are only flagged in the admin email, never blocked.
 *  3. The question-answering AI can also file sales pitches (agents.answerQuestion, spam.aiCheck).
 * Spam is kept spam.retentionDays, then deleted (job spamCleanup). Nothing else is ever deleted.
 */

export interface FormGuard {
  /** Turnstile token (cf-turnstile-response). */
  token?: string | null;
  /** Hidden "website" field: people never see it, bots fill it in. */
  honeypot?: string | null;
  /** Browser time (ms) when the form was shown. */
  startedAt?: number | string | null;
  ip?: string | null;
}

export const HUMAN_CHECK_FAILED = "Please complete the “verify you're human” check, then try again.";

/** "bot" = drop quietly (don't tell bots what tripped them). Throws when Turnstile fails. */
export async function checkHuman(g: FormGuard): Promise<"ok" | "bot"> {
  const s = await getSettings();
  if ((g.honeypot ?? "").trim()) return "bot";
  const started = g.startedAt == null || g.startedAt === "" ? null : Number(g.startedAt);
  if (submittedTooFast(started, clock.now().getTime(), s["spam.minSubmitSeconds"])) return "bot";
  const v = await humanVerifier().verify(g.token ?? null, g.ip ?? null);
  if (!v.ok) throw new DomainError("VALIDATION", HUMAN_CHECK_FAILED);
  return "ok";
}

/**
 * The Turnstile check alone, plus the hidden honeypot when given (no too-fast rule: sign-in and
 * reset forms are often filled instantly by password managers). Throws when the check fails.
 */
export async function requireHuman(g: FormGuard): Promise<void> {
  if ((g.honeypot ?? "").trim()) throw new DomainError("VALIDATION", HUMAN_CHECK_FAILED);
  const v = await humanVerifier().verify(g.token ?? null, g.ip ?? null);
  if (!v.ok) throw new DomainError("VALIDATION", HUMAN_CHECK_FAILED);
}

export interface SpamVerdict {
  /** null = not spam. */
  category: SpamCategory | null;
  score: number;
  reasons: string[];
}

export async function blockedSenderFor(email: string | null | undefined) {
  const addr = (email ?? "").trim().toLowerCase();
  if (!addr) return null;
  return prisma.blockedSender.findFirst({ where: { value: { in: [addr, emailDomain(addr)].filter(Boolean) } } });
}

export async function assessSender(i: { name?: string | null; email?: string | null; text?: string | null }, opts: { checkMx?: boolean } = {}): Promise<SpamVerdict> {
  const s = await getSettings();
  if (!s["spam.enabled"]) return { category: null, score: 0, reasons: [] };
  const blocked = await blockedSenderFor(i.email);
  if (blocked) return { category: "spam", score: 100, reasons: [blocked.kind === "DOMAIN" ? `blocked domain ${blocked.value}` : "blocked sender"] };
  const r = spamScore(i);
  let score = r.score;
  const reasons = [...r.reasons];
  if (score < s["spam.threshold"] && s["spam.checkEmailDomain"] && opts.checkMx !== false && i.email) {
    const mx = await emailVerifier().verify(i.email);
    if (mx.check === "no_mx" || mx.check === "invalid") (score = Math.min(100, score + 60)), reasons.push("email domain can't receive mail");
  }
  return { category: score >= s["spam.threshold"] ? r.kind : null, score, reasons };
}

/** A website question filed straight into the Spam folder (resolved, so no badge or email). */
export async function fileSpamQuestion(q: { name: string; email: string; question: string; category: SpamCategory; reasons: string[]; via: "rules" | "ai" }) {
  return prisma.escalation.create({
    data: {
      entityType: "QUESTION",
      entityId: null,
      entityLabel: `${q.name} <${q.email.trim().toLowerCase()}>`.slice(0, 255),
      reasonCode: "spam",
      reason: q.via === "ai" ? "Filed as spam by the question-answering AI." : "Filed as spam by the spam rules.",
      summary: q.question.slice(0, 4000),
      status: "RESOLVED",
      resolution: "Spam",
      resolvedAt: clock.now(),
      spamCategory: q.category,
      spamReasons: q.reasons.slice(0, 10),
    },
  });
}

const emailFromLabel = (label: string) => /<([^>]+@[^>]+)>/.exec(label)?.[1]?.trim().toLowerCase() ?? null;

export async function blockSender(actor: Actor, raw: string, kind: "EMAIL" | "DOMAIN", reason?: string | null) {
  requireAdmin(actor);
  const v = raw.trim().toLowerCase().replace(/^@/, "");
  const value = kind === "DOMAIN" ? (v.includes("@") ? emailDomain(v) : v) : v;
  if (kind === "EMAIL" && !/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value)) throw new DomainError("VALIDATION", "Enter a full email address.");
  if (kind === "DOMAIN" && !/^[a-z0-9.-]+\.[a-z]{2,}$/.test(value)) throw new DomainError("VALIDATION", "Enter a domain like example.com.");
  if (kind === "DOMAIN" && /^(gmail|googlemail|yahoo|outlook|hotmail|live|icloud|me|aol|msn|comcast|att|proton|protonmail)\./.test(value)) {
    throw new DomainError("VALIDATION", `${value} is a public email provider; block the person's address instead.`);
  }
  const row = await prisma.blockedSender.upsert({ where: { value }, create: { kind, value, reason: reason?.slice(0, 300) || null, createdById: actor.userId }, update: { kind, reason: reason?.slice(0, 300) || undefined } });
  await audit(prisma, actor, "spam.block_sender", "BlockedSender", row.id, null, { kind, value });
  return row;
}

export async function unblockSender(actor: Actor, id: string) {
  requireAdmin(actor);
  const row = await prisma.blockedSender.delete({ where: { id } });
  await audit(prisma, actor, "spam.unblock_sender", "BlockedSender", id, { kind: row.kind, value: row.value }, null);
}

export async function blockedSenders(actor: Actor) {
  requireAdmin(actor);
  return prisma.blockedSender.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
}

/** Admin: move a conversation into or out of the Spam folder, optionally blocking its sender. */
export async function setEscalationSpam(actor: Actor, id: string, spam: boolean, block: "EMAIL" | "DOMAIN" | null = null) {
  requireAdmin(actor);
  const e = await prisma.escalation.findUniqueOrThrow({ where: { id } });
  if (spam) {
    await prisma.escalation.update({ where: { id }, data: { spamCategory: e.spamCategory ?? "spam", status: "RESOLVED", resolution: "Spam", resolvedById: actor.userId, resolvedAt: clock.now() } });
    const email = emailFromLabel(e.entityLabel);
    if (block && email) await blockSender(actor, email, block, `From conversation: ${e.entityLabel}`);
  } else {
    await prisma.escalation.update({ where: { id }, data: { spamCategory: null, spamReasons: [], status: "OPEN", resolution: null, resolvedById: null, resolvedAt: null } });
  }
  await audit(prisma, actor, spam ? "spam.mark" : "spam.unmark", "Escalation", id, null, { block });
}

/** Job: delete spam older than spam.retentionDays. */
export async function purgeSpam(now = clock.now()) {
  const s = await getSettings();
  const before = new Date(+now - s["spam.retentionDays"] * 86_400_000);
  const [escalations, leads] = await Promise.all([
    prisma.escalation.deleteMany({ where: { spamCategory: { not: null }, createdAt: { lt: before } } }),
    prisma.lead.deleteMany({ where: { spamCategory: { not: null }, createdAt: { lt: before } } }),
  ]);
  return { escalations: escalations.count, leads: leads.count };
}

/** Counts for the weekly briefing and the Spam folder header. */
export async function spamCounts(since: Date) {
  const [questions, leads] = await Promise.all([
    prisma.escalation.count({ where: { spamCategory: { not: null }, createdAt: { gte: since } } }),
    prisma.lead.count({ where: { spamCategory: { not: null }, createdAt: { gte: since } } }),
  ]);
  return { questions, leads, total: questions + leads };
}
