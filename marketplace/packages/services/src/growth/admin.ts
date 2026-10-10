import { z } from "zod";
import { acceptProviderEmail, addressKey, DomainError, matchesProfile, PI_PRACTICE_PHRASES, providerImportHeader, providerImportRow, renderTemplate, titleCase, validateAiCopy, type ProviderCandidate } from "@cm/core";
import { nppesProvider, type NppesRecord } from "@cm/integrations";
import { prisma, type Prisma, type ProspectStage } from "@cm/db";
import { brand } from "@cm/config";
import { audit, clock, getSettings, invalidateSettings, requireAdmin, type Actor } from "../context";
import { absoluteUrl } from "../notify";
import { updateSetting } from "../admin";
import { getEligibleProviders } from "../eligibility";
import { AGENT_AUDIENCE, AGENTS, Deferred, agentOn, ai, aiRules, aiSpendCents, compose, isSuppressed, logAgent, marketingOn, newToken, normEmail, pickPrompt, recipient, sendGrowthEmail, suppress, type AgentKey, type Audience, type GrowthEntityType } from "./engine";
import { outreachProfessionFor } from "./expansion";
import { ensureGrowthDefaults } from "./defaults";
import { advanceOutreach, approvedPiKeys, outreachKey, prospectVars, clinicChecklist, classifyProspect, growthTick, handleProspectReply, OUTREACH_SEQUENCE, providerSnapshot, refreshProspect, supplyGapSweep } from "./agents";
import { discoverySweep, prospectingStatus, researchProspect, researchSweep } from "./prospecting";
import { marketSupplySweep } from "./supply";
import { resumeResearch } from "./aihealth";
import { advanceProviderOutreach, handleProviderProspectReply, PROVIDER_OUTREACH_SEQUENCE, upsertProviderProspects, verifyContact } from "./providers";
import { registryProfile } from "./expansion";
import { attribution, growthFunnels, growthKpis, liquidity, marketForPoint } from "./analytics";

/** Admin side of the growth control center. Every human override is audit-logged. */

export async function overview(actor: Actor) {
  requireAdmin(actor);
  await ensureGrowthDefaults();
  const s = await getSettings(undefined, true);
  const now = clock.now();
  const dayStart = new Date(now); dayStart.setHours(0, 0, 0, 0);
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const lastTick = await prisma.setting.findUnique({ where: { key: "growth.lastTick" } });
  const [pendingApprovals, openEscalations, highIntent, sentToday, blockedToday] = await Promise.all([
    prisma.communication.count({ where: { status: "PENDING_APPROVAL" } }),
    prisma.escalation.count({ where: { status: { not: "RESOLVED" } } }),
    prisma.clinicProspect.count({ where: { intentCategory: "HIGH_INTENT" } }),
    prisma.communication.count({ where: { status: "SENT", createdAt: { gte: dayStart } } }),
    prisma.communication.count({ where: { status: "BLOCKED", createdAt: { gte: dayStart } } }),
  ]);
  const usage = await prisma.aiUsage.groupBy({ by: ["agent", "task", "model"], where: { createdAt: { gte: monthStart } }, _count: { _all: true }, _sum: { inputTokens: true, outputTokens: true, costMicroUsd: true } });
  const blockReasons = await prisma.communication.groupBy({ by: ["blockReason"], where: { status: "BLOCKED", createdAt: { gte: new Date(+now - 7 * 86_400_000) } }, _count: { _all: true } });
  return {
    settings: {
      paused: s["growth.pausedOutbound"], providerMarketing: s["growth.providerMarketing"], clinicMarketing: s["growth.clinicMarketing"], outreachMode: s["growth.outreachMode"], postalAddress: s["growth.postalAddress"], aiProvider: s["growth.aiProvider"],
      dailyBudgetCents: s["growth.aiDailyBudgetCents"], monthlyBudgetCents: s["growth.aiMonthlyBudgetCents"],
    },
    agents: (Object.keys(AGENTS) as AgentKey[]).map((k) => ({ key: k, label: AGENTS[k][0], description: AGENTS[k][1], on: !!s["growth.agents"][k], audience: AGENT_AUDIENCE[k] ?? null })),
    counts: { pendingApprovals, openEscalations, highIntent, sentToday, blockedToday },
    aiSpend: { todayCents: await aiSpendCents(dayStart), monthCents: await aiSpendCents(monthStart), usage: usage.map((u) => ({ agent: u.agent, task: u.task, model: u.model, calls: u._count._all, inputTokens: u._sum.inputTokens ?? 0, outputTokens: u._sum.outputTokens ?? 0, costCents: (u._sum.costMicroUsd ?? 0) / 10_000 })) },
    blockReasons: blockReasons.map((b) => ({ reason: b.blockReason ?? "?", n: b._count._all })),
    lastTick: (lastTick?.value as { at: string; out: unknown } | undefined) ?? null,
    funnels: await growthFunnels(),
    kpis: await growthKpis(),
  };
}

export async function setPaused(actor: Actor, paused: boolean) {
  await updateSetting(actor, "growth.pausedOutbound", paused);
  await logAgent("admin", paused ? "outbound_paused" : "outbound_resumed", { humanOverrideBy: actor.userId });
}

/** Provider and clinic marketing switch on/off independently (e.g. build provider supply first). */
export async function setMarketing(actor: Actor, audience: Audience, on: boolean) {
  requireAdmin(actor);
  await updateSetting(actor, audience === "provider" ? "growth.providerMarketing" : "growth.clinicMarketing", on);
  await logAgent("admin", `${audience}_marketing_${on ? "on" : "off"}`, { humanOverrideBy: actor.userId });
}

export async function setAgent(actor: Actor, key: AgentKey, on: boolean) {
  requireAdmin(actor);
  if (!(key in AGENTS)) throw new DomainError("VALIDATION", "Unknown agent.");
  const s = await getSettings(undefined, true);
  await updateSetting(actor, "growth.agents", { ...s["growth.agents"], [key]: on });
  await logAgent("admin", on ? "agent_on" : "agent_off", { trigger: key, humanOverrideBy: actor.userId });
}

// ---------------- automatic prospecting ----------------

export async function prospecting(actor: Actor) {
  requireAdmin(actor);
  return prospectingStatus();
}

/** "Find clinics now": the next cities (or the ones named), then a research batch. */
export async function runProspectingNow(actor: Actor, cities?: string[]) {
  requireAdmin(actor);
  const discovery = await discoverySweep({ cities: cities?.length ? cities : undefined });
  const research = await researchSweep({ wallMs: 90_000 });
  await logAgent("admin", "prospecting_run", { humanOverrideBy: actor.userId, output: { discovery, research } });
  return { discovery, research };
}

export async function researchNow(actor: Actor, prospectId: string) {
  requireAdmin(actor);
  const res = await researchProspect(prospectId, { force: true });
  await logAgent("admin", "research_requested", { entityType: "PROSPECT", entityId: prospectId, humanOverrideBy: actor.userId, output: res });
  return res;
}

export async function runNow(actor: Actor) {
  requireAdmin(actor);
  const out = await growthTick();
  return { ...out, supplyGaps: await supplyGapSweep(), markets: await marketSupplySweep() };
}

// ---------------- sales queue (spec §17) ----------------

export async function salesQueue(actor: Actor) {
  requireAdmin(actor);
  const rows = await prisma.clinicProspect.findMany({
    where: { doNotContact: false, OR: [{ intentCategory: "HIGH_INTENT" }, { stage: { in: ["INTERESTED", "ENGAGED", "COVERAGE_REQUESTED"] } }] },
    orderBy: [{ intentScore: "desc" }, { updatedAt: "desc" }],
    take: 100,
  });
  const open = await prisma.escalation.findMany({ where: { status: { not: "RESOLVED" }, entityType: { in: ["PROSPECT", "CLINIC"] } }, orderBy: { createdAt: "desc" } });
  const byEntity = new Map<string, typeof open>();
  for (const e of open) byEntity.set(`${e.entityType}:${e.entityId}`, [...(byEntity.get(`${e.entityType}:${e.entityId}`) ?? []), e]);
  const extra = await prisma.clinicProspect.findMany({ where: { id: { notIn: rows.map((r) => r.id) }, OR: [{ id: { in: open.filter((e) => e.entityType === "PROSPECT").map((e) => e.entityId!) } }, { clinicOrgId: { in: open.filter((e) => e.entityType === "CLINIC").map((e) => e.entityId!) } }] } });
  const items = [];
  for (const c of [...rows, ...extra]) {
    const escalations = [...(byEntity.get(`PROSPECT:${c.id}`) ?? []), ...(c.clinicOrgId ? (byEntity.get(`CLINIC:${c.clinicOrgId}`) ?? []) : [])];
    const checklist = c.clinicOrgId ? await clinicChecklist(c.clinicOrgId) : null;
    const drafts = c.clinicOrgId ? await prisma.shift.findMany({ where: { status: "DRAFT", location: { clinicOrgId: c.clinicOrgId }, startsAt: { gt: clock.now() } }, include: { location: true }, orderBy: { startsAt: "asc" } }) : [];
    const suggested = escalations[0]?.recommendedAction ?? (drafts.length ? `Call about the ${drafts.length}-day request — started but not posted.` : checklist?.next ? `Help with: ${checklist.next.label}.` : "Personal follow-up.");
    items.push({ prospect: c, escalations, checklist: checklist?.steps ?? null, drafts: drafts.map((d) => ({ id: d.id, startsAt: d.startsAt, endsAt: d.endsAt, timeZone: d.location.timeZone, clinicPriceCents: d.clinicPriceCents })), suggested });
  }
  return items;
}

// ---------------- approvals ----------------

/** Which pile a draft belongs to: first-contact/follow-up outreach (bulk-approvable) or a reply in a conversation (read each one). */
function approvalKind(m: { entityType: string; promptKey: string | null }): "clinic" | "provider" | "reply" {
  if (m.entityType === "PROSPECT" && m.promptKey && OUTREACH_SEQUENCE.includes(m.promptKey)) return "clinic";
  if (m.entityType === "PROVIDER_PROSPECT" && m.promptKey && PROVIDER_OUTREACH_SEQUENCE.includes(m.promptKey)) return "provider";
  return "reply";
}

export async function approvals(actor: Actor) {
  requireAdmin(actor);
  const rows = await prisma.communication.findMany({ where: { status: "PENDING_APPROVAL" }, orderBy: { createdAt: "asc" }, take: 200 });
  return Promise.all(rows.map(async (m) => ({ ...m, kind: approvalKind(m), label: (await recipient(m.entityType as GrowthEntityType, m.entityId))?.label ?? m.entityId })));
}

/** Approved drafts still waiting to go out (bulk approvals send in the background). */
export async function approvalQueue(actor: Actor) {
  requireAdmin(actor);
  const [queued, held] = await Promise.all([
    prisma.communication.count({ where: { status: "QUEUED" } }),
    prisma.setting.findUnique({ where: { key: "growth.approvedQueueHeld" } }),
  ]);
  return { queued, heldReason: queued ? ((held?.value as { reason?: string } | null)?.reason ?? null) : null };
}

/** Sends one approved draft (still through compliance) and advances that prospect's outreach. */
async function sendApproved(m: Prisma.CommunicationGetPayload<object>, userId: string | null, subject: string, body: string, how: { bulk?: boolean; edited?: boolean } = {}) {
  const r = await recipient(m.entityType as GrowthEntityType, m.entityId);
  if (!r) {
    await prisma.communication.update({ where: { id: m.id }, data: { status: "REJECTED" } });
    return { ok: false, blocked: true, reason: "recipient no longer exists" };
  }
  // Bulk sends wait out pause/caps/quiet hours (Deferred) instead of failing.
  const res = await sendGrowthEmail(r, { subject, body }, { agent: m.agent ?? "admin", purpose: m.purpose as "COMMERCIAL" | "RELATIONSHIP", prompt: m.promptKey ? { key: m.promptKey, version: m.promptVersion ?? 0 } : null, createdById: userId, deferTransient: how.bulk });
  await prisma.communication.update({ where: { id: m.id }, data: { status: res.ok ? "APPROVED" : "REJECTED", createdById: userId } });
  await logAgent(m.agent ?? "admin", "draft_approved", { entityType: m.entityType, entityId: m.entityId, promptKey: m.promptKey, promptVersion: m.promptVersion, humanOverrideBy: `${userId ?? "admin"}${how.edited ? " (edited)" : ""}${how.bulk ? " (bulk)" : ""}`, sendStatus: res.ok ? "sent" : res.blocked ? "blocked" : "failed", error: res.reason });
  if (res.ok && m.entityType === "PROSPECT" && m.promptKey && OUTREACH_SEQUENCE.includes(m.promptKey)) await advanceOutreach(m.entityId);
  if (res.ok && m.entityType === "PROVIDER_PROSPECT" && m.promptKey && PROVIDER_OUTREACH_SEQUENCE.includes(m.promptKey)) await advanceProviderOutreach(m.entityId);
  return res;
}

/** Approve (optionally edited) → sent as a human-approved message, still through compliance. Reject → discarded, outreach paused. */
export async function decideApproval(actor: Actor, id: string, decision: "approve" | "reject", edits: { subject?: string; body?: string } = {}) {
  requireAdmin(actor);
  const m = await prisma.communication.findUnique({ where: { id } });
  if (!m || m.status !== "PENDING_APPROVAL") throw new DomainError("CONFLICT", "That draft is no longer waiting for approval.");
  if (decision === "reject") {
    await rejectDraft(m, actor.userId);
    return { status: "rejected" as const };
  }
  const subject = (edits.subject ?? m.subject ?? "").trim(), body = (edits.body ?? m.body ?? "").trim();
  if (!subject || !body) throw new DomainError("VALIDATION", "Subject and message are required.");
  const edited = subject !== m.subject || body !== (m.body ?? "").trim();
  const res = await sendApproved(m, actor.userId, subject, body, { edited });
  if (!res.ok) throw new DomainError("VALIDATION", res.blocked ? `Not sent — blocked by compliance: ${res.reason}` : "The email failed to send.");
  return { status: "sent" as const };
}

async function rejectDraft(m: { id: string; entityType: string; entityId: string; agent: string | null; promptKey: string | null }, userId: string | null) {
  await prisma.communication.update({ where: { id: m.id }, data: { status: "REJECTED", createdById: userId } });
  if (m.entityType === "PROSPECT") await prisma.clinicProspect.update({ where: { id: m.entityId }, data: { outreachPaused: true } }).catch(() => undefined);
  if (m.entityType === "PROVIDER_PROSPECT") await prisma.providerProspect.update({ where: { id: m.entityId }, data: { outreachPaused: true } }).catch(() => undefined);
  await logAgent(m.agent ?? "admin", "draft_rejected", { entityType: m.entityType, entityId: m.entityId, promptKey: m.promptKey, humanOverrideBy: userId });
}

/**
 * Bulk approve / reject drafts exactly as written. Approved drafts are QUEUED and
 * sent by approvedQueueSweep (every minute), so a big batch never times out and
 * waits out pause, caps and quiet hours instead of being dropped.
 */
export async function bulkDecide(actor: Actor, ids: string[], decision: "approve" | "reject") {
  requireAdmin(actor);
  const rows = await prisma.communication.findMany({ where: { id: { in: [...new Set(ids)].slice(0, 500) }, status: "PENDING_APPROVAL" } });
  if (decision === "reject") {
    for (const m of rows) await rejectDraft(m, actor.userId);
    return { count: rows.length };
  }
  const r = await prisma.communication.updateMany({ where: { id: { in: rows.map((m) => m.id) }, status: "PENDING_APPROVAL" }, data: { status: "QUEUED", createdById: actor.userId } });
  await audit(prisma, actor, "growth.bulk_approve", "Communication", "bulk", null, { count: r.count });
  return { count: r.count };
}

/** Sends QUEUED (bulk-approved) drafts oldest first. A transient block (pause, caps, quiet hours) stops the run; the rest wait for the next tick. */
export async function approvedQueueSweep(limit = 40) {
  const rows = await prisma.communication.findMany({ where: { status: "QUEUED" }, orderBy: { createdAt: "asc" }, take: limit });
  let sent = 0, failed = 0;
  for (const m of rows) {
    try {
      const res = await sendApproved(m, m.createdById, (m.subject ?? "").trim(), (m.body ?? "").trim(), { bulk: true });
      if (res.ok) sent++; else failed++;
    } catch (e) {
      if (e instanceof Deferred) {
        const prevHold = (await prisma.setting.findUnique({ where: { key: "growth.approvedQueueHeld" } }))?.value as { since?: string } | null;
        const hold = { reason: e.message, at: clock.now().toISOString(), since: prevHold?.since ?? clock.now().toISOString() };
        await prisma.setting.upsert({ where: { key: "growth.approvedQueueHeld" }, create: { key: "growth.approvedQueueHeld", value: hold }, update: { value: hold } });
        return { sent, failed, held: e.message };
      }
      failed++;
      await prisma.communication.update({ where: { id: m.id }, data: { status: "REJECTED", error: String((e as Error).message ?? e).slice(0, 300) } }).catch(() => undefined);
    }
  }
  if (rows.length) await prisma.setting.deleteMany({ where: { key: "growth.approvedQueueHeld" } });
  return { sent, failed, held: null };
}

// ---------------- escalations ----------------

/** open (default) | all (incl. resolved) | spam (the Spam folder). Spam never shows in the other two. */
export async function escalations(actor: Actor, view: boolean | "open" | "all" | "spam" = "open") {
  requireAdmin(actor);
  const v = view === true ? "all" : view === false ? "open" : view;
  const where: Prisma.EscalationWhereInput = v === "spam" ? { spamCategory: { not: null } } : v === "all" ? { spamCategory: null } : { spamCategory: null, status: { not: "RESOLVED" } };
  return prisma.escalation.findMany({ where, orderBy: { createdAt: "desc" }, take: 200 });
}

export async function updateEscalation(actor: Actor, id: string, status: "OPEN" | "IN_PROGRESS" | "RESOLVED", resolution?: string | null) {
  requireAdmin(actor);
  await prisma.escalation.update({ where: { id }, data: { status, resolution: resolution?.slice(0, 500) || undefined, resolvedById: actor.userId, resolvedAt: status === "RESOLVED" ? clock.now() : null } });
}

// ---------------- prospects ----------------

export async function prospects(actor: Actor, f: { q?: string; stage?: string; intent?: string; segment?: string; market?: string; research?: string; focus?: string; skip?: number } = {}) {
  requireAdmin(actor);
  const where: Prisma.ClinicProspectWhereInput = {
    ...(f.q ? { OR: ["clinicName", "ownerName", "email", "city", "zip"].map((k) => ({ [k]: { contains: f.q, mode: "insensitive" } })) } : {}),
    ...(f.stage ? { stage: f.stage as ProspectStage } : {}),
    ...(f.intent ? { intentCategory: f.intent as never } : {}),
    ...(f.segment ? { segment: f.segment } : {}),
    ...(f.market ? { marketKey: f.market } : {}),
    // Personal injury practices: same phrases as core isPersonalInjuryPractice.
    ...(f.focus === "pi" ? { AND: [{ OR: PI_PRACTICE_PHRASES.map((ph) => ({ practiceType: { contains: ph, mode: "insensitive" as const } })) }] } : {}),
    ...(f.research === "with_email" ? { email: { not: null } } : f.research ? { researchStatus: f.research } : {}),
  };
  const [rows, total] = await Promise.all([
    prisma.clinicProspect.findMany({ where, orderBy: [{ intentScore: "desc" }, { createdAt: "desc" }], take: 50, skip: f.skip ?? 0 }),
    prisma.clinicProspect.count({ where }),
  ]);
  return { rows, total };
}

export async function prospectDetail(actor: Actor, id: string) {
  requireAdmin(actor);
  const p = await prisma.clinicProspect.findUnique({ where: { id } });
  if (!p) throw new DomainError("NOT_FOUND", "Clinic not found.");
  const ent = [{ entityType: "PROSPECT", entityId: id }, ...(p.clinicOrgId ? [{ entityType: "CLINIC", entityId: p.clinicOrgId }] : [])];
  const [communications, signals, activity, escalations] = await Promise.all([
    prisma.communication.findMany({ where: { OR: ent }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.leadSignal.findMany({ where: { entityType: "PROSPECT", entityId: id }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.agentActivity.findMany({ where: { OR: ent }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.escalation.findMany({ where: { OR: ent }, orderBy: { createdAt: "desc" } }),
  ]);
  return { prospect: p, communications, signals, activity, escalations, checklist: p.clinicOrgId ? (await clinicChecklist(p.clinicOrgId))?.steps ?? null : null };
}

const str = (max: number) => z.string().trim().max(max).optional().nullable().transform((v) => (v ? v : null));
const int = z.union([z.number(), z.string()]).optional().nullable().transform((v) => (v === "" || v == null ? null : Number.isFinite(Number(v)) ? Math.round(Number(v)) : null));
export const ProspectInput = z.object({
  clinicName: z.string().trim().min(1, "Clinic name is required.").max(200),
  ownerName: str(160), email: z.string().trim().toLowerCase().email("Enter a valid email.").optional().nullable().or(z.literal("")).transform((v) => v || null),
  phone: str(30), website: str(200), address: str(200), city: str(100), county: str(100), state: z.string().trim().toUpperCase().length(2).optional().default("FL"), zip: str(10),
  locationsCount: int, providerCount: int, practiceType: str(80), ownership: z.enum(["independent", "group", "franchise", "unknown"]).optional().nullable(),
  multidisciplinary: z.boolean().optional().nullable(), source: str(160), notes: str(4000), campaignCode: str(60),
});

async function placeProspect(data: { zip?: string | null; lat?: number | null; lng?: number | null }) {
  if (data.lat != null && data.lng != null) return { lat: data.lat, lng: data.lng, marketKey: (await marketForPoint(data.lat, data.lng))?.key ?? null };
  return {};
}

export async function saveProspect(actor: Actor, raw: unknown, id?: string) {
  requireAdmin(actor);
  const input = ProspectInput.parse(raw);
  const geo = await placeProspect(input);
  if (id) {
    const before = await prisma.clinicProspect.findUniqueOrThrow({ where: { id } });
    const row = await prisma.clinicProspect.update({ where: { id }, data: { ...input, ...geo, segmentBasis: before.segmentBasis === "RULE" || before.segmentBasis === "AI" ? "NONE" : before.segmentBasis } });
    await audit(prisma, actor, "growth.prospect.updated", "ClinicProspect", id, null, input);
    await refreshProspect(id);
    return row;
  }
  const row = await prisma.clinicProspect.create({ data: { ...input, ...geo, collectedAt: clock.now(), source: input.source ?? "manual entry", publicToken: newToken() } });
  await audit(prisma, actor, "growth.prospect.created", "ClinicProspect", row.id, null, input);
  await classifyProspect(row.id);
  await refreshProspect(row.id);
  return row;
}

// ---------------- clinics added by hand ----------------

/**
 * Will the clinic outreach emails reach this clinic, and if not, why (plain reasons with where to fix them).
 * `firstNow` = the admin can send the first email right away (a person's send skips the marketing switch
 * and the outreach agent, never suppression, do-not-contact or the live-market rule).
 */
export async function outreachReadiness(id: string) {
  const p = await prisma.clinicProspect.findUniqueOrThrow({ where: { id } });
  const s = await getSettings();
  const blockers: string[] = [];
  const waits: string[] = [];
  if (p.clinicOrgId) blockers.push("They already have a clinic account, so they get onboarding emails instead.");
  if (!p.email) blockers.push("No email address yet.");
  if (p.doNotContact) blockers.push("Marked do not contact.");
  if (["BOUNCED", "COMPLAINED", "UNSUBSCRIBED"].includes(p.emailStatus)) blockers.push(`Email ${p.emailStatus.toLowerCase()}.`);
  if (p.email && (await isSuppressed("EMAIL", p.email))) blockers.push("This address is on the do-not-email list (unsubscribed or suppressed).");
  const professionCode = await outreachProfessionFor(p);
  if (!professionCode) blockers.push(`Clinic outreach isn't open in ${p.state}: the Growth → Expansion target must be LIVE and the marketplace open there.`);
  if (p.outreachStep > 0) waits.push(`Outreach already started (email ${p.outreachStep} of ${OUTREACH_SEQUENCE.length} sent).`);
  if (p.outreachPaused) waits.push("Outreach is paused for this clinic.");
  if (!(await marketingOn("clinic"))) waits.push("Clinic marketing is switched off (Growth → Overview), so the automatic follow-ups won't go out.");
  if (!(await agentOn("clinicOutreach"))) waits.push("The Clinic Outreach agent is off (Growth → AI Agents), so the automatic follow-ups won't go out.");
  if (s["growth.pausedOutbound"]) waits.push("Outbound is paused (PAUSE OUTBOUND).");
  if (s["growth.outreachMode"] !== "auto") waits.push("Outreach is in review mode: automatic emails wait in Approvals for a person to approve.");
  return {
    professionCode,
    blockers,
    waits,
    firstNow: !blockers.length && p.outreachStep === 0,
    automatic: !blockers.length && !waits.some((w) => !/review mode|already started/.test(w)),
  };
}

/** Send the first clinic outreach email now, as the admin (same approved wording and compliance checks). */
export async function sendFirstOutreachNow(actor: Actor, id: string) {
  requireAdmin(actor);
  const p = await prisma.clinicProspect.findUniqueOrThrow({ where: { id } });
  const ready = await outreachReadiness(id);
  if (ready.blockers.length) throw new DomainError("VALIDATION", ready.blockers[0]);
  if (p.outreachStep > 0) throw new DomainError("CONFLICT", "The first email has already gone out to this clinic.");
  const r = await recipient("PROSPECT", id);
  if (!r) throw new DomainError("VALIDATION", "This clinic can't be emailed.");
  // Personal injury practices get the PI first email when it's approved.
  const prompt = (await pickPrompt(outreachKey(0, p.practiceType, await approvedPiKeys()), ready.professionCode)) ?? (await pickPrompt(OUTREACH_SEQUENCE[0], ready.professionCode));
  if (!prompt) throw new DomainError("VALIDATION", "There's no approved first-contact email yet (Growth → Content).");
  const msg = await compose("clinicOutreach", prompt, prospectVars(p, r.firstName), { city: p.city, clinic_name: p.clinicName }, true);
  const res = await sendGrowthEmail(r, msg, { agent: "clinicOutreach", purpose: "COMMERCIAL", prompt: { key: prompt.key, version: prompt.version }, dedupeKey: `outreach:${id}:0`, createdById: actor.userId });
  if (!res.ok) throw new DomainError("VALIDATION", res.reason === "already_sent" ? "The first email has already gone out to this clinic." : `Not sent: ${res.reason}.`);
  await advanceOutreach(id);
  await audit(prisma, actor, "growth.prospect.first_email_now", "ClinicProspect", id, null, { communicationId: res.communicationId });
  return { subject: msg.subject };
}

export const HandAddInput = z.object({
  clinicName: z.string().trim().min(1, "Clinic name is required.").max(200),
  email: z.string().trim().toLowerCase().email("Enter a valid email."),
  ownerName: z.string().trim().max(160).optional().nullable(),
  city: z.string().trim().max(100).optional().nullable(),
  state: z.string().trim().toUpperCase().length(2).default("FL"),
  zip: z.string().trim().max(10).optional().nullable(),
  phone: z.string().trim().max(30).optional().nullable(),
  website: z.string().trim().max(200).optional().nullable(),
  notes: z.string().trim().max(4000).optional().nullable(),
  /** now = send the first email now; auto = the automatic sequence; save = keep, no emails. */
  start: z.enum(["now", "auto", "save"]).default("auto"),
});

/**
 * A clinic the owner saw or heard about: email + clinic name (the rest optional). Same email already
 * on the list → that clinic is returned (nothing duplicated). Then send the first email now, leave it
 * to the automatic sequence, or just save it (outreach paused).
 */
export async function addClinicByHand(actor: Actor, raw: z.input<typeof HandAddInput>) {
  requireAdmin(actor);
  const input = HandAddInput.parse(raw);
  const existing = await prisma.clinicProspect.findFirst({ where: { email: input.email } });
  if (existing) return { prospect: existing, existed: true, sent: null as null | { subject: string } | { error: string }, readiness: await outreachReadiness(existing.id) };
  const prospect = await saveProspect(actor, {
    clinicName: input.clinicName, email: input.email, ownerName: input.ownerName || null, city: input.city || null, state: input.state, zip: input.zip || null,
    phone: input.phone || null, website: input.website || null, notes: input.notes || null, source: "Added by hand",
  });
  if (input.start === "save") await prisma.clinicProspect.update({ where: { id: prospect.id }, data: { outreachPaused: true } });
  // The clinic is saved either way; a send that can't go out says why.
  const sent = input.start === "now" ? await sendFirstOutreachNow(actor, prospect.id).catch((e: Error) => ({ error: e.message })) : null;
  return { prospect, existed: false, sent, readiness: await outreachReadiness(prospect.id) };
}

/** Manual overrides of automation-owned fields (segment, stage, pause, do-not-contact). */
export async function overrideProspect(actor: Actor, id: string, o: { segment?: string; stage?: ProspectStage; outreachPaused?: boolean; doNotContact?: boolean; smsOptIn?: boolean }) {
  requireAdmin(actor);
  const p = await prisma.clinicProspect.findUniqueOrThrow({ where: { id } });
  const data: Prisma.ClinicProspectUpdateInput = {};
  if (o.segment) Object.assign(data, { segment: o.segment, segmentBasis: "MANUAL", segmentConfidence: 1, segmentReason: "Set by an admin" });
  if (o.stage) data.stage = o.stage;
  if (o.outreachPaused !== undefined) data.outreachPaused = o.outreachPaused;
  if (o.doNotContact !== undefined) { data.doNotContact = o.doNotContact; if (o.doNotContact) data.stage = "DO_NOT_CONTACT"; }
  if (o.smsOptIn) data.smsConsentAt = clock.now();
  await prisma.clinicProspect.update({ where: { id }, data });
  if (o.doNotContact && p.email) await suppress("ALL", p.email, "DO_NOT_CONTACT", `admin ${actor.userId}`);
  await audit(prisma, actor, "growth.prospect.override", "ClinicProspect", id, null, o);
  await logAgent("admin", "prospect_override", { entityType: "PROSPECT", entityId: id, humanOverrideBy: actor.userId, output: o });
}

export function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [], cell = "", quoted = false;
  for (let i = 0; i < text.length; i++) {
    const ch = text[i];
    if (quoted) {
      if (ch === '"' && text[i + 1] === '"') { cell += '"'; i++; } else if (ch === '"') quoted = false; else cell += ch;
    } else if (ch === '"') quoted = true;
    else if (ch === ",") { row.push(cell); cell = ""; }
    else if (ch === "\n" || ch === "\r") { if (ch === "\r" && text[i + 1] === "\n") i++; row.push(cell); if (row.some((c) => c.trim())) rows.push(row); row = []; cell = ""; }
    else cell += ch;
  }
  row.push(cell);
  if (row.some((c) => c.trim())) rows.push(row);
  return rows;
}

const HEADER_ALIASES: Record<string, string> = {
  clinic_name: "clinicName", name: "clinicName", clinic: "clinicName", practice: "clinicName", business_name: "clinicName",
  owner_name: "ownerName", owner: "ownerName", doctor: "ownerName", email: "email", phone: "phone", website: "website", url: "website",
  address: "address", street: "address", city: "city", county: "county", state: "state", zip: "zip", zip_code: "zip", postal_code: "zip",
  locations: "locationsCount", locations_count: "locationsCount", doctors: "providerCount", dc_count: "providerCount", provider_count: "providerCount",
  practice_type: "practiceType", type: "practiceType", ownership: "ownership", multidisciplinary: "multidisciplinary", notes: "notes", lat: "lat", lng: "lng", latitude: "lat", longitude: "lng",
};

/** CSV of public business information. Same email (or same name + ZIP) updates instead of duplicating. */
export async function importProspects(actor: Actor, csv: string, source: string) {
  requireAdmin(actor);
  if (csv.length > 5_000_000) throw new DomainError("VALIDATION", "CSV too large (5 MB max).");
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new DomainError("VALIDATION", "Paste a CSV with a header row and at least one clinic.");
  const headers = rows[0].map((h) => HEADER_ALIASES[h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "")] ?? null);
  if (!headers.includes("clinicName")) throw new DomainError("VALIDATION", 'The header row needs a clinic name column (e.g. "clinic_name" or "name").');
  let inserted = 0, updated = 0, skipped = 0;
  for (const r of rows.slice(1)) {
    const rec: Record<string, unknown> = {};
    headers.forEach((h, i) => { if (h && r[i] !== undefined && r[i].trim() !== "") rec[h] = r[i].trim(); });
    if (rec.multidisciplinary !== undefined) rec.multidisciplinary = /^(y|yes|true|1)$/i.test(String(rec.multidisciplinary));
    if (rec.ownership && !["independent", "group", "franchise", "unknown"].includes(String(rec.ownership).toLowerCase())) rec.ownership = "unknown";
    else if (rec.ownership) rec.ownership = String(rec.ownership).toLowerCase();
    const lat = rec.lat ? Number(rec.lat) : null, lng = rec.lng ? Number(rec.lng) : null;
    delete rec.lat; delete rec.lng;
    const parsed = ProspectInput.safeParse({ source, ...rec });
    if (!parsed.success) { skipped++; continue; }
    const data = { ...parsed.data, ...(await placeProspect({ lat, lng })) };
    const existing = (data.email && (await prisma.clinicProspect.findFirst({ where: { email: data.email } }))) || (data.zip ? await prisma.clinicProspect.findFirst({ where: { clinicName: data.clinicName, zip: data.zip } }) : null);
    if (existing) {
      await prisma.clinicProspect.update({ where: { id: existing.id }, data: { ...Object.fromEntries(Object.entries(data).filter(([, v]) => v !== null && v !== undefined)), verifiedAt: clock.now() } });
      updated++;
    } else {
      await prisma.clinicProspect.create({ data: { ...data, collectedAt: clock.now(), publicToken: newToken() } });
      inserted++;
    }
  }
  await logAgent("clinicProspecting", "csv_import", { humanOverrideBy: actor.userId, contextRef: source, output: `inserted ${inserted}, updated ${updated}, skipped ${skipped}` });
  return { inserted, updated, skipped };
}

/** Why a provider CSV row was skipped or its email not used (shown after an import). */
export const PROVIDER_IMPORT_REASONS: Record<string, string> = {
  bad_npi: "NPI isn't a valid number",
  no_npi_or_name: "no NPI, and no first + last name + state to look it up",
  not_in_registry: "not found in the NPI registry (or deactivated)",
  several_matches: "several people with that name in that state: add the NPI",
  not_this_profession: "the NPI isn't an individual of this profession",
  no_state: "no practice state",
  registry_unavailable: "the NPI registry didn't answer: try again later",
  on_platform: "already on the platform",
  error: "couldn't be saved",
  email_invalid: "email isn't a valid address",
  email_role_mailbox: "email is a no-reply or system mailbox",
  email_personal_freemail: "email is personal free-mail (Gmail, Yahoo…)",
  email_shared_practice_inbox: "email is a shared practice inbox, not theirs",
};

/**
 * Provider CSV import (owner request Oct 2026): each row is matched to the NPI registry (by NPI, or
 * by name + state when there's exactly one match of this profession), anyone already on the
 * platform is skipped, and an email is kept only under the same rule as contact discovery
 * (core acceptProviderEmail: their own address, or a solo owner's practice mailbox), then
 * MX-checked. Outreach still runs only where the Growth target is PRELAUNCH/LIVE.
 */
export async function importProviderProspects(actor: Actor, csv: string, source: string, professionCode = "DC") {
  requireAdmin(actor);
  if (csv.length > 5_000_000) throw new DomainError("VALIDATION", "CSV too large (5 MB max).");
  const rows = parseCsv(csv);
  if (rows.length < 2) throw new DomainError("VALIDATION", "Paste a CSV with a header row and at least one provider.");
  if (rows.length > 2001) throw new DomainError("VALIDATION", "Up to 2,000 providers per import. Split the file.");
  const headers = rows[0].map(providerImportHeader);
  if (!headers.includes("npi") && !(headers.includes("firstName") && headers.includes("lastName"))) throw new DomainError("VALIDATION", 'The header row needs an "npi" column, or "first_name" and "last_name" (plus "state").');
  const profile = await registryProfile(professionCode);
  const reg = nppesProvider();
  const out = { inserted: 0, updated: 0, withEmail: 0, emailRejected: 0, skipped: 0, reasons: {} as Record<string, number> };
  const note = (reason: string) => { out.reasons[reason] = (out.reasons[reason] ?? 0) + 1; };
  const skip = (reason: string) => { out.skipped++; note(reason); };
  for (const cells of rows.slice(1)) {
    const raw: Record<string, string> = {};
    headers.forEach((h, i) => { if (h && cells[i] !== undefined) raw[h] = cells[i]; });
    const parsed = providerImportRow(raw);
    if (!parsed.ok) { skip(parsed.reason); continue; }
    const row = parsed.row;
    try {
      let npi = row.npi;
      let rec: NppesRecord | null = null;
      if (npi && (await prisma.provider.findFirst({ where: { npi }, select: { id: true } }))) { skip("on_platform"); continue; }
      try {
        if (npi && reg.lookup) {
          rec = await reg.lookup(npi);
          if (!rec && reg.name !== "none") { skip("not_in_registry"); continue; }
        } else if (!npi) {
          const hits = reg.findPeople ? (await reg.findPeople({ firstName: row.firstName!, lastName: row.lastName!, state: row.state! })).filter((r) => r.kind === "individual" && matchesProfile(r, profile)) : [];
          if (hits.length !== 1) { skip(hits.length ? "several_matches" : "not_in_registry"); continue; }
          rec = hits[0];
          npi = rec.npi;
        }
      } catch {
        if (!npi) { skip("registry_unavailable"); continue; }
      }
      if (rec && (rec.kind !== "individual" || !matchesProfile(rec, profile))) { skip("not_this_profession"); continue; }
      if (await prisma.provider.findFirst({ where: { npi: npi! }, select: { id: true } })) { skip("on_platform"); continue; }
      const loc = rec?.location ?? null;
      const state = (row.state ?? loc?.state ?? "").toUpperCase();
      if (!state) { skip("no_state"); continue; }
      const address = row.address ?? (loc ? [loc.line1, loc.line2].filter(Boolean).join(", ") : "");
      const zip = row.zip ?? loc?.zip.replace(/\D/g, "").slice(0, 5) ?? "";
      const firstName = row.firstName ?? (rec?.firstName ? titleCase(rec.firstName) : null);
      const lastName = row.lastName ?? (rec?.lastName ? titleCase(rec.lastName) : null);
      const credential = row.credential ?? rec?.credential?.trim() ?? null;
      const name = [firstName, lastName].filter(Boolean).join(" ") || `NPI ${npi}`;
      const cand: ProviderCandidate = {
        npi: npi!, firstName, lastName, credential, displayName: `${name}${credential ? `, ${credential}` : ""}`,
        address, city: row.city ?? (loc?.city ? titleCase(loc.city) : ""), state, zip, addressKey: address ? addressKey(address.split(",")[0], zip) : `NPI-${npi}`, providersAtPractice: row.providersAtPractice ?? 1,
      };
      const before = await prisma.providerProspect.findUnique({ where: { npi: npi! }, select: { id: true } });
      await upsertProviderProspects([cand], professionCode);
      const p = await prisma.providerProspect.findUnique({ where: { npi: npi! } });
      if (!p) { skip("error"); continue; }
      if (before) out.updated++;
      else out.inserted++;
      await prisma.providerProspect.update({
        where: { id: p.id },
        data: { ...(before ? {} : { source: source.slice(0, 120) }), ...(row.practiceRole !== "UNKNOWN" ? { practiceRole: row.practiceRole } : {}), ...(row.providersAtPractice ? { providersAtPractice: row.providersAtPractice } : {}), ...(row.website && !p.website ? { website: row.website } : {}) },
      });
      if (row.email && row.email !== p.email) {
        const ok = acceptProviderEmail({ email: row.email, firstName: p.firstName, lastName: p.lastName, website: row.website ?? p.website, practiceRole: (row.practiceRole !== "UNKNOWN" ? row.practiceRole : p.practiceRole) as "OWNER" | "ASSOCIATE" | "UNKNOWN", providersAtPractice: row.providersAtPractice ?? p.providersAtPractice });
        // A verified address found by discovery is kept; the import fills empty or bad ones.
        if (ok.ok && (!p.email || p.contactStatus !== "VERIFIED")) {
          await prisma.providerProspect.update({ where: { id: p.id }, data: { email: row.email, emailOrigin: "import", emailSourceUrl: null, contactStatus: "FOUND", emailStatus: "VALID", ...(p.stage === "DISCOVERED" ? { stage: "CONTACT_FOUND" } : {}) } });
          await verifyContact(p.id);
          out.withEmail++;
        } else if (!ok.ok) {
          out.emailRejected++;
          note(`email_${ok.reason}`);
        }
      }
    } catch {
      skip("error");
    }
  }
  await logAgent("admin", "provider_csv_import", { humanOverrideBy: actor.userId, contextRef: source, output: `inserted ${out.inserted}, updated ${out.updated}, emails ${out.withEmail}, skipped ${out.skipped}` }).catch(() => undefined);
  return out;
}

export async function logReply(actor: Actor, prospectId: string, text: string, subject?: string) {
  requireAdmin(actor);
  if (!text.trim()) throw new DomainError("VALIDATION", "Paste the reply text.");
  await prisma.communication.create({ data: { entityType: "PROSPECT", entityId: prospectId, channel: "EMAIL", direction: "IN", purpose: "CONVERSATIONAL", subject: subject?.slice(0, 255) || "Reply", body: text.slice(0, 20_000), status: "RECEIVED", createdById: actor.userId } });
  return handleProspectReply(prospectId, text);
}

export async function logProviderReply(actor: Actor, id: string, text: string, subject?: string) {
  requireAdmin(actor);
  if (!text.trim()) throw new DomainError("VALIDATION", "Paste the reply text.");
  await prisma.communication.create({ data: { entityType: "PROVIDER_PROSPECT", entityId: id, channel: "EMAIL", direction: "IN", purpose: "CONVERSATIONAL", subject: subject?.slice(0, 255) || "Reply", body: text.slice(0, 20_000), status: "RECEIVED", createdById: actor.userId } });
  return handleProviderProspectReply(id, text);
}

export async function logNote(actor: Actor, prospectId: string, channel: "PHONE" | "NOTE", direction: "IN" | "OUT", text: string) {
  requireAdmin(actor);
  await prisma.communication.create({ data: { entityType: "PROSPECT", entityId: prospectId, channel, direction, purpose: "CONVERSATIONAL", subject: channel === "PHONE" ? "Phone call" : "Note", body: text.slice(0, 5000), status: "LOGGED", createdById: actor.userId } });
  if (channel === "PHONE") await prisma.clinicProspect.update({ where: { id: prospectId }, data: { lastContactedAt: clock.now() } });
}

/** A message a person writes: skips the automation pause and caps, never suppression or do-not-contact. */
export async function sendManual(actor: Actor, entityType: GrowthEntityType, entityId: string, subject: string, body: string, purpose: "COMMERCIAL" | "RELATIONSHIP") {
  requireAdmin(actor);
  const r = await recipient(entityType, entityId);
  if (!r || !subject.trim() || !body.trim()) throw new DomainError("VALIDATION", "Recipient, subject and message are required.");
  const res = await sendGrowthEmail(r, { subject: subject.trim(), body: body.trim() }, { agent: "admin", purpose, createdById: actor.userId });
  if (!res.ok) throw new DomainError("VALIDATION", res.blocked ? `Blocked by compliance: ${res.reason}` : "Send failed.");
}

// ---------------- providers pipeline ----------------

export async function providerPipeline(actor: Actor, f: { q?: string; campaign?: string } = {}) {
  requireAdmin(actor);
  const ps = await prisma.provider.findMany({
    where: { ...(f.q ? { OR: [{ legalName: { contains: f.q, mode: "insensitive" } }, { user: { email: { contains: f.q, mode: "insensitive" } } }, { school: { contains: f.q, mode: "insensitive" } }] } : {}), ...(f.campaign ? { campaignCode: f.campaign } : {}) },
    orderBy: { createdAt: "desc" },
    take: 200,
    select: { id: true },
  });
  const out = [];
  for (const { id } of ps) {
    const snap = await providerSnapshot(id);
    if (!snap) continue;
    const p = snap.provider;
    out.push({
      id, name: p.displayName, school: p.school, campaignCode: p.campaignCode, graduationDate: p.graduationDate, isStudent: p.isStudent || p.preLicensure, status: p.status,
      stage: snap.stage, message: snap.message, coverageReady: snap.coverageReady, inLaunchProfession: snap.inLaunchProfession, hasAvailability: snap.hasAvailability,
      nurtureCount: p.nurtureCount, lastNurtureAt: p.lastNurtureAt, activationCount: p.activationCount, shifts: p.stats?.completedShifts ?? 0, createdAt: p.createdAt,
    });
  }
  return out;
}

// ---------------- prompts ----------------

export async function prompts(actor: Actor) {
  requireAdmin(actor);
  await ensureGrowthDefaults();
  const rows = await prisma.promptTemplate.findMany({ orderBy: [{ key: "asc" }, { version: "desc" }] });
  const perf = new Map((await attribution()).prompts.map((p) => [`${p.key}:${p.version}`, p]));
  return rows.map((r) => ({ ...r, performance: perf.get(`${r.key}:${r.version}`) ?? null }));
}

export const PromptInput = z.object({
  key: z.string().trim().toUpperCase().regex(/^[A-Z0-9_]{3,60}$/, "Key: letters, digits and underscores."),
  /** Profession this wording is for; blank = any profession. */
  professionCode: z.string().trim().max(10).optional().nullable().transform((v) => v || null),
  agent: z.string().refine((a) => a in AGENTS, "Unknown agent."),
  channel: z.enum(["EMAIL", "SMS"]).default("EMAIL"),
  purpose: z.string().trim().min(1).max(255),
  subjectTemplate: z.string().trim().max(255).optional().nullable(),
  body: z.string().trim().min(1, "Message text is required.").max(10_000),
  instructions: z.string().trim().max(2000).optional().nullable(),
  allowedVars: z.array(z.string().trim().regex(/^[a-z0-9_]+$/)).max(30),
  abWeight: z.number().int().min(0).max(1000).default(100),
  notes: z.string().trim().max(255).optional().nullable(),
});

/** Saving never edits a version: it creates the next version as a DRAFT. */
export async function savePromptDraft(actor: Actor, raw: z.input<typeof PromptInput>) {
  requireAdmin(actor);
  const p = PromptInput.parse(raw);
  const used = [...`${p.subjectTemplate ?? ""} ${p.body}`.matchAll(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g)].map((m) => m[1]);
  const unknown = [...new Set(used.filter((v) => !p.allowedVars.includes(v)))];
  if (unknown.length) throw new DomainError("VALIDATION", `These placeholders aren't in the allowed variables: ${unknown.join(", ")}`);
  const last = await prisma.promptTemplate.findFirst({ where: { key: p.key }, orderBy: { version: "desc" } });
  const row = await prisma.promptTemplate.create({ data: { ...p, subjectTemplate: p.subjectTemplate || null, instructions: p.instructions || null, notes: p.notes || null, version: (last?.version ?? 0) + 1, status: "DRAFT", active: false } });
  await audit(prisma, actor, "growth.prompt.draft", "PromptTemplate", row.id, null, { key: row.key, version: row.version });
  return row;
}

export async function promptStatus(actor: Actor, id: string, op: "approve" | "activate" | "activate_ab" | "deactivate" | "retire" | "weight", weight?: number) {
  requireAdmin(actor);
  const p = await prisma.promptTemplate.findUniqueOrThrow({ where: { id } });
  if (op === "approve") await prisma.promptTemplate.update({ where: { id }, data: { status: "APPROVED", approvedById: actor.userId, approvedAt: clock.now() } });
  if (op === "activate" || op === "activate_ab") {
    if (p.status !== "APPROVED") throw new DomainError("VALIDATION", "Approve this version before activating it.");
    await prisma.promptTemplate.update({ where: { id }, data: { active: true } });
    // Unless A/B testing, the newly active version replaces the others.
    if (op === "activate") await prisma.promptTemplate.updateMany({ where: { key: p.key, professionCode: p.professionCode, id: { not: id } }, data: { active: false } });
  }
  if (op === "deactivate") await prisma.promptTemplate.update({ where: { id }, data: { active: false } });
  if (op === "retire") await prisma.promptTemplate.update({ where: { id }, data: { status: "RETIRED", active: false } });
  if (op === "weight") await prisma.promptTemplate.update({ where: { id }, data: { abWeight: Math.max(0, Math.round(weight ?? 100)) } });
  await audit(prisma, actor, `growth.prompt.${op}`, "PromptTemplate", id, null, { key: p.key, version: p.version, weight });
}

const SAMPLE: Record<string, string> = {
  pi_url: "https://coverageoncall.com/personal-injury-clinics",
  greeting_name: "Dr. Rivera", clinic_name: "Bayside Family Chiropractic", city: "Tampa", segment: "solo", first_name: "Jordan", state_name: "Florida", school: "Palmer College",
  checklist: "✓ Account\n✓ Clinic location\n○ Payment method", next_step: "Payment method", dates: "Oct 16–17", status_line: "Next step: add your license when it arrives.",
  travel_line: "Your maximum drive is set to 60 minutes.", market_name: "Tampa Bay", reply_summary: "Asked whether coverage costs more than closing for a day.",
};

/** Renders a version with sample values; optionally runs AI personalization so a person can judge it. */
export async function previewPrompt(actor: Actor, id: string, withAi: boolean) {
  requireAdmin(actor);
  const p = await prisma.promptTemplate.findUniqueOrThrow({ where: { id } });
  const vars: Record<string, string> = { ...SAMPLE, brand: brand().name };
  for (const v of p.allowedVars) if (v.endsWith("_url")) vars[v] = absoluteUrl(`/${v.replace(/_url$/, "")}`);
  const subject = renderTemplate(p.subjectTemplate ?? "", vars, p.allowedVars), body = renderTemplate(p.body, vars, p.allowedVars);
  if (!withAi || !p.instructions) return { subject, body, ai: null, aiError: null };
  const facts = p.allowedVars.filter((v) => ["city", "segment", "clinic_name", "school", "market_name", "reply_summary", "state_name"].includes(v)).map((v) => `- ${v}: ${vars[v]}`);
  const r = await ai("admin", "write", `${aiRules()}\nYou lightly personalize approved messages. Keep the approved meaning, structure, links and sign-off.`,
    `Approved subject:\n${subject}\n\nApproved message:\n${body}\n\nPersonalization guidance:\n${p.instructions}\n\nFacts you may use:\n${facts.join("\n") || "- none"}\n\nReturn the personalized subject and message as plain text. Keep every link exactly as written.`,
    { type: "object", properties: { subject: { type: "string" }, body: { type: "string" } }, required: ["subject", "body"], additionalProperties: false }, 1500);
  if (!r.data) return { subject, body, ai: null, aiError: r.error };
  const s2 = String(r.data.subject ?? ""), b2 = String(r.data.body ?? "");
  return { subject, body, ai: { subject: s2, body: b2, model: r.model, guardrail: validateAiCopy(body, b2, s2) }, aiError: null };
}

// ---------------- knowledge base, suppression, campaigns, markets ----------------

export async function kb(actor: Actor) {
  requireAdmin(actor);
  await ensureGrowthDefaults();
  return prisma.kbArticle.findMany({ orderBy: [{ topic: "asc" }, { createdAt: "asc" }] });
}

export async function saveKb(actor: Actor, raw: { id?: string; professionCode?: string | null; topic: string; audience: string; question: string; answer: string; keywords: string; approved: boolean; active: boolean }) {
  requireAdmin(actor);
  if (!raw.question.trim() || !raw.answer.trim()) throw new DomainError("VALIDATION", "Question and answer are required.");
  const data = { professionCode: raw.professionCode || null, topic: raw.topic.slice(0, 40), audience: ["CLINIC", "PROVIDER", "ALL"].includes(raw.audience) ? raw.audience : "ALL", question: raw.question.trim().slice(0, 255), answer: raw.answer.trim().slice(0, 4000), keywords: raw.keywords.split(",").map((k) => k.trim()).filter(Boolean).slice(0, 30), approved: raw.approved, active: raw.active, updatedById: actor.userId };
  const row = raw.id ? await prisma.kbArticle.update({ where: { id: raw.id }, data }) : await prisma.kbArticle.create({ data });
  await audit(prisma, actor, "growth.kb.saved", "KbArticle", row.id, null, { question: row.question, approved: row.approved });
}

export async function deleteKb(actor: Actor, id: string) {
  requireAdmin(actor);
  await prisma.kbArticle.delete({ where: { id } });
}

export async function suppressions(actor: Actor) {
  requireAdmin(actor);
  return prisma.commSuppression.findMany({ orderBy: { createdAt: "desc" }, take: 500 });
}

export async function addSuppression(actor: Actor, channel: "EMAIL" | "SMS" | "ALL", address: string, reason: string) {
  requireAdmin(actor);
  if (!address.trim()) throw new DomainError("VALIDATION", "Enter an email address or phone number.");
  await suppress(channel, address, reason, `admin ${actor.userId}`);
  await audit(prisma, actor, "growth.suppression.added", "CommSuppression", normEmail(address), null, { channel, reason });
}

/** Only when the person has asked to receive messages again. */
export async function removeSuppression(actor: Actor, id: string) {
  requireAdmin(actor);
  const row = await prisma.commSuppression.delete({ where: { id } });
  if (row.channel !== "SMS") await prisma.clinicProspect.updateMany({ where: { email: row.address, emailStatus: "UNSUBSCRIBED" }, data: { emailStatus: "UNKNOWN" } });
  await audit(prisma, actor, "growth.suppression.removed", "CommSuppression", id, row, null);
}

export async function campaigns(actor: Actor) {
  requireAdmin(actor);
  await ensureGrowthDefaults();
  return attribution();
}

export async function saveCampaign(actor: Actor, raw: { code: string; name: string; audience: "CLINIC" | "PROVIDER"; kind: string; schoolName?: string; headline?: string; body?: string; spendCents?: number; active?: boolean; geography?: string | null; professionCode?: string | null }) {
  requireAdmin(actor);
  const code = raw.code.trim().toLowerCase().replace(/[^a-z0-9-]/g, "");
  if (code.length < 2 || !raw.name.trim()) throw new DomainError("VALIDATION", "A short code (letters, numbers, dashes) and a name are required.");
  // /join/<code> is shared with the student path's recruitment links, so codes must be unique across both.
  if (await prisma.recruitCampaign.count({ where: { slug: code } })) throw new DomainError("CONFLICT", `"${code}" is already a recruitment link (Admin → Recruitment). Pick another code.`);
  const data = { name: raw.name.trim().slice(0, 150), audience: raw.audience, kind: raw.kind.slice(0, 20), schoolName: raw.schoolName?.trim() || null, headline: raw.headline?.trim() || null, body: raw.body?.trim() || null, spendCents: Math.max(0, Math.round(raw.spendCents ?? 0)), active: raw.active ?? true, geography: raw.geography?.trim().slice(0, 120) || null, ...(raw.professionCode ? { professionCode: raw.professionCode } : {}) };
  await prisma.growthCampaign.upsert({ where: { code }, create: { code, ...data }, update: data });
  await audit(prisma, actor, "growth.campaign.saved", "GrowthCampaign", code, null, data);
  return code;
}

/** Attribute a market's not-yet-contacted provider prospects to a campaign (e.g. "Naples emergency supply build"). */
export async function tagMarketProspects(actor: Actor, marketKey: string, campaignCode: string) {
  requireAdmin(actor);
  const c = await prisma.growthCampaign.findUnique({ where: { code: campaignCode.trim().toLowerCase() } });
  if (!c) throw new DomainError("NOT_FOUND", "No campaign with that code (create it under Campaigns first).");
  const r = await prisma.providerProspect.updateMany({ where: { marketKey, providerId: null, campaignCode: null, stage: { in: ["DISCOVERED", "CONTACT_FOUND", "CONTACT_VERIFIED"] } }, data: { campaignCode: c.code } });
  await audit(prisma, actor, "growth.market.campaign", "GrowthMarket", marketKey, null, { campaign: c.code, tagged: r.count });
  return r.count;
}

export async function markets(actor: Actor) {
  requireAdmin(actor);
  await ensureGrowthDefaults();
  return liquidity();
}

export async function saveMarket(actor: Actor, raw: { key: string; name: string; state: string; professionCode?: string; centerLat: number; centerLng: number; radiusMiles: number; targetProviders: number; priority: number; active: boolean }) {
  requireAdmin(actor);
  const key = raw.key.trim().toLowerCase().replace(/[^a-z0-9_-]/g, "");
  if (!key || !raw.name.trim() || !Number.isFinite(raw.centerLat) || !Number.isFinite(raw.centerLng)) throw new DomainError("VALIDATION", "Key, name and center coordinates are required.");
  const data = { name: raw.name.trim(), state: raw.state.toUpperCase().slice(0, 2), ...(raw.professionCode ? { professionCode: raw.professionCode } : {}), centerLat: raw.centerLat, centerLng: raw.centerLng, radiusMiles: Math.max(5, Math.round(raw.radiusMiles)), targetProviders: Math.max(0, Math.round(raw.targetProviders)), priority: Math.round(raw.priority), active: raw.active };
  await prisma.growthMarket.upsert({ where: { key }, create: { key, ...data }, update: data });
  await audit(prisma, actor, "growth.market.saved", "GrowthMarket", key, null, data);
}

// ---------------- logs ----------------

export async function activity(actor: Actor, f: { agent?: string; errors?: boolean } = {}) {
  requireAdmin(actor);
  return prisma.agentActivity.findMany({ where: { ...(f.agent ? { agent: f.agent } : {}), ...(f.errors ? { error: { not: null } } : {}) }, orderBy: { createdAt: "desc" }, take: 200 });
}

export async function communications(actor: Actor, f: { status?: string } = {}) {
  requireAdmin(actor);
  return prisma.communication.findMany({ where: f.status ? { status: f.status } : {}, orderBy: { createdAt: "desc" }, take: 200, select: { id: true, entityType: true, entityId: true, channel: true, direction: true, agent: true, purpose: true, promptKey: true, promptVersion: true, toAddress: true, subject: true, status: true, blockReason: true, error: true, createdById: true, createdAt: true } });
}

/** For the open-shift view: who is credential-eligible (getEligibleProviders, INV-1). */
export async function eligibleFor(actor: Actor, shiftId: string) {
  requireAdmin(actor);
  const set = await getEligibleProviders(prisma, shiftId);
  return set.eligible.map((e) => ({ providerId: e.providerId, name: e.provider.displayName, driveMinutes: e.drive?.minutes ?? null }));
}

export { invalidateSettings };

/** "Retry failed": failed research goes back in the queue with a fresh set of attempts. */
export async function retryFailedResearch(actor: Actor, side: "clinics" | "providers") {
  requireAdmin(actor);
  const r = side === "clinics"
    ? await prisma.clinicProspect.updateMany({ where: { researchStatus: "FAILED", clinicOrgId: null }, data: { researchStatus: "PENDING", researchAttempts: 0, researchedAt: null } })
    : await prisma.providerProspect.updateMany({ where: { researchStatus: "FAILED", providerId: null }, data: { researchStatus: "PENDING", researchAttempts: 0, researchedAt: null } });
  await logAgent("admin", "research_retry", { humanOverrideBy: actor.userId, output: `${side}: ${r.count} back in the queue` });
  return r.count;
}

/** Resume web research now (after adding credits or fixing the key). */
export async function resumeResearchNow(actor: Actor) {
  requireAdmin(actor);
  await resumeResearch();
  await logAgent("admin", "research_resumed", { humanOverrideBy: actor.userId });
}
