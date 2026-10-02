import { randomBytes } from "node:crypto";
import { z } from "zod";
import { brand } from "@cm/config";
import { DomainError, promoLabel } from "@cm/core";
import { prisma, type Lead, type LeadStatus, type PromoCode } from "@cm/db";
import { audit, getSettings, requireAdmin, type Actor } from "./context";
import { absoluteUrl, sendEmail, type EmailContent } from "./notify";
import { activeCampaign, codeStillGood, issuePersonalCode, issueWelcomeCode } from "./promo";
import { track } from "./analytics";
import { assessSender, checkHuman } from "./spam";

/**
 * Lead management. Sources:
 *   popup     clinic welcome offer (X% off first shift, personal code)
 *   landing   campaign landing page (/offer/CODE → personal copy of that code)
 *   waitlist  "coming soon" profession pages (profession + state)
 *   contact   contact form
 *   manual    added by an admin
 * Each lead gets a follow-up email sequence (leads.dripScheduleDays) that
 * stops when they sign up, convert, unsubscribe, or the code expires.
 * One active sequence per email: a newer signup supersedes older ones.
 */

export const CaptureInput = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  phone: z.string().trim().max(30).optional().nullable(),
  organization: z.string().trim().max(160).optional().nullable(),
  state: z.string().trim().toUpperCase().length(2).optional().nullable(),
  professionCode: z.string().trim().toUpperCase().max(10).optional().nullable(),
  message: z.string().trim().max(2000).optional().nullable(),
  source: z.enum(["popup", "landing", "waitlist", "contact"]),
  audience: z.enum(["CLINIC", "PROVIDER"]).default("CLINIC"),
  campaign: z.string().trim().max(60).optional().nullable(),
  utm: z.object({ source: z.string().max(100).optional(), medium: z.string().max(100).optional(), campaign: z.string().max(100).optional() }).partial().optional(),
  landingPath: z.string().max(300).optional().nullable(),
  visitorId: z.string().max(64).optional().nullable(),
  /** Spam guard: hidden honeypot field, form-shown time, Turnstile token. */
  website: z.string().max(500).optional().nullable(),
  startedAt: z.union([z.number(), z.string()]).optional().nullable(),
  turnstileToken: z.string().max(4000).optional().nullable(),
});

/** What a filtered submission sees: the same thank-you as everyone, no code. */
const QUIET = { leadId: null, code: null, offer: null, expiresAt: null, alreadySignedUp: false, dripDays: 0 };

export async function captureLead(raw: z.input<typeof CaptureInput>, meta: { ip?: string; skipSpamCheck?: boolean } = {}) {
  const input = CaptureInput.parse(raw);
  const s = await getSettings();
  if (meta.ip && (await checkHuman({ token: input.turnstileToken, honeypot: input.website, startedAt: input.startedAt, ip: meta.ip })) === "bot") return QUIET;
  const verdict = meta.skipSpamCheck ? { category: null, score: 0, reasons: [] } : await assessSender({ name: input.name, email: input.email, text: [input.organization, input.message].filter(Boolean).join("\n") });
  if (verdict.category) {
    // Filed in Spam: no code, no emails, no admin notice. Never touches an existing real lead.
    // The key keeps what "Not spam" needs to replay the signup (source + campaign).
    await prisma.lead.create({
      data: {
        audience: input.audience, name: input.name, email: input.email, phone: input.phone || null, organization: input.organization || null, state: input.state || null,
        professionCode: input.professionCode || null, message: input.message || null, source: input.source, campaignCode: `SPAM:${input.source}:${input.campaign ?? ""}:${Date.now()}${randomBytes(3).toString("hex")}`, status: "LOST",
        unsubscribeToken: randomBytes(24).toString("hex"), landingPath: input.landingPath ?? null, spamCategory: verdict.category, spamReasons: verdict.reasons.slice(0, 10),
        activities: { create: { kind: "CAPTURED", body: `Filed as spam (score ${verdict.score}): ${verdict.reasons.join(", ")}` } },
      },
    });
    return QUIET;
  }
  let campaign: PromoCode | null = null;
  let campaignCode = "";
  if (input.source === "landing") {
    campaign = await activeCampaign(prisma, input.campaign ?? "");
    if (!campaign) throw new DomainError("VALIDATION", "Sorry — this offer has ended.");
    campaignCode = campaign.code;
  } else if (input.source === "waitlist") {
    campaignCode = `WAITLIST:${input.professionCode ?? "ANY"}`;
  } else if (input.source === "contact") {
    campaignCode = `CONTACT:${Date.now()}`;
  }
  const audience = campaign ? campaign.landingAudience : input.audience;
  const wantsCode = audience === "CLINIC" && (input.source === "popup" || (input.source === "landing" && campaign));
  const issue = async () => (campaign ? issuePersonalCode(prisma, campaign, input.email) : input.source === "popup" ? issueWelcomeCode(prisma, input.email) : null);

  let lead = await prisma.lead.findUnique({ where: { email_campaignCode: { email: input.email, campaignCode } } });
  let promo: PromoCode | null = null;
  let alreadySignedUp = false;
  if (lead) {
    if (lead.status === "CONVERTED" && wantsCode) {
      throw new DomainError("VALIDATION", campaign ? "You've already redeemed this offer — thanks!" : "The welcome offer is for a clinic's first shift only.");
    }
    promo = lead.promoCode ? await prisma.promoCode.findUnique({ where: { code: lead.promoCode } }) : null;
    if (wantsCode && !codeStillGood(promo)) promo = await issue();
    alreadySignedUp = true;
    lead = await prisma.lead.update({
      where: { id: lead.id },
      data: {
        name: input.name,
        status: lead.status === "UNSUBSCRIBED" || lead.status === "EXPIRED" || lead.status === "SUPERSEDED" ? "NURTURING" : lead.status,
        unsubscribedAt: null,
        promoCode: promo?.code ?? lead.promoCode,
        ...(promo && promo.code !== lead.promoCode ? { dripStep: 0, nextDripAt: new Date() } : {}),
      },
    });
  } else {
    promo = wantsCode ? await issue() : null;
    lead = await prisma.lead.create({
      data: {
        audience,
        name: input.name,
        email: input.email,
        phone: input.phone || null,
        organization: input.organization || null,
        state: input.state || null,
        professionCode: input.professionCode || null,
        message: input.message || null,
        source: input.source,
        campaignCode,
        promoCode: promo?.code ?? null,
        status: input.source === "contact" ? "NEW" : "NURTURING",
        nextDripAt: input.source === "contact" ? null : new Date(),
        unsubscribeToken: randomBytes(24).toString("hex"),
        utmSource: input.utm?.source ?? null,
        utmMedium: input.utm?.medium ?? null,
        utmCampaign: input.utm?.campaign ?? null,
        landingPath: input.landingPath ?? null,
      },
    });
    await prisma.leadActivity.create({ data: { leadId: lead.id, kind: "CAPTURED", body: `Captured from ${input.source}${campaignCode ? ` (${campaignCode})` : ""}` } });
  }
  // Only one follow-up sequence per person.
  await prisma.lead.updateMany({ where: { email: input.email, id: { not: lead.id }, status: "NURTURING" }, data: { status: "SUPERSEDED", nextDripAt: null } });
  await track({ type: "LEAD_CAPTURED", visitorId: input.visitorId ?? null, path: input.landingPath ?? null, props: { source: input.source, campaign: campaignCode, audience } });

  // Waitlist for a state + profession that's already open: send the "we're open" email instead.
  let alreadyOpen = false;
  if (input.source === "waitlist") {
    const { notifyIfOpen } = await import("./waitlist");
    alreadyOpen = await notifyIfOpen(lead.id);
    if (alreadyOpen) lead = await prisma.lead.findUniqueOrThrow({ where: { id: lead.id } });
  }
  // First email goes out immediately (the drip job handles the rest).
  if (lead.status === "NURTURING" && lead.dripStep === 0) await sendDripStep(lead.id);
  if (input.source === "contact") {
    const { notifyAdmins } = await import("./notify");
    await notifyAdmins(prisma, { template: "contact_lead", title: `New inquiry from ${input.name}`, body: (input.message ?? "").slice(0, 300), link: `/admin/leads/${lead.id}` });
  }
  return { leadId: lead.id, code: promo?.code ?? null, offer: promo ? promoLabel(promo) : null, expiresAt: promo?.expiresAt ?? null, alreadySignedUp, alreadyOpen, dripDays: s["leads.dripScheduleDays"].length };
}

// ---------------- follow-up sequence ----------------

function defaultCopy(lead: Lead, promo: PromoCode | null, step: number): { subject: string; intro: string } {
  const b = brand();
  if (lead.source === "waitlist") {
    const copy = [
      { subject: `You're on the ${b.name} waitlist`, intro: `Thanks for your interest${lead.state ? ` in ${lead.state}` : ""}. We'll let you know as soon as we open for your profession in your state.` },
      { subject: `How ${b.name} works`, intro: "Clinics post coverage shifts, licensed providers apply or get matched, and pay runs through the platform — no chasing invoices." },
      { subject: "What to have ready", intro: "When we launch in your area you'll need your state license, malpractice certificate and NPI (if your profession uses one). Getting these together now makes onboarding quick." },
    ];
    return copy[Math.min(step, copy.length - 1)];
  }
  if (lead.audience === "PROVIDER") {
    const copy = [
      { subject: `Pick up coverage shifts with ${b.name}`, intro: "Set your availability, choose how far you'll drive, and get matched to shifts in the states where you're licensed. Pay and mileage are shown up front." },
      { subject: "Your credentials, verified once", intro: "Upload your license and malpractice certificate once. We verify them and you can apply to any matching shift in a tap." },
      { subject: "Get paid within days of each shift", intro: "Payments go straight to your bank through Stripe after each shift — no invoices, no follow-ups." },
    ];
    return copy[Math.min(step, copy.length - 1)];
  }
  const offer = promo ? `${promoLabel(promo)} your first coverage shift with code ${promo.code}` : "";
  const copy = [
    { subject: promo ? `Your code: ${promo.code} — ${promoLabel(promo)}` : `Welcome to ${b.name}`, intro: `Thanks for signing up. ${offer ? `Here's ${offer}.` : ""} Post a shift in about two minutes and we'll match licensed, verified providers near you.` },
    { subject: "Coverage in minutes, not phone calls", intro: "Post the date, we handle licensure checks, matching and payment. You choose from applicants or let us pick the best fit." },
    { subject: "Every provider is license-verified", intro: "Providers only see shifts in states where they hold a verified license for your profession — checked before they can apply and again before every shift." },
    { subject: promo ? `Reminder: ${promo.code} is still waiting` : "Planning time off?", intro: promo ? `Your ${promoLabel(promo)} code is still active. Book coverage for your next vacation or CE weekend.` : "Book coverage for your next vacation or CE weekend in a couple of minutes." },
    { subject: promo ? `Last call: ${promo.code} expires soon` : "Still need coverage?", intro: promo ? "Your code expires soon. Post a shift before then to use it." : "We're here whenever you need coverage." },
  ];
  return copy[Math.min(step, copy.length - 1)];
}

async function sendDripStep(leadId: string): Promise<boolean> {
  const s = await getSettings();
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id: leadId } });
  if (lead.status !== "NURTURING") return false;
  const schedule = s["leads.dripScheduleDays"];
  const promo = lead.promoCode ? await prisma.promoCode.findUnique({ where: { code: lead.promoCode }, include: { parent: true } }) : null;
  if (promo && !codeStillGood(promo)) {
    await prisma.lead.update({ where: { id: lead.id }, data: { status: "EXPIRED", nextDripAt: null } });
    return false;
  }
  const step = lead.dripStep;
  if (step >= schedule.length) {
    await prisma.lead.update({ where: { id: lead.id }, data: { nextDripAt: null } });
    return false;
  }
  const custom = ((promo?.parent?.dripCustom ?? null) as { subject: string; intro: string }[] | null)?.[step];
  const base = defaultCopy(lead, promo, step);
  const subject = custom?.subject || base.subject;
  const intro = custom?.intro || base.intro;
  const unsubscribeUrl = absoluteUrl(`/unsubscribe?token=${lead.unsubscribeToken}`);
  const cta =
    lead.source === "waitlist"
      ? { label: `Visit ${brand().name}`, url: "/" }
      : lead.audience === "PROVIDER"
        ? { label: "Create your provider profile", url: "/signup?role=provider" }
        : { label: promo ? "Post a shift with your code" : "Post a shift", url: `/signup?role=clinic${promo ? `&code=${encodeURIComponent(promo.code)}` : ""}` };
  const content: EmailContent = {
    subject,
    heading: subject,
    paragraphs: [`Hi ${lead.name.split(" ")[0]},`, intro, ...(promo && step === 0 ? [`Your code: ${promo.code} (${promoLabel(promo)}${promo.expiresAt ? `, expires ${promo.expiresAt.toLocaleDateString("en-US")}` : ""}).`] : [])],
    cta,
    unsubscribeUrl,
  };
  const ok = await sendEmail(lead.email, content);
  const nextOffset = schedule[step + 1];
  await prisma.lead.update({
    where: { id: lead.id },
    data: {
      dripStep: step + 1,
      lastDripSentAt: new Date(),
      nextDripAt: nextOffset !== undefined ? new Date(+lead.createdAt + nextOffset * 86_400_000) : null,
    },
  });
  await prisma.leadActivity.create({ data: { leadId: lead.id, kind: "EMAIL_SENT", body: `${ok ? "Sent" : "FAILED"}: ${subject}` } });
  return ok;
}

/** Worker: send every follow-up that's due. */
export async function runLeadDrip(now = new Date()) {
  const due = await prisma.lead.findMany({ where: { status: "NURTURING", nextDripAt: { lte: now } }, select: { id: true }, take: 500 });
  let sent = 0;
  for (const d of due) if (await sendDripStep(d.id)) sent++;
  return { due: due.length, sent };
}

export async function unsubscribe(token: string) {
  const { unsubscribeByToken, suppress } = await import("./growth/engine");
  if (token.startsWith("g.")) return unsubscribeByToken(token);
  const lead = await prisma.lead.findUnique({ where: { unsubscribeToken: token } });
  if (!lead) return false;
  // Growth outreach honors the same opt-out.
  await suppress("EMAIL", lead.email, "UNSUBSCRIBE", "lead unsubscribe link");
  await prisma.lead.updateMany({ where: { email: lead.email, status: { in: ["NURTURING", "NEW", "CONTACTED"] } }, data: { status: "UNSUBSCRIBED", unsubscribedAt: new Date(), nextDripAt: null } });
  await prisma.leadActivity.create({ data: { leadId: lead.id, kind: "STATUS", body: "Unsubscribed via email link" } });
  return true;
}

// ---------------- conversion hooks ----------------

/** A lead's email created an account: stop the sequence, link the user. */
export async function onUserSignup(userId: string, email: string) {
  const leads = await prisma.lead.findMany({ where: { email: email.toLowerCase(), convertedUserId: null, spamCategory: null } });
  for (const l of leads) {
    await prisma.lead.update({ where: { id: l.id }, data: { convertedUserId: userId, status: l.status === "NURTURING" || l.status === "NEW" ? "CONTACTED" : l.status, nextDripAt: null } });
    await prisma.leadActivity.create({ data: { leadId: l.id, kind: "SIGNUP", body: "Created an account" } });
  }
}

/** First confirmed shift (clinic) or activation (provider) = converted. */
export async function onLeadConverted(userIds: string[], shiftId: string | null) {
  const leads = await prisma.lead.findMany({ where: { convertedUserId: { in: userIds }, status: { not: "CONVERTED" } } });
  for (const l of leads) {
    await prisma.lead.update({ where: { id: l.id }, data: { status: "CONVERTED", convertedAt: new Date(), convertedShiftId: shiftId, nextDripAt: null } });
    await prisma.leadActivity.create({ data: { leadId: l.id, kind: "CONVERTED", body: shiftId ? `First shift confirmed (${shiftId})` : "Account activated" } });
  }
}

// ---------------- admin ----------------

export async function listLeads(actor: Actor, f: { q?: string; status?: LeadStatus; audience?: "CLINIC" | "PROVIDER"; source?: string; take?: number; spam?: boolean } = {}) {
  requireAdmin(actor);
  const where = {
    spamCategory: f.spam ? { not: null } : null,
    ...(f.status ? { status: f.status } : {}),
    ...(f.audience ? { audience: f.audience } : {}),
    ...(f.source ? { source: f.source } : {}),
    ...(f.q
      ? { OR: [{ name: { contains: f.q, mode: "insensitive" as const } }, { email: { contains: f.q, mode: "insensitive" as const } }, { organization: { contains: f.q, mode: "insensitive" as const } }] }
      : {}),
  };
  const [rows, counts] = await Promise.all([
    prisma.lead.findMany({ where, orderBy: { createdAt: "desc" }, take: f.take ?? 200 }),
    prisma.lead.groupBy({ by: ["status"], where: { spamCategory: null }, _count: true }),
  ]);
  const spam = await prisma.lead.count({ where: { spamCategory: { not: null } } });
  return { rows, counts: Object.fromEntries(counts.map((c) => [c.status, c._count])) as Record<string, number>, spam };
}

export async function leadDetail(actor: Actor, id: string) {
  requireAdmin(actor);
  const lead = await prisma.lead.findUnique({ where: { id }, include: { activities: { orderBy: { createdAt: "desc" } } } });
  if (!lead) throw new DomainError("NOT_FOUND", "Lead not found");
  const promo = lead.promoCode ? await prisma.promoCode.findUnique({ where: { code: lead.promoCode } }) : null;
  return { lead, promo };
}

export const LeadUpdate = z.object({
  status: z.enum(["NEW", "NURTURING", "CONTACTED", "CONVERTED", "UNSUBSCRIBED", "EXPIRED", "SUPERSEDED", "LOST"]).optional(),
  followUpAt: z.coerce.date().nullable().optional(),
  note: z.string().trim().max(2000).optional(),
});

export async function updateLead(actor: Actor, id: string, raw: z.input<typeof LeadUpdate>) {
  requireAdmin(actor);
  const input = LeadUpdate.parse(raw);
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id } });
  const data: Record<string, unknown> = {};
  if (input.status && input.status !== lead.status) {
    data.status = input.status;
    if (input.status !== "NURTURING") data.nextDripAt = null;
    if (input.status === "NURTURING" && lead.status !== "NURTURING") data.nextDripAt = new Date();
    await prisma.leadActivity.create({ data: { leadId: id, kind: "STATUS", body: `${lead.status} → ${input.status}`, actorId: actor.userId } });
  }
  if (input.followUpAt !== undefined) data.followUpAt = input.followUpAt;
  if (Object.keys(data).length) await prisma.lead.update({ where: { id }, data });
  if (input.note) await prisma.leadActivity.create({ data: { leadId: id, kind: "NOTE", body: input.note, actorId: actor.userId } });
  await audit(prisma, actor, "lead.updated", "Lead", id, { status: lead.status }, input);
}

export async function createLeadManually(actor: Actor, raw: { name: string; email: string; audience: "CLINIC" | "PROVIDER"; phone?: string; organization?: string; state?: string; note?: string }) {
  requireAdmin(actor);
  const email = raw.email.trim().toLowerCase();
  const lead = await prisma.lead.create({
    data: {
      name: raw.name.trim(),
      email,
      audience: raw.audience,
      phone: raw.phone || null,
      organization: raw.organization || null,
      state: raw.state?.toUpperCase() || null,
      source: "manual",
      campaignCode: `MANUAL:${Date.now()}`,
      status: "NEW",
      unsubscribeToken: randomBytes(24).toString("hex"),
      ownerId: actor.userId,
    },
  });
  if (raw.note) await prisma.leadActivity.create({ data: { leadId: lead.id, kind: "NOTE", body: raw.note, actorId: actor.userId } });
  return lead;
}

export async function resendLeadEmail(actor: Actor, id: string) {
  requireAdmin(actor);
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id } });
  if (lead.status === "UNSUBSCRIBED") throw new DomainError("CONFLICT", "This lead unsubscribed.");
  const step = Math.max(0, lead.dripStep - 1);
  await prisma.lead.update({ where: { id }, data: { dripStep: step, status: "NURTURING" } });
  await sendDripStep(id);
}

export async function deleteLead(actor: Actor, id: string) {
  requireAdmin(actor);
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id } });
  await prisma.lead.delete({ where: { id } });
  await audit(prisma, actor, "lead.deleted", "Lead", id, { email: lead.email, campaignCode: lead.campaignCode });
}

export function leadsCsv(rows: Lead[]) {
  const q = (v: unknown) => `"${String(v ?? "").replace(/"/g, '""')}"`;
  return [
    ["name", "email", "phone", "audience", "organization", "state", "profession", "source", "campaign", "code", "status", "created", "converted"].join(","),
    ...rows.map((r) =>
      [r.name, r.email, r.phone, r.audience, r.organization, r.state, r.professionCode, r.source, r.campaignCode, r.promoCode, r.status, r.createdAt.toISOString(), r.convertedAt?.toISOString() ?? ""]
        .map(q)
        .join(","),
    ),
  ].join("\n");
}

/**
 * Admin: move a lead into or out of Spam. "Not spam" replays the original signup (code, first
 * email, admin notice for contact inquiries) as if it had never been filtered, then removes the
 * spam copy. "Spam" stops its emails; optionally blocks the sender's address or domain.
 */
export async function setLeadSpam(actor: Actor, id: string, spam: boolean, block: "EMAIL" | "DOMAIN" | null = null) {
  requireAdmin(actor);
  const lead = await prisma.lead.findUniqueOrThrow({ where: { id } });
  if (spam) {
    await prisma.lead.update({ where: { id }, data: { spamCategory: lead.spamCategory ?? "spam", status: "LOST", nextDripAt: null, activities: { create: { kind: "STATUS", body: "Marked as spam", actorId: actor.userId } } } });
    if (block) {
      const { blockSender } = await import("./spam");
      await blockSender(actor, lead.email, block, `From lead ${lead.name}`);
    }
    await audit(prisma, actor, "spam.mark", "Lead", id, null, { block });
    return { leadId: id };
  }
  if (!lead.spamCategory) return { leadId: id };
  const [, source, campaign] = lead.campaignCode.split(":");
  if (!lead.campaignCode.startsWith("SPAM:")) {
    await prisma.lead.update({ where: { id }, data: { spamCategory: null, spamReasons: [], status: "NEW", activities: { create: { kind: "STATUS", body: "Not spam", actorId: actor.userId } } } });
    await audit(prisma, actor, "spam.unmark", "Lead", id, null, null);
    return { leadId: id };
  }
  const { blockedSenderFor } = await import("./spam");
  const blocked = await blockedSenderFor(lead.email);
  if (blocked?.kind === "EMAIL") await prisma.blockedSender.delete({ where: { id: blocked.id } });
  const r = await captureLead(
    {
      name: lead.name, email: lead.email, phone: lead.phone, organization: lead.organization, state: lead.state, professionCode: lead.professionCode, message: lead.message,
      source: (["popup", "landing", "waitlist", "contact"].includes(source) ? source : "contact") as "contact", audience: lead.audience, campaign: campaign || null, landingPath: lead.landingPath,
    },
    { skipSpamCheck: true },
  ).catch(async (e) => {
    // e.g. the campaign offer ended: keep the person as a plain contact lead instead.
    console.error("not-spam replay failed", e);
    return captureLead({ name: lead.name, email: lead.email, message: lead.message, organization: lead.organization, source: "contact", audience: lead.audience }, { skipSpamCheck: true });
  });
  await prisma.lead.delete({ where: { id } });
  await audit(prisma, actor, "spam.unmark", "Lead", r.leadId ?? id, null, { from: id });
  return { leadId: r.leadId };
}
