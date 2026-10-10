import { z } from "zod";
import { brand } from "@cm/config";
import { announcementProblems, DomainError, type AnnouncementChannel, type AnnouncementKind } from "@cm/core";
import { prisma } from "@cm/db";
import { audit, clock, getSettings, requireAdmin, type Actor } from "./context";
import { absoluteUrl, notify, sendEmail } from "./notify";

/**
 * Admin → Announcements: one message to all providers, all clinics, or everyone, optionally narrowed by
 * state, profession and (providers) status. Rules in core/announcements.ts (NOTICE vs NEWS). Sending is a
 * background job (announcementSweep, every minute, a batch per tick) so large lists never time out;
 * DigestSend announce:<id>:<userId> makes delivery once per person. Admin and turned-off logins and
 * banned emails are never included. NEWS emails carry an unsubscribe link (the Growth unsubscribe, which
 * suppresses the address) and the postal address, and unsubscribed addresses are skipped.
 */

export const AudienceInput = z.object({
  audience: z.enum(["PROVIDERS", "CLINICS", "EVERYONE"]),
  /** Providers only: ALL | READY (active, matched to shifts) | ONBOARDING (still setting up). */
  providerStatus: z.enum(["ALL", "READY", "ONBOARDING"]).default("ALL"),
  /** Providers: licensed or living there; clinics: a location there. */
  state: z.string().trim().toUpperCase().length(2).nullable().optional(),
  professionCode: z.string().trim().min(1).nullable().optional(),
  /** Clinics: only owners (not office staff logins). */
  ownersOnly: z.boolean().default(false),
});
export type AudienceT = z.infer<typeof AudienceInput>;

export const AnnouncementInput = z.object({
  kind: z.enum(["NOTICE", "NEWS"]),
  title: z.string().trim().max(120),
  body: z.string().trim().max(5000),
  linkPath: z.string().trim().max(300).nullable().optional(),
  ctaLabel: z.string().trim().max(40).nullable().optional(),
  channels: z.array(z.enum(["email", "sms", "push"])).default(["email", "push"]),
  audience: AudienceInput,
});

export interface Recipient {
  userId: string;
  email: string;
  type: "PROVIDER" | "CLINIC";
  /** Provider.id or ClinicOrg.id (for the unsubscribe link). */
  entityId: string;
}

export async function recipientsFor(raw: z.input<typeof AudienceInput>): Promise<Recipient[]> {
  const a = AudienceInput.parse(raw);
  const out = new Map<string, Recipient>();
  if (a.audience !== "CLINICS") {
    const providers = await prisma.provider.findMany({
      where: {
        // Any login with a provider profile (a clinic owner who also takes shifts counts too).
        user: { disabledAt: null, role: { not: "PLATFORM_ADMIN" } },
        status: a.providerStatus === "READY" ? "ACTIVE" : a.providerStatus === "ONBOARDING" ? "ONBOARDING" : { not: "DEACTIVATED" },
        ...(a.state ? { OR: [{ homeState: a.state }, { licenses: { some: { state: a.state, status: { not: "REJECTED" } } } }] } : {}),
        ...(a.professionCode ? { professions: { some: { professionCode: a.professionCode } } } : {}),
      },
      select: { id: true, userId: true, user: { select: { email: true } } },
      orderBy: { userId: "asc" },
    });
    for (const p of providers) out.set(p.userId, { userId: p.userId, email: p.user.email, type: "PROVIDER", entityId: p.id });
  }
  if (a.audience !== "PROVIDERS") {
    const members = await prisma.clinicMember.findMany({
      where: {
        user: { disabledAt: null },
        ...(a.ownersOnly ? { role: "CLINIC_OWNER" } : {}),
        clinicOrg: {
          status: { not: "DEACTIVATED" },
          ...(a.state || a.professionCode ? { locations: { some: { active: true, ...(a.state ? { state: a.state } : {}), ...(a.professionCode ? { professionCodes: { has: a.professionCode } } : {}) } } } : {}),
        },
      },
      select: { userId: true, clinicOrgId: true, user: { select: { email: true, role: true } } },
      orderBy: { userId: "asc" },
    });
    for (const m of members) if (m.user.role !== "PLATFORM_ADMIN" && !out.has(m.userId)) out.set(m.userId, { userId: m.userId, email: m.user.email, type: "CLINIC", entityId: m.clinicOrgId });
  }
  const banned = new Set((await prisma.bannedEmail.findMany({ where: { email: { in: [...out.values()].map((r) => r.email) } }, select: { email: true } })).map((b) => b.email.toLowerCase()));
  return [...out.values()].filter((r) => !banned.has(r.email.toLowerCase())).sort((x, y) => x.userId.localeCompare(y.userId));
}

/** How many people it would reach, before sending. */
export async function previewAudience(actor: Actor, raw: z.input<typeof AudienceInput>) {
  requireAdmin(actor);
  const r = await recipientsFor(raw);
  return { total: r.length, providers: r.filter((x) => x.type === "PROVIDER").length, clinicLogins: r.filter((x) => x.type === "CLINIC").length };
}

function parse(raw: z.input<typeof AnnouncementInput>) {
  const a = AnnouncementInput.parse(raw);
  const problems = announcementProblems({ kind: a.kind, title: a.title, body: a.body, channels: a.channels, linkPath: a.linkPath ?? null });
  if (problems.length) throw new DomainError("VALIDATION", problems[0]);
  return a;
}

async function deliver(a: { id: string | null; kind: string; title: string; body: string; linkPath: string | null; ctaLabel: string | null; channels: string[] }, r: Recipient) {
  const s = await getSettings();
  const news = a.kind === "NEWS";
  let emailed = false;
  if (a.channels.includes("email")) {
    const { isSuppressed, unsubscribeUrl } = await import("./growth/engine");
    if (!(news && (await isSuppressed("EMAIL", r.email)))) {
      emailed = await sendEmail(r.email, {
        subject: a.title,
        heading: a.title,
        paragraphs: a.body.split(/\n{2,}/).map((x) => x.trim()).filter(Boolean),
        cta: a.linkPath ? { label: a.ctaLabel || "Open", url: absoluteUrl(a.linkPath) } : undefined,
        ...(news ? { unsubscribeUrl: unsubscribeUrl(r.type, r.entityId), footerNote: `${brand().name} · ${s["growth.postalAddress"]}` } : {}),
      });
    }
  }
  // In-app always; push and text as chosen (text only for notices: core rule).
  await notify(prisma, r.userId, {
    template: news ? "announcement_news" : "announcement",
    title: a.title,
    body: a.body,
    link: a.linkPath ?? undefined,
    ctaLabel: a.ctaLabel ?? undefined,
    email: false,
    emailFallback: false,
    sms: !news && a.channels.includes("sms"),
    push: a.channels.includes("push"),
  });
  return emailed || !a.channels.includes("email");
}

/** Send it to yourself first (your own login, all chosen channels). */
export async function sendTestAnnouncement(actor: Actor, raw: z.input<typeof AnnouncementInput>) {
  requireAdmin(actor);
  const a = parse(raw);
  const me = await prisma.user.findUniqueOrThrow({ where: { id: actor.userId! } });
  await deliver({ id: null, kind: a.kind, title: `[Test] ${a.title}`, body: a.body, linkPath: a.linkPath ?? null, ctaLabel: a.ctaLabel ?? null, channels: a.channels }, { userId: me.id, email: me.email, type: "PROVIDER", entityId: me.id });
  return me.email;
}

/** Queue it; the job sends it in batches. */
export async function createAnnouncement(actor: Actor, raw: z.input<typeof AnnouncementInput>) {
  requireAdmin(actor);
  const a = parse(raw);
  const recipients = await recipientsFor(a.audience);
  if (!recipients.length) throw new DomainError("VALIDATION", "Nobody matches that audience.");
  const row = await prisma.announcement.create({
    data: { kind: a.kind, title: a.title, body: a.body, linkPath: a.linkPath || null, ctaLabel: a.ctaLabel || null, channels: a.channels, audience: a.audience, recipientCount: recipients.length, createdById: actor.userId },
  });
  await audit(prisma, actor, "announcement.created", "Announcement", row.id, null, { kind: a.kind, audience: a.audience, recipients: recipients.length, channels: a.channels });
  return row;
}

export async function cancelAnnouncement(actor: Actor, id: string) {
  requireAdmin(actor);
  const r = await prisma.announcement.updateMany({ where: { id, status: { in: ["QUEUED", "SENDING"] } }, data: { status: "CANCELLED", finishedAt: clock.now() } });
  await audit(prisma, actor, "announcement.cancelled", "Announcement", id);
  return r.count > 0;
}

export async function listAnnouncements(actor: Actor) {
  requireAdmin(actor);
  return prisma.announcement.findMany({ orderBy: { createdAt: "desc" }, take: 100 });
}

/** Background sender: up to `batch` people per tick across queued announcements, oldest first. */
export async function announcementSweep(batch = 60) {
  let budget = batch;
  const out = { sent: 0, skipped: 0, finished: 0 };
  const queue = await prisma.announcement.findMany({ where: { status: { in: ["QUEUED", "SENDING"] } }, orderBy: { createdAt: "asc" } });
  for (const a of queue) {
    if (budget <= 0) break;
    if (a.status === "QUEUED") await prisma.announcement.update({ where: { id: a.id }, data: { status: "SENDING", startedAt: clock.now() } });
    const all = await recipientsFor(a.audience as z.input<typeof AudienceInput>);
    const done = new Set(
      (await prisma.digestSend.findMany({ where: { key: { startsWith: `announce:${a.id}:` } }, select: { key: true } })).map((d) => d.key.slice(`announce:${a.id}:`.length)),
    );
    const todo = all.filter((r) => !done.has(r.userId));
    let handled = 0;
    for (const r of todo) {
      if (budget <= 0) break;
      // Claim first, so two overlapping runs can't send twice.
      const claimed = await prisma.digestSend.createMany({ data: [{ key: `announce:${a.id}:${r.userId}`, userId: r.userId }], skipDuplicates: true });
      handled++;
      if (!claimed.count) continue;
      budget--;
      const ok = await deliver({ id: a.id, kind: a.kind, title: a.title, body: a.body, linkPath: a.linkPath, ctaLabel: a.ctaLabel, channels: a.channels }, r).catch((e) => {
        console.error("announcement delivery failed", e);
        return false;
      });
      await prisma.announcement.update({ where: { id: a.id }, data: ok ? { sentCount: { increment: 1 } } : { skippedCount: { increment: 1 } } });
      if (ok) out.sent++;
      else out.skipped++;
    }
    if (handled >= todo.length) {
      await prisma.announcement.updateMany({ where: { id: a.id, status: "SENDING" }, data: { status: "DONE", finishedAt: clock.now() } });
      out.finished++;
    }
  }
  return out;
}
