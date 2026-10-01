import { z } from "zod";
import { prisma } from "@cm/db";
import { DomainError } from "@cm/core";
import { checkRateLimit } from "../auth";
import { clock } from "../context";
import { track } from "../analytics";
import { answerQuestion } from "./agents";
import { logAgent, signal } from "./engine";
import { ensureGrowthDefaults } from "./defaults";

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
  if (!p) return;
  const dayStart = new Date(clock.now()); dayStart.setHours(0, 0, 0, 0);
  if (await prisma.leadSignal.count({ where: { entityType: "PROSPECT", entityId: p.id, kind, createdAt: { gte: dayStart } } })) return;
  await signal("PROSPECT", p.id, kind, meta?.days !== undefined ? { days: Math.max(0, Math.min(60, Math.round(meta.days))) } : undefined);
}

export const QuestionInput = z.object({
  name: z.string().trim().min(1, "Enter your name.").max(120),
  email: z.string().trim().toLowerCase().email("Enter a valid email address."),
  question: z.string().trim().min(5, "Type your question.").max(2000),
  website: z.string().max(0).optional(),
});

export async function askQuestion(raw: z.input<typeof QuestionInput>, ip?: string) {
  const input = QuestionInput.safeParse(raw);
  if (!input.success) throw new DomainError("VALIDATION", input.error.issues[0]?.message ?? "Check the form.");
  if (ip) await checkRateLimit(`gask:${ip}`, 10, 3600);
  const r = await answerQuestion(input.data);
  await track({ type: "QUESTION_ASKED", props: { escalated: r.escalated } });
  return r;
}

/** Provider registration extras (pre-licensure, campaign attribution). Called by auth.signup. */
export async function onProviderSignup(providerId: string, extra: { campaign?: string | null; graduationDate?: string | null; isStudent?: boolean; source?: string | null }) {
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
}

/** A clinic that came from one of our emails (?c=<token>) links to its CRM row. */
export async function onClinicSignup(clinicOrgId: string, prospectToken?: string | null) {
  if (!prospectToken || !/^[a-f0-9]{40}$/.test(prospectToken)) return;
  const p = await prisma.clinicProspect.findUnique({ where: { publicToken: prospectToken } });
  if (!p || p.clinicOrgId) return;
  await prisma.clinicProspect.update({ where: { id: p.id }, data: { clinicOrgId, outreachPaused: true, stage: "ACCOUNT_CREATED" } });
  await signal("PROSPECT", p.id, "account_created");
}
