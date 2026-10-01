import { z } from "zod";
import { prisma } from "@cm/db";
import { DomainError } from "@cm/core";
import { checkRateLimit } from "../auth";
import { assessSender, checkHuman, fileSpamQuestion } from "../spam";
import { clock } from "../context";
import { track } from "../analytics";
import { answerQuestion } from "./agents";
import { logAgent, signal } from "./engine";
import { ensureGrowthDefaults } from "./defaults";
import { onProviderProspectSignup, trackProviderProspect } from "./providers";

/** Public-facing growth entry points: campaign links, tracked links, website questions, signup attribution. */

/** /join/<code>: the campaign's landing copy; counts a visit unless previewing. */
export async function joinCampaign(code: string, countVisit = true) {
  let c = await prisma.growthCampaign.findFirst({ where: { code: code.toLowerCase(), active: true } });
  if (!c && !(await prisma.growthCampaign.count())) {
    // Fresh install: the starter school links exist before the first agent run.
    await ensureGrowthDefaults();
    c = await prisma.growthCampaign.findFirst({ where: { code: code.toLowerCase(), active: true } });
  }
  if (c && countVisit) await prisma.growthCampaign.update({ where: { id: c.id }, data: { visits: { increment: 1 } } });
  return c;
}

const TRACKED = new Set(["site_visit", "calculator_used", "pricing_viewed", "signup_started"]);

/**
 * Signals from our own emailed links (?c=<prospect token>). Anonymous visitors
 * aren't profiled; at most one of each signal per prospect per day.
 */
export async function trackProspect(token: string, kind: string, meta?: { days?: number }, ip?: string) {
  if (!/^[a-f0-9]{40}$/.test(token) || !TRACKED.has(kind)) return;
  if (ip) await checkRateLimit(`gtrack:${ip}`, 120, 3600);
  const p = await prisma.clinicProspect.findUnique({ where: { publicToken: token }, select: { id: true } });
  if (!p) {
    await trackProviderProspect(token, kind);
    return;
  }
  const dayStart = new Date(clock.now()); dayStart.setHours(0, 0, 0, 0);
  if (await prisma.leadSignal.count({ where: { entityType: "PROSPECT", entityId: p.id, kind, createdAt: { gte: dayStart } } })) return;
  await signal("PROSPECT", p.id, kind, meta?.days !== undefined ? { days: Math.max(0, Math.min(60, Math.round(meta.days))) } : undefined);
}

export const QuestionInput = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  question: z.string().trim().min(5, "Type your question.").max(2000),
  /** Honeypot (hidden field). */
  website: z.string().max(500).optional(),
  startedAt: z.union([z.number(), z.string()]).optional().nullable(),
  turnstileToken: z.string().max(4000).optional().nullable(),
});

const HAND_OFF = "Good question — we want to make sure you get an accurate answer, so a person from our team will reply by email shortly.";

export async function askQuestion(raw: z.input<typeof QuestionInput>, ip?: string) {
  const input = QuestionInput.safeParse(raw);
  if (!input.success) throw new DomainError("VALIDATION", input.error.issues[0]?.message ?? "Check the form.");
  if (ip) {
    await checkRateLimit(`gask:${ip}`, 10, 3600);
    // Bots get the same reply as everyone; nothing is stored.
    if ((await checkHuman({ token: input.data.turnstileToken, honeypot: input.data.website, startedAt: input.data.startedAt, ip })) === "bot") return { answer: HAND_OFF, escalated: true };
  }
  const { name, email, question } = input.data;
  const verdict = await assessSender({ name, email, text: question });
  if (verdict.category) {
    await fileSpamQuestion({ name, email, question, category: verdict.category, reasons: verdict.reasons, via: "rules" });
    await track({ type: "QUESTION_ASKED", props: { escalated: false, spam: true } });
    return { answer: HAND_OFF, escalated: true };
  }
  const r = await answerQuestion({ name, email, question });
  await track({ type: "QUESTION_ASKED", props: { escalated: r.escalated } });
  return r;
}

/** Provider registration extras (pre-licensure, campaign attribution). Called by auth.signup. */
export async function onProviderSignup(providerId: string, extra: { campaign?: string | null; graduationDate?: string | null; isStudent?: boolean; source?: string | null; prospectToken?: string | null }) {
  const code = extra.campaign?.toLowerCase().replace(/[^a-z0-9-]/g, "") || null;
  const campaign = code ? await prisma.growthCampaign.findUnique({ where: { code } }) : null;
  const grad = extra.graduationDate && /^\d{4}-\d{2}(-\d{2})?$/.test(extra.graduationDate) ? new Date(`${extra.graduationDate.length === 7 ? `${extra.graduationDate}-01` : extra.graduationDate}T12:00:00Z`) : null;
  // A student-path recruitment link (Admin → Recruitment) counts as the campaign too.
  const recruit = !campaign && code ? await prisma.recruitCampaign.findUnique({ where: { slug: code } }) : null;
  await prisma.provider.update({
    where: { id: providerId },
    data: {
      campaignCode: campaign?.code ?? recruit?.slug ?? null,
      // Never clear a graduation date the student path already stored.
      ...(grad ? { graduationDate: grad } : {}),
      isStudent: !!extra.isStudent,
      growthSource: campaign ? campaign.kind : recruit ? "recruitment" : (extra.source?.slice(0, 40) ?? "organic"),
    },
  });
  await logAgent("providerRecruitment", "registered", { entityType: "PROVIDER", entityId: providerId, contextRef: `campaign:${campaign?.code ?? "-"}${extra.isStudent ? " student" : ""}` });
  // Someone we recruited (tracked link, or the same email / NPI as a discovered prospect).
  await onProviderProspectSignup(providerId, extra.prospectToken);
}

/** A clinic that came from one of our emails (?c=<token>) links to its CRM row. */
export async function onClinicSignup(clinicOrgId: string, prospectToken?: string | null) {
  if (!prospectToken || !/^[a-f0-9]{40}$/.test(prospectToken)) return;
  const p = await prisma.clinicProspect.findUnique({ where: { publicToken: prospectToken } });
  if (!p || p.clinicOrgId) return;
  await prisma.clinicProspect.update({ where: { id: p.id }, data: { clinicOrgId, outreachPaused: true, stage: "ACCOUNT_CREATED" } });
  await signal("PROSPECT", p.id, "account_created");
}
