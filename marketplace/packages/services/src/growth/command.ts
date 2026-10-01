import { costPer, DomainError, providerFunnelStage, PROVIDER_FUNNEL, type ProviderFunnelStage } from "@cm/core";
import { prisma, type Prisma } from "@cm/db";
import { DateTime } from "luxon";
import { audit, clock, getSettings, requireAdmin, type Actor } from "../context";
import { absoluteUrl } from "../notify";
import { coverageReadyProviders, growthFunnels } from "./analytics";
import { AGENTS, agentOn, type AgentKey } from "./engine";
import { activeTargets } from "./expansion";
import { marketSupply } from "./supply";

/**
 * Growth command center: the read side of provider + clinic acquisition. Everything here is
 * computed from platform tables (agents run in the worker; this only observes them).
 * The primary measure is completed marketplace transactions, not opens or clicks.
 */
const DAY = 86_400_000;
const ZONE = "America/New_York";
const dayStart = () => DateTime.fromJSDate(clock.now(), { zone: ZONE }).startOf("day").toJSDate();
const monthStart = (d = clock.now()) => DateTime.fromJSDate(d, { zone: ZONE }).startOf("month").toJSDate();
const cents = (micro: number | null | undefined) => (micro ?? 0) / 10_000;

// ---------------- overview ----------------

export async function todayNumbers() {
  const since = dayStart();
  const sentTo = (entityType: string) => prisma.communication.groupBy({ by: ["entityId"], where: { entityType, direction: "OUT", status: "SENT", createdAt: { gte: since } } }).then((r) => r.length);
  const replies = (entityType: string) => prisma.communication.count({ where: { entityType, direction: "IN", createdAt: { gte: since } } });
  const [providerProspects, clinicProspects, providersContacted, clinicsContacted, providerReplies, clinicReplies, providerRegs, clinicRegs, readyToday, newRequests, completedToday] = await Promise.all([
    prisma.providerProspect.count({ where: { createdAt: { gte: since } } }),
    prisma.clinicProspect.count({ where: { createdAt: { gte: since } } }),
    sentTo("PROVIDER_PROSPECT"),
    sentTo("PROSPECT"),
    replies("PROVIDER_PROSPECT"),
    replies("PROSPECT"),
    prisma.provider.count({ where: { createdAt: { gte: since } } }),
    prisma.clinicOrg.count({ where: { createdAt: { gte: since } } }),
    prisma.auditLog.count({ where: { action: "provider.activated", createdAt: { gte: since } } }),
    prisma.shift.count({ where: { postedAt: { gte: since } } }),
    prisma.assignment.findMany({ where: { status: "COMPLETED", completedAt: { gte: since } }, select: { providerId: true, provider: { select: { stats: { select: { completedShifts: true } } } } } }),
  ]);
  return {
    providerProspects, clinicProspects, providersContacted, clinicsContacted, providerReplies, clinicReplies, providerRegs, clinicRegs, readyToday, newRequests,
    firstShifts: completedToday.filter((a) => (a.provider.stats?.completedShifts ?? 0) === 1).length,
  };
}

export async function needsAttention() {
  const since24 = new Date(+clock.now() - DAY);
  const [markets, providerLeads, highIntent, credentials, agentErrors, approvals, review] = await Promise.all([
    prisma.growthMarket.findMany({ where: { active: true, supplyStatus: { in: ["CRITICAL", "LOW"] } }, orderBy: [{ supplyStatus: "asc" }, { priority: "asc" }] }),
    prisma.escalation.count({ where: { status: { not: "RESOLVED" }, entityType: "PROVIDER_PROSPECT" } }),
    prisma.clinicProspect.count({ where: { intentCategory: "HIGH_INTENT", doNotContact: false } }),
    prisma.license.count({ where: { status: "PENDING_VERIFICATION" } }).then(async (n) => n + (await prisma.malpracticePolicy.count({ where: { status: "PENDING_VERIFICATION" } }))),
    prisma.agentActivity.count({ where: { error: { not: null }, createdAt: { gte: since24 } } }),
    prisma.communication.count({ where: { status: "PENDING_APPROVAL" } }),
    prisma.providerProspect.count({ where: { needsReview: true, providerId: null } }),
  ]);
  return { markets: markets.map((m) => ({ key: m.key, name: m.name, status: m.supplyStatus! })), providerLeads, highIntent, credentials, agentErrors, approvals, review };
}

// ---------------- agents ----------------

/** What each agent is waiting on (its queue), for the AI Agents board. */
async function waiting(key: AgentKey): Promise<number | null> {
  const pairs = (await activeTargets()).map((t) => ({ professionCode: t.professionCode, state: t.state }));
  switch (key) {
    case "providerDiscovery":
    case "clinicProspecting":
      return (await activeTargets()).reduce((a, t) => a + t.cities.length, 0);
    case "contactDiscovery":
      return pairs.length ? prisma.providerProspect.count({ where: { providerId: null, researchStatus: "PENDING", OR: pairs } }) : 0;
    case "providerOutreach":
      return prisma.providerProspect.count({ where: { providerId: null, contactStatus: "VERIFIED", stage: "CONTACT_VERIFIED", outreachPaused: false } });
    case "clinicOutreach":
      return prisma.clinicProspect.count({ where: { email: { not: null }, stage: { in: ["PROSPECT", "CONTACTABLE"] }, outreachStep: 0, outreachPaused: false, doNotContact: false } });
    case "clinicConversation":
    case "escalation":
      return prisma.escalation.count({ where: { status: "OPEN" } });
    case "content":
      return prisma.blogPost.count({ where: { status: "DRAFT" } });
    default:
      return null;
  }
}

const TASK_FOR: Partial<Record<AgentKey, string>> = {
  providerDiscovery: "registry (no AI)", clinicProspecting: "research", contactDiscovery: "research", providerOutreach: "write", clinicOutreach: "write", clinicConversation: "classify",
  providerRecruitment: "templates", providerCredentialing: "write", providerActivation: "write", providerReactivation: "write", analytics: "summarize", content: "blog model", matching: "rules (no AI)",
  leadScoring: "rules (no AI)", escalation: "rules (no AI)", signupRecovery: "write", clinicOnboarding: "templates",
};

export async function agentBoard() {
  const s = await getSettings();
  const since = dayStart(), since24 = new Date(+clock.now() - DAY), month = monthStart();
  const keys = Object.keys(AGENTS) as AgentKey[];
  const [today, errors, last, cost] = await Promise.all([
    prisma.agentActivity.groupBy({ by: ["agent"], where: { createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.agentActivity.groupBy({ by: ["agent"], where: { createdAt: { gte: since24 }, error: { not: null } }, _count: { _all: true } }),
    prisma.agentActivity.groupBy({ by: ["agent"], _max: { createdAt: true } }),
    prisma.aiUsage.groupBy({ by: ["agent"], where: { createdAt: { gte: month } }, _sum: { costMicroUsd: true } }),
  ]);
  const model = (k: AgentKey) => {
    const t = TASK_FOR[k] ?? "";
    if (t === "research") return `${s["growth.researchProvider"]} · ${s["growth.researchModel"]}`;
    if (t === "blog model") return `${s["blog.aiProvider"]} · ${s["blog.aiModel"]}`;
    if (["write", "classify", "summarize", "converse"].includes(t)) return `${s["growth.aiProvider"]} · ${s["growth.aiModels"][t as "write"]}`;
    return t;
  };
  const rows = [];
  for (const k of keys) {
    const agentNames = k === "content" ? ["content", "blog"] : [k];
    const sum = <T extends { agent: string }>(rs: T[], f: (r: T) => number) => rs.filter((r) => agentNames.includes(r.agent)).reduce((a, r) => a + f(r), 0);
    rows.push({
      key: k, label: AGENTS[k][0], description: AGENTS[k][1], on: await agentOn(k),
      processedToday: sum(today, (r) => r._count._all), errors24h: sum(errors, (r) => r._count._all),
      lastRun: last.filter((r) => agentNames.includes(r.agent)).map((r) => r._max.createdAt).filter(Boolean).sort((a, b) => +b! - +a!)[0] ?? null,
      waiting: await waiting(k), model: model(k), costMonthCents: cents(sum(cost, (r) => r._sum.costMicroUsd ?? 0)),
    });
  }
  return rows;
}

// ---------------- costs ----------------

const AI_CATEGORY = (agent: string, task: string) => {
  if (task === "research") return "Prospect research";
  if (agent === "blog" || agent === "content") return "Content AI";
  if (agent === "clinicConversation" || task === "converse") return "Conversation AI";
  if (agent === "clinicOutreach" || agent === "signupRecovery" || agent === "clinicOnboarding") return "Clinic outreach";
  if (agent.startsWith("provider")) return task === "classify" ? "Classification" : "Provider outreach";
  if (task === "classify") return "Classification";
  if (task === "summarize") return "Analytics";
  return "Other AI";
};

export async function aiCosts(month = monthStart()) {
  const end = DateTime.fromJSDate(month).plus({ months: 1 }).toJSDate();
  const rows = await prisma.aiUsage.groupBy({ by: ["agent", "task", "provider", "model"], where: { createdAt: { gte: month, lt: end } }, _count: { _all: true }, _sum: { costMicroUsd: true, inputTokens: true, outputTokens: true } });
  const byCategory = new Map<string, number>();
  for (const r of rows) byCategory.set(AI_CATEGORY(r.agent, r.task), (byCategory.get(AI_CATEGORY(r.agent, r.task)) ?? 0) + cents(r._sum.costMicroUsd));
  const group = (f: (r: (typeof rows)[number]) => string) => {
    const m = new Map<string, number>();
    for (const r of rows) m.set(f(r), (m.get(f(r)) ?? 0) + cents(r._sum.costMicroUsd));
    return [...m.entries()].map(([k, v]) => ({ key: k, cents: v })).sort((a, b) => b.cents - a.cents);
  };
  return {
    total: rows.reduce((a, r) => a + cents(r._sum.costMicroUsd), 0),
    byCategory: [...byCategory.entries()].map(([k, v]) => ({ key: k, cents: v })).sort((a, b) => b.cents - a.cents),
    byProvider: group((r) => r.provider), byModel: group((r) => r.model), byAgent: group((r) => r.agent), byTask: group((r) => r.task),
    calls: rows.reduce((a, r) => a + r._count._all, 0),
  };
}

export const COST_CATEGORIES = ["SEARCH_API", "BUSINESS_DATA", "EMAIL_ENRICHMENT", "EMAIL_VERIFICATION", "EMAIL_DELIVERY", "SMS", "ADVERTISING", "AI_OTHER", "REFERRAL_INCENTIVES", "OTHER"] as const;

export async function addCost(actor: Actor, input: { month: string; category: string; audience: string; amountCents: number; campaignCode?: string | null; notes?: string | null }) {
  requireAdmin(actor);
  if (!(COST_CATEGORIES as readonly string[]).includes(input.category)) throw new DomainError("VALIDATION", "Choose a category.");
  if (!/^\d{4}-\d{2}$/.test(input.month)) throw new DomainError("VALIDATION", "Choose a month.");
  if (!(input.amountCents > 0)) throw new DomainError("VALIDATION", "Enter an amount.");
  const row = await prisma.growthCost.create({
    data: { month: new Date(`${input.month}-01T00:00:00Z`), category: input.category, audience: ["PROVIDER", "CLINIC"].includes(input.audience) ? input.audience : "BOTH", amountCents: Math.round(input.amountCents), campaignCode: input.campaignCode || null, notes: input.notes?.slice(0, 255) || null, createdById: actor.userId },
  });
  await audit(prisma, actor, "growth.cost.added", "GrowthCost", row.id, null, { category: row.category, amountCents: row.amountCents });
}

export async function deleteCost(actor: Actor, id: string) {
  requireAdmin(actor);
  await prisma.growthCost.delete({ where: { id } });
  await audit(prisma, actor, "growth.cost.deleted", "GrowthCost", id, null, null);
}

/**
 * Acquisition economics (all time and this month): AI (logged per call), entered costs and
 * campaign spend, against outcomes that matter: coverage-ready and first-shift providers,
 * active clinics, completed shifts and the platform revenue they produced.
 */
export async function economics() {
  const [costs, aiAll, campaignSpend, prospects, contactable, recruitedProviders, ready, clinicsPosted, clinicsBooked, revenue] = await Promise.all([
    prisma.growthCost.groupBy({ by: ["category", "audience"], _sum: { amountCents: true } }),
    prisma.aiUsage.aggregate({ _sum: { costMicroUsd: true } }),
    prisma.growthCampaign.groupBy({ by: ["audience"], _sum: { spendCents: true } }),
    prisma.providerProspect.count(),
    prisma.providerProspect.count({ where: { contactStatus: "VERIFIED" } }),
    prisma.provider.findMany({ where: { OR: [{ growthSource: { notIn: ["organic"] } }, { campaignCode: { not: null } }], NOT: { growthSource: null } }, select: { id: true, stats: { select: { completedShifts: true } } } }),
    coverageReadyProviders(),
    prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT l."clinicOrgId") AS n FROM "Shift" s JOIN "ClinicLocation" l ON l.id = s."locationId" WHERE s."postedAt" IS NOT NULL`,
    prisma.$queryRaw<{ n: bigint }[]>`SELECT COUNT(DISTINCT l."clinicOrgId") AS n FROM "Shift" s JOIN "ClinicLocation" l ON l.id = s."locationId" WHERE s.status = 'COMPLETED'`,
    prisma.shift.aggregate({ where: { status: "COMPLETED" }, _sum: { clinicPriceCents: true, providerPayCents: true }, _count: { _all: true } }),
  ]);
  const entered = costs.reduce((a, c) => a + (c._sum.amountCents ?? 0), 0);
  const spend = campaignSpend.reduce((a, c) => a + (c._sum.spendCents ?? 0), 0);
  const ai = cents(aiAll._sum.costMicroUsd);
  const providerSide = costs.filter((c) => c.audience !== "CLINIC").reduce((a, c) => a + (c._sum.amountCents ?? 0), 0) + (campaignSpend.find((c) => c.audience === "PROVIDER")?._sum.spendCents ?? 0);
  const clinicSide = costs.filter((c) => c.audience !== "PROVIDER").reduce((a, c) => a + (c._sum.amountCents ?? 0), 0) + (campaignSpend.find((c) => c.audience === "CLINIC")?._sum.spendCents ?? 0);
  const total = Math.round(entered + spend + ai);
  const recruitedIds = new Set(recruitedProviders.map((p) => p.id));
  const readyRecruited = ready.filter((p) => recruitedIds.has(p.id)).length;
  const firstShift = recruitedProviders.filter((p) => (p.stats?.completedShifts ?? 0) >= 1).length;
  const platformRevenue = (revenue._sum.clinicPriceCents ?? 0) - (revenue._sum.providerPayCents ?? 0);
  return {
    totals: { totalCents: total, aiCents: Math.round(ai), enteredCents: entered, campaignSpendCents: spend },
    byCategory: costs.map((c) => ({ category: c.category, audience: c.audience, cents: c._sum.amountCents ?? 0 })),
    outcomes: { prospects, contactable, registrations: recruitedProviders.length, coverageReady: readyRecruited, firstShift, activeClinics: Number(clinicsBooked[0]?.n ?? 0), firstRequests: Number(clinicsPosted[0]?.n ?? 0), completedShifts: revenue._count._all, platformRevenueCents: platformRevenue },
    per: {
      prospect: costPer(total, prospects), contactable: costPer(total, contactable), registration: costPer(total, recruitedProviders.length), coverageReady: costPer(providerSide + ai / 2, readyRecruited),
      firstShiftProvider: costPer(providerSide + ai / 2, firstShift), activeClinic: costPer(clinicSide + ai / 2, Number(clinicsBooked[0]?.n ?? 0)), firstRequest: costPer(clinicSide + ai / 2, Number(clinicsPosted[0]?.n ?? 0)),
      cac: costPer(total, readyRecruited + Number(clinicsBooked[0]?.n ?? 0)),
    },
    costs: await prisma.growthCost.findMany({ orderBy: [{ month: "desc" }, { createdAt: "desc" }], take: 100 }),
  };
}

// ---------------- attribution ----------------

/** Source → registration → coverage-ready → first shift → completed shifts (transactions) and revenue. */
export async function attributionDetail() {
  const providers = await prisma.provider.findMany({
    select: { id: true, growthSource: true, campaignCode: true, createdAt: true, stats: { select: { completedShifts: true } }, displayName: true },
  });
  const readyIds = new Set((await coverageReadyProviders()).map((p) => p.id));
  const done = await prisma.assignment.groupBy({ by: ["providerId"], where: { status: "COMPLETED" }, _count: { _all: true }, _sum: { providerPayCents: true } });
  const shiftsBy = new Map(done.map((d) => [d.providerId, d._count._all]));
  const takeBy = new Map((await prisma.$queryRaw<{ pid: string; take: bigint }[]>`SELECT a."providerId"::text AS pid, SUM(s."clinicPriceCents" - s."providerPayCents")::bigint AS take FROM "Assignment" a JOIN "Shift" s ON s.id = a."shiftId" WHERE a.status = 'COMPLETED' GROUP BY 1`).map((r) => [r.pid, Number(r.take)]));
  const bucket = (key: (p: (typeof providers)[number]) => string) => {
    const m = new Map<string, { key: string; registered: number; coverageReady: number; firstShift: number; completedShifts: number; revenueCents: number }>();
    for (const p of providers) {
      const k = key(p);
      const row = m.get(k) ?? { key: k, registered: 0, coverageReady: 0, firstShift: 0, completedShifts: 0, revenueCents: 0 };
      row.registered++;
      if (readyIds.has(p.id)) row.coverageReady++;
      if ((p.stats?.completedShifts ?? 0) >= 1) row.firstShift++;
      row.completedShifts += shiftsBy.get(p.id) ?? 0;
      row.revenueCents += takeBy.get(p.id) ?? 0;
      m.set(k, row);
    }
    return [...m.values()].sort((a, b) => b.completedShifts - a.completedShifts || b.registered - a.registered);
  };
  // Clinic side: prospects that became accounts (our outreach / prospecting) vs everyone else.
  const linked = await prisma.clinicProspect.findMany({ where: { clinicOrgId: { not: null } }, select: { clinicOrgId: true, source: true, campaignCode: true } });
  const clinicSource = new Map(linked.map((l) => [l.clinicOrgId!, l.campaignCode ? `campaign:${l.campaignCode}` : l.source === "NPPES NPI registry" ? "ai_prospecting" : (l.source ?? "crm")]));
  const clinicRows = await prisma.$queryRaw<{ org: string; posted: bigint; completed: bigint; take: bigint }[]>`
    SELECT l."clinicOrgId"::text AS org, COUNT(*) FILTER (WHERE s."postedAt" IS NOT NULL) AS posted, COUNT(*) FILTER (WHERE s.status = 'COMPLETED') AS completed,
      COALESCE(SUM(s."clinicPriceCents" - s."providerPayCents") FILTER (WHERE s.status = 'COMPLETED'), 0)::bigint AS take
    FROM "Shift" s JOIN "ClinicLocation" l ON l.id = s."locationId" GROUP BY 1`;
  const orgs = await prisma.clinicOrg.findMany({ select: { id: true } });
  const clinicBy = new Map<string, { key: string; accounts: number; requesting: number; requests: number; completedShifts: number; repeat: number; revenueCents: number }>();
  for (const o of orgs) {
    const k = clinicSource.get(o.id) ?? "organic";
    const r = clinicRows.find((x) => x.org === o.id);
    const row = clinicBy.get(k) ?? { key: k, accounts: 0, requesting: 0, requests: 0, completedShifts: 0, repeat: 0, revenueCents: 0 };
    row.accounts++;
    if (r && Number(r.posted) > 0) row.requesting++;
    row.requests += Number(r?.posted ?? 0);
    row.completedShifts += Number(r?.completed ?? 0);
    if (Number(r?.completed ?? 0) >= 2) row.repeat++;
    row.revenueCents += Number(r?.take ?? 0);
    clinicBy.set(k, row);
  }
  return {
    providerBySource: bucket((p) => p.growthSource ?? "organic"),
    providerByCampaign: bucket((p) => p.campaignCode ?? "(none)").filter((r) => r.key !== "(none)"),
    clinicBySource: [...clinicBy.values()].sort((a, b) => b.completedShifts - a.completedShifts || b.accounts - a.accounts),
    journeys: await recruitedJourneys(),
  };
}

/** Recent recruited providers: source → first touch → registration → coverage-ready → first shift. */
async function recruitedJourneys(limit = 25) {
  const rows = await prisma.providerProspect.findMany({ where: { providerId: { not: null } }, orderBy: { registeredAt: "desc" }, take: limit });
  const out = [];
  for (const r of rows) {
    const [firstTouch, ready, firstShift] = await Promise.all([
      prisma.communication.findFirst({ where: { entityType: "PROVIDER_PROSPECT", entityId: r.id, direction: "OUT", status: "SENT" }, orderBy: { createdAt: "asc" }, select: { promptKey: true, createdAt: true } }),
      prisma.auditLog.findFirst({ where: { action: "provider.activated", entityId: r.providerId! }, orderBy: { createdAt: "asc" }, select: { createdAt: true } }),
      prisma.assignment.findFirst({ where: { providerId: r.providerId!, status: "COMPLETED" }, orderBy: { startsAt: "asc" }, select: { startsAt: true } }),
    ]);
    out.push({ id: r.id, providerId: r.providerId!, name: r.displayName, source: "AI prospecting", campaign: r.campaignCode, firstTouch: firstTouch?.promptKey ?? null, firstTouchAt: firstTouch?.createdAt ?? null, registeredAt: r.registeredAt, coverageReadyAt: ready?.createdAt ?? null, firstShiftAt: firstShift?.startsAt ?? null });
  }
  return out;
}

// ---------------- provider funnel ----------------

export interface ProviderFilter {
  state?: string; market?: string; county?: string; zip?: string; profession?: string; source?: string; school?: string; campaign?: string;
  credential?: string; recruitment?: string; ready?: string; firstShift?: string; activity?: string;
}

/**
 * Full provider funnel: discovered prospects through registered providers, with filters.
 * A registered provider counts once (their prospect row, if any, is folded into them).
 */
export async function providerFunnel(f: ProviderFilter = {}) {
  const now = clock.now();
  const prospectWhere: Prisma.ProviderProspectWhereInput = {
    providerId: null,
    ...(f.state ? { state: f.state } : {}), ...(f.market ? { marketKey: f.market } : {}), ...(f.zip ? { zip: { startsWith: f.zip } } : {}), ...(f.profession ? { professionCode: f.profession } : {}),
    ...(f.campaign ? { campaignCode: f.campaign } : {}), ...(f.recruitment ? { stage: f.recruitment } : {}),
  };
  const includeProspects = !f.source || f.source === "ai_prospecting";
  const noProspectFilters = !f.school && !f.credential && !f.ready && !f.firstShift && !f.activity && !f.county;
  const prospects = includeProspects && noProspectFilters ? await prisma.providerProspect.groupBy({ by: ["stage"], where: prospectWhere, _count: { _all: true } }) : [];
  const providerWhere: Prisma.ProviderWhereInput = {
    status: { notIn: ["DEACTIVATED"] },
    ...(f.state ? { OR: [{ homeState: f.state }, { licenses: { some: { state: f.state } } }, { intendedStates: { has: f.state } }] } : {}),
    ...(f.county ? { homeCounty: { contains: f.county, mode: "insensitive" } } : {}), ...(f.zip ? { homeZip: { startsWith: f.zip } } : {}),
    ...(f.profession ? { professions: { some: { professionCode: f.profession } } } : {}), ...(f.source ? { growthSource: f.source } : {}),
    ...(f.school ? { school: { contains: f.school, mode: "insensitive" } } : {}), ...(f.campaign ? { campaignCode: f.campaign } : {}),
    ...(f.credential === "pending" ? { licenses: { some: { status: "PENDING_VERIFICATION" } } } : f.credential === "verified" ? { licenses: { some: { status: "VERIFIED" } } } : f.credential === "none" ? { licenses: { none: {} } } : {}),
    ...(f.activity === "active90" ? { stats: { lastShiftAt: { gte: new Date(+now - 90 * DAY) } } } : f.activity === "inactive" ? { OR: [{ stats: null }, { stats: { lastShiftAt: null } }, { stats: { lastShiftAt: { lt: new Date(+now - 90 * DAY) } } }] } : {}),
  };
  const providers = await prisma.provider.findMany({ where: providerWhere, select: { id: true, homeLat: true, homeLng: true, stats: { select: { completedShifts: true } }, professions: { select: { professionCode: true } } } });
  const readyIds = new Set((await coverageReadyProviders(f.profession && f.state ? { professionCode: f.profession, state: f.state } : undefined)).map((p) => p.id));
  let market: { lat: number; lng: number; r: number } | null = null;
  if (f.market) {
    const m = await prisma.growthMarket.findUnique({ where: { key: f.market } });
    if (m) market = { lat: m.centerLat, lng: m.centerLng, r: m.radiusMiles };
  }
  const { haversineMiles } = await import("@cm/integrations");
  const counts = Object.fromEntries(PROVIDER_FUNNEL.map((s) => [s, 0])) as Record<ProviderFunnelStage, number>;
  for (const p of prospects) counts[providerFunnelStage({ prospectStage: p.stage as never })] += p._count._all;
  for (const p of providers) {
    if (market && (p.homeLat == null || p.homeLng == null || haversineMiles({ lat: p.homeLat, lng: p.homeLng }, market) > market.r)) continue;
    const ready = readyIds.has(p.id), shifts = p.stats?.completedShifts ?? 0;
    if (f.ready === "yes" && !ready) continue;
    if (f.ready === "no" && ready) continue;
    if (f.firstShift === "yes" && shifts < 1) continue;
    if (f.firstShift === "no" && shifts >= 1) continue;
    counts[providerFunnelStage({ registered: true, coverageReady: ready, completedShifts: shifts })]++;
  }
  // Cumulative: each step includes everyone who got further.
  const steps = PROVIDER_FUNNEL.map((s, i) => ({ stage: s, label: s.replace(/_/g, " ").toLowerCase().replace(/^./, (c) => c.toUpperCase()), count: PROVIDER_FUNNEL.slice(i).reduce((a, k) => a + counts[k], 0), atStage: counts[s] }));
  return { steps, prospectsIncluded: includeProspects && noProspectFilters };
}

// ---------------- prospecting workspace (providers) ----------------

export async function providerProspects(actor: Actor, f: { q?: string; status?: string; state?: string; profession?: string; market?: string; skip?: number } = {}) {
  requireAdmin(actor);
  const status: Record<string, Prisma.ProviderProspectWhereInput> = {
    new: { researchStatus: "PENDING", providerId: null },
    researching: { researchStatus: "RUNNING" },
    practice_found: { clinicProspectId: { not: null }, contactStatus: "NONE" },
    contact_found: { contactStatus: "FOUND" },
    contact_verified: { contactStatus: "VERIFIED", providerId: null },
    no_contact: { researchStatus: { in: ["NOT_FOUND", "DONE"] }, contactStatus: "NONE" },
    ambiguous: { researchStatus: "AMBIGUOUS" },
    needs_review: { needsReview: true },
    ready: { contactStatus: "VERIFIED", stage: "CONTACT_VERIFIED", providerId: null, outreachPaused: false, doNotContact: false },
    contacted: { stage: { in: ["CONTACTED", "ENGAGED"] } },
    registered: { providerId: { not: null } },
    suppressed: { OR: [{ doNotContact: true }, { emailStatus: { not: "VALID" } }] },
  };
  const where: Prisma.ProviderProspectWhereInput = {
    ...(f.q ? { OR: ["displayName", "email", "city", "zip", "npi"].map((k) => ({ [k]: { contains: f.q, mode: "insensitive" } })) } : {}),
    ...(f.status && status[f.status] ? status[f.status] : {}),
    ...(f.state ? { state: f.state } : {}), ...(f.profession ? { professionCode: f.profession } : {}), ...(f.market ? { marketKey: f.market } : {}),
  };
  const [rows, total, counts] = await Promise.all([
    prisma.providerProspect.findMany({ where, orderBy: [{ needsReview: "desc" }, { updatedAt: "desc" }], take: 100, skip: f.skip ?? 0 }),
    prisma.providerProspect.count({ where }),
    Promise.all(Object.entries(status).map(async ([k, w]) => [k, await prisma.providerProspect.count({ where: w })] as const)),
  ]);
  return { rows, total, counts: Object.fromEntries(counts) as Record<string, number> };
}

const nextAction = (p: { providerId: string | null; doNotContact: boolean; needsReview: boolean; contactStatus: string; researchStatus: string; stage: string; outreachPaused: boolean }) =>
  p.providerId ? "Registered: onboarding" : p.doNotContact ? "Do not contact" : p.needsReview ? "Review" : p.researchStatus === "PENDING" ? "Contact discovery" : p.contactStatus === "FOUND" ? "Verify email" :
    p.contactStatus === "VERIFIED" && p.stage === "CONTACT_VERIFIED" ? (p.outreachPaused ? "Paused" : "Recruitment email") : p.stage === "CONTACTED" ? "Follow-up / wait" : p.stage === "ENGAGED" ? "Personal reply" : p.contactStatus === "NONE" ? "No contact found" : "—";
export { nextAction as providerProspectNextAction };

export async function providerProspect(actor: Actor, id: string) {
  requireAdmin(actor);
  const p = await prisma.providerProspect.findUnique({ where: { id } });
  if (!p) return null;
  const [practice, comms, activity, provider] = await Promise.all([
    p.clinicProspectId ? prisma.clinicProspect.findUnique({ where: { id: p.clinicProspectId } }) : null,
    prisma.communication.findMany({ where: { entityType: "PROVIDER_PROSPECT", entityId: id }, orderBy: { createdAt: "desc" }, take: 50 }),
    prisma.agentActivity.findMany({ where: { entityType: "PROVIDER_PROSPECT", entityId: id }, orderBy: { createdAt: "desc" }, take: 30 }),
    p.providerId ? prisma.provider.findUnique({ where: { id: p.providerId }, select: { id: true, displayName: true, status: true } }) : null,
  ]);
  return { p, practice, comms, activity, provider, next: nextAction(p) };
}

/** Admin corrections: approve/correct the email, suppress, clear review, re-run research. */
export async function updateProviderProspect(actor: Actor, id: string, patch: { email?: string | null; doNotContact?: boolean; clearReview?: boolean; outreachPaused?: boolean; notes?: string | null; campaignCode?: string | null; practiceRole?: string }) {
  requireAdmin(actor);
  const before = await prisma.providerProspect.findUniqueOrThrow({ where: { id } });
  const data: Prisma.ProviderProspectUpdateInput = {};
  if (patch.email !== undefined) {
    const e = patch.email?.trim().toLowerCase() || null;
    if (e && !/^[^\s@]+@[^\s@]+\.[a-z]{2,}$/i.test(e)) throw new DomainError("VALIDATION", "Enter a valid email address.");
    Object.assign(data, { email: e, emailOrigin: e ? "manual" : null, contactStatus: e ? "FOUND" : "NONE", emailVerifiedAt: null, needsReview: false, reviewReason: null, ...(e && ["DISCOVERED"].includes(before.stage) ? { stage: "CONTACT_FOUND" } : {}) });
  }
  if (patch.doNotContact !== undefined) Object.assign(data, { doNotContact: patch.doNotContact, ...(patch.doNotContact ? { stage: "DO_NOT_CONTACT", outreachPaused: true } : {}) });
  if (patch.clearReview) Object.assign(data, { needsReview: false, reviewReason: null, ...(before.researchStatus === "AMBIGUOUS" ? { researchStatus: "DONE" } : {}) });
  if (patch.outreachPaused !== undefined) data.outreachPaused = patch.outreachPaused;
  if (patch.notes !== undefined) data.notes = patch.notes?.slice(0, 2000) || null;
  if (patch.campaignCode !== undefined) data.campaignCode = patch.campaignCode || null;
  if (patch.practiceRole && ["OWNER", "ASSOCIATE", "UNKNOWN"].includes(patch.practiceRole)) data.practiceRole = patch.practiceRole;
  await prisma.providerProspect.update({ where: { id }, data });
  if (patch.email) {
    const { verifyContact } = await import("./providers");
    await verifyContact(id);
  }
  if (patch.doNotContact && before.email) {
    const { suppress } = await import("./engine");
    await suppress("EMAIL", before.email, "DO_NOT_CONTACT", "admin");
  }
  await audit(prisma, actor, "growth.provider_prospect.updated", "ProviderProspect", id, { email: before.email, stage: before.stage }, patch);
}

/** Merge a duplicate prospect into another (keeps the target's data; fills its gaps). */
export async function mergeProviderProspects(actor: Actor, keepId: string, dropId: string) {
  requireAdmin(actor);
  if (keepId === dropId) throw new DomainError("VALIDATION", "Choose two different prospects.");
  const [keep, drop] = await Promise.all([prisma.providerProspect.findUniqueOrThrow({ where: { id: keepId } }), prisma.providerProspect.findUniqueOrThrow({ where: { id: dropId } })]);
  await prisma.providerProspect.update({
    where: { id: keepId },
    data: { email: keep.email ?? drop.email, website: keep.website ?? drop.website, notes: [keep.notes, drop.notes, `Merged ${drop.displayName} (NPI ${drop.npi})`].filter(Boolean).join("\n").slice(0, 2000), sourceUrls: [...new Set([...keep.sourceUrls, ...drop.sourceUrls])].slice(0, 12) },
  });
  await prisma.communication.updateMany({ where: { entityType: "PROVIDER_PROSPECT", entityId: dropId }, data: { entityId: keepId } });
  await prisma.providerProspect.delete({ where: { id: dropId } });
  await audit(prisma, actor, "growth.provider_prospect.merged", "ProviderProspect", keepId, null, { dropped: dropId });
}

// ---------------- schools ----------------

/** School recruiting funnel: leads → graduates → licensed → insured → coverage-ready → first shift → repeat. */
export async function schoolFunnel() {
  const now = clock.now();
  const schools = await prisma.school.findMany({ where: { active: true }, select: { name: true, professionCode: true } });
  const providers = await prisma.provider.findMany({
    where: { school: { not: null } },
    select: { id: true, school: true, graduationDate: true, preLicensure: true, isStudent: true, stats: { select: { completedShifts: true } }, licenses: { where: { status: "VERIFIED" }, select: { id: true } }, malpractice: { where: { status: "VERIFIED" }, select: { id: true } } },
  });
  const readyIds = new Set((await coverageReadyProviders()).map((p) => p.id));
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z]/g, "");
  const known = schools.map((s) => ({ ...s, n: norm(s.name) }));
  const nameFor = (raw: string) => {
    const n = norm(raw);
    return known.find((k) => k.n === n || (n.length > 4 && (k.n.includes(n) || n.includes(k.n))))?.name ?? raw.trim();
  };
  const m = new Map<string, { school: string; leads: number; graduates: number; licensed: number; insured: number; coverageReady: number; firstShift: number; repeat: number }>();
  for (const p of providers) {
    const k = nameFor(p.school!);
    const row = m.get(k) ?? { school: k, leads: 0, graduates: 0, licensed: 0, insured: 0, coverageReady: 0, firstShift: 0, repeat: 0 };
    row.leads++;
    if (!p.graduationDate || p.graduationDate <= now) row.graduates++;
    if (p.licenses.length) row.licensed++;
    if (p.malpractice.length) row.insured++;
    if (readyIds.has(p.id)) row.coverageReady++;
    if ((p.stats?.completedShifts ?? 0) >= 1) row.firstShift++;
    if ((p.stats?.completedShifts ?? 0) >= 2) row.repeat++;
    m.set(k, row);
  }
  return [...m.values()].sort((a, b) => b.leads - a.leads);
}

// ---------------- content ----------------

/** Blog performance: views, CTA clicks and the signups/transactions from visitors who read a post. */
export async function contentStats() {
  const since = new Date(+clock.now() - 90 * DAY);
  const [posts, views, ctas] = await Promise.all([
    prisma.blogPost.findMany({ orderBy: [{ status: "asc" }, { updatedAt: "desc" }], take: 100, select: { id: true, slug: true, title: true, status: true, audience: true, publishedAt: true, aiGenerated: true, description: true, updatedAt: true } }),
    prisma.analyticsEvent.groupBy({ by: ["path"], where: { type: "PAGE_VIEW", path: { startsWith: "/blog/" }, createdAt: { gte: since } }, _count: { _all: true } }),
    prisma.analyticsEvent.groupBy({ by: ["path"], where: { type: "CTA_CLICK", path: { startsWith: "/blog" }, createdAt: { gte: since } }, _count: { _all: true } }),
  ]);
  const readers = await prisma.analyticsEvent.findMany({ where: { type: "PAGE_VIEW", path: { startsWith: "/blog" }, visitorId: { not: null }, createdAt: { gte: since } }, select: { visitorId: true, path: true }, distinct: ["visitorId", "path"] });
  const readerIds = [...new Set(readers.map((r) => r.visitorId!))];
  const signups = readerIds.length ? await prisma.analyticsEvent.findMany({ where: { type: "SIGNUP", visitorId: { in: readerIds } }, select: { visitorId: true, userId: true, props: true } }) : [];
  const userIds = signups.map((s) => s.userId).filter((x): x is string => !!x);
  const [provs, members] = await Promise.all([
    prisma.provider.findMany({ where: { userId: { in: userIds } }, select: { id: true, stats: { select: { completedShifts: true } } } }),
    prisma.clinicMember.findMany({ where: { userId: { in: userIds } }, select: { clinicOrgId: true } }),
  ]);
  const orgIds = [...new Set(members.map((m) => m.clinicOrgId))];
  const [requests, completed] = orgIds.length
    ? await Promise.all([
      prisma.shift.count({ where: { location: { clinicOrgId: { in: orgIds } }, postedAt: { not: null } } }),
      prisma.shift.count({ where: { location: { clinicOrgId: { in: orgIds } }, status: "COMPLETED" } }),
    ])
    : [0, 0];
  const viewBy = new Map(views.map((v) => [v.path, v._count._all]));
  const ctaBy = new Map(ctas.map((v) => [v.path, v._count._all]));
  const totalViews = views.reduce((a, v) => a + v._count._all, 0);
  const byAudience = (aud: string) => posts.filter((p) => p.audience === aud).reduce((a, p) => a + (viewBy.get(`/blog/${p.slug}`) ?? 0), 0);
  return {
    posts: posts.map((p) => ({ ...p, views: viewBy.get(`/blog/${p.slug}`) ?? 0, ctaClicks: ctaBy.get(`/blog/${p.slug}`) ?? 0 })),
    counts: { drafts: posts.filter((p) => p.status === "DRAFT").length, published: posts.filter((p) => p.status === "PUBLISHED").length, archived: posts.filter((p) => p.status === "ARCHIVED").length },
    traffic: { views: totalViews, providerViews: byAudience("PROVIDER"), clinicViews: byAudience("CLINIC"), readers: readerIds.length, ctaClicks: ctas.reduce((a, v) => a + v._count._all, 0) },
    outcomes: {
      registrations: signups.length, providerRegistrations: provs.length, clinicRegistrations: orgIds.length, coverageRequests: requests, completedBookings: completed,
      providerFirstShifts: provs.filter((p) => (p.stats?.completedShifts ?? 0) >= 1).length,
    },
  };
}

/** Reuse an approved (published) post: knowledge-base draft, email prompt draft, or a social snippet. */
export async function repurposePost(actor: Actor, postId: string, target: "kb" | "email" | "social") {
  requireAdmin(actor);
  const p = await prisma.blogPost.findUniqueOrThrow({ where: { id: postId } });
  if (p.status !== "PUBLISHED") throw new DomainError("VALIDATION", "Publish the post first; only approved content is reused.");
  const url = absoluteUrl(`/blog/${p.slug}`);
  if (target === "social") return { text: `${p.title}\n\n${p.description}\n\n${url}` };
  if (target === "kb") {
    const row = await prisma.kbArticle.create({ data: { topic: "marketing", audience: p.audience === "PROVIDER" ? "PROVIDER" : p.audience === "CLINIC" ? "CLINIC" : "ALL", question: p.title.slice(0, 255), answer: `${p.description}\n\nMore: ${url}`.slice(0, 4000), keywords: p.keywords.slice(0, 30), approved: false, active: false, updatedById: actor.userId } });
    await audit(prisma, actor, "growth.content.to_kb", "KbArticle", row.id, null, { postId });
    return { id: row.id, text: "Saved as an unapproved knowledge-base article (Growth → Knowledge base) for review." };
  }
  const key = `CONTENT_${p.slug.toUpperCase().replace(/[^A-Z0-9]+/g, "_").slice(0, 50)}`;
  const last = await prisma.promptTemplate.findFirst({ where: { key }, orderBy: { version: "desc" } });
  const row = await prisma.promptTemplate.create({
    data: {
      key, version: (last?.version ?? 0) + 1, agent: p.audience === "CLINIC" ? "clinicOutreach" : "providerReactivation", channel: "EMAIL", purpose: `Share the article "${p.title}".`,
      subjectTemplate: p.title.slice(0, 255), body: `Hi {{greeting_name}},\n\n${p.description}\n\nRead it here: ${url}\n\nThe {{brand}} team`, instructions: null, allowedVars: ["greeting_name", "brand"],
      status: "DRAFT", active: false, notes: `From blog post ${p.slug}`,
    },
  });
  await audit(prisma, actor, "growth.content.to_email", "PromptTemplate", row.id, null, { postId });
  return { id: row.id, text: "Saved as a draft email under Prompts for review." };
}

// ---------------- activity feed ----------------

const QUIET = new Set(["sweep", "send_blocked", "no_approved_prompt"]);

/** Recent agent activity plus marketplace milestones, newest first. */
export async function activityFeed(f: { agent?: string; kind?: string; limit?: number } = {}) {
  const limit = f.limit ?? 60;
  const agentRows = f.kind === "milestones" ? [] : await prisma.agentActivity.findMany({
    where: { ...(f.agent ? { agent: f.agent } : {}), action: { notIn: [...QUIET] }, ...(f.kind === "errors" ? { error: { not: null } } : {}) },
    orderBy: { createdAt: "desc" }, take: limit,
  });
  const milestones = f.agent || f.kind === "errors" ? [] : await prisma.auditLog.findMany({ where: { action: { in: ["provider.activated", "user.signup"] } }, orderBy: { createdAt: "desc" }, take: 30 });
  const completed = f.agent || f.kind === "errors" ? [] : await prisma.assignment.findMany({ where: { status: "COMPLETED", completedAt: { not: null } }, orderBy: { completedAt: "desc" }, take: 20, select: { completedAt: true, providerId: true, provider: { select: { displayName: true, stats: { select: { completedShifts: true } } } } } });
  const recruited = new Set((await prisma.providerProspect.findMany({ where: { providerId: { in: completed.map((c) => c.providerId) } }, select: { providerId: true } })).map((p) => p.providerId));
  const names = new Map((await prisma.provider.findMany({ where: { id: { in: milestones.filter((m) => m.action === "provider.activated").map((m) => m.entityId) } }, select: { id: true, displayName: true } })).map((p) => [p.id, p.displayName]));
  const text = (a: (typeof agentRows)[number]) => {
    const out = a.output && !a.output.startsWith("{") ? a.output : null;
    switch (a.action) {
      case "discovery": return `${AGENTS[a.agent as AgentKey]?.[0] ?? a.agent}: ${out ?? "registry search"} (${a.contextRef ?? ""})`;
      case "supply_status": return out ?? "Market supply changed";
      case "registered": return out ?? "A provider registered";
      case "send_email": return `${AGENTS[a.agent as AgentKey]?.[0] ?? a.agent} sent ${a.promptKey ?? "an email"}${a.sendStatus && a.sendStatus !== "sent" ? ` (${a.sendStatus})` : ""}`;
      case "draft_for_approval": return `${AGENTS[a.agent as AgentKey]?.[0] ?? a.agent} drafted ${a.promptKey ?? "an email"} for approval`;
      case "contact_found": return `Contact Discovery found a professional email (${out ?? ""})`;
      default: return `${AGENTS[a.agent as AgentKey]?.[0] ?? a.agent}: ${a.action.replace(/_/g, " ")}${out ? ` — ${out.slice(0, 140)}` : ""}`;
    }
  };
  const items = [
    ...agentRows.map((a) => ({ at: a.createdAt, agent: a.agent, kind: a.error ? "error" : "agent", text: text(a), error: a.error, link: a.entityType === "PROVIDER_PROSPECT" ? `/admin/growth/prospects/providers/${a.entityId}` : a.entityType === "PROSPECT" ? `/admin/growth/prospects/${a.entityId}` : null })),
    ...milestones.map((m) => ({ at: m.createdAt, agent: "marketplace", kind: "milestone", error: null, link: m.action === "provider.activated" ? `/admin/providers/${m.entityId}` : null, text: m.action === "provider.activated" ? `${names.get(m.entityId) ?? "A provider"} became coverage-ready` : `New ${(m.after as { role?: string } | null)?.role === "PROVIDER" ? "provider" : "account"} registered` })),
    ...completed.filter((c) => (c.provider.stats?.completedShifts ?? 0) <= 1).map((c) => ({ at: c.completedAt!, agent: "marketplace", kind: "milestone", error: null, link: `/admin/providers/${c.providerId}`, text: `First shift completed by ${c.provider.displayName}${recruited.has(c.providerId) ? " (recruited provider)" : ""}` })),
  ];
  return items.sort((a, b) => +b.at - +a.at).slice(0, limit);
}

/** Clinic acquisition funnel (prospect → repeat clinic). */
export async function clinicFunnel() {
  return (await growthFunnels()).clinic;
}

export async function supplyAndDemand() {
  return marketSupply();
}

/** Switch states for the Growth pages (agent defaults filled in for agents added later). */
export async function overviewSettings() {
  const s = await getSettings(undefined, true);
  const agents = Object.fromEntries(await Promise.all((Object.keys(AGENTS) as AgentKey[]).map(async (k) => [k, await agentOn(k)] as const))) as Record<AgentKey, boolean>;
  return {
    paused: s["growth.pausedOutbound"], providerMarketing: s["growth.providerMarketing"], clinicMarketing: s["growth.clinicMarketing"],
    outreachMode: s["growth.outreachMode"], providerOutreachMode: s["growth.providerOutreachMode"], postalAddress: s["growth.postalAddress"], agents,
  };
}
