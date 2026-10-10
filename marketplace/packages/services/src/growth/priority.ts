import { CASL_CONSENT_BASES, DomainError, priorityRank, resolvePriority, sideSplit, type Side } from "@cm/core";
import { prisma } from "@cm/db";
import { DateTime } from "luxon";
import { audit, clock, getSettings, requireAdmin, type Actor } from "../context";
import { activeTargets } from "./expansion";

/**
 * Geographic acquisition priorities (core/acquisition.ts) for the existing Growth agents: which side
 * of the marketplace a market works first. Settings growth.acquisitionPriorities (country / state /
 * province), GrowthMarket.acquisitionPriority (one market), growth.primarySideShare, and
 * growth.followRecommendations (let the Supply Gap agent's imbalance recommendation steer a market
 * the admin hasn't set). Both sides keep running everywhere; the priority orders and splits effort.
 */
export async function priorityContext() {
  const s = await getSettings();
  const markets = new Map((await prisma.growthMarket.findMany({ select: { key: true, state: true, acquisitionPriority: true, recommendedSide: true, recommendationKind: true } })).map((m) => [m.key, m]));
  const overrides = s["growth.acquisitionPriorities"];
  const share = s["growth.primarySideShare"];
  const follow = s["growth.followRecommendations"];
  const resolve = (state: string, marketKey?: string | null) => {
    const m = marketKey ? markets.get(marketKey) : undefined;
    return resolvePriority({
      state: m?.state ?? state, overrides, followRecommendations: follow,
      marketOverride: (m?.acquisitionPriority as Side | null | undefined) ?? null,
      recommendation: m?.recommendedSide ? { side: m.recommendedSide as Side, kind: (m.recommendationKind as "IMBALANCE" | "PRIORITY") ?? "PRIORITY" } : null,
    });
  };
  return {
    share,
    resolve,
    /** Sort key for a record worked by `side`: markets that put this side first come first. */
    rank: (side: Side, state: string, marketKey?: string | null) => priorityRank(resolve(state, marketKey).primary, side),
  };
}

/**
 * How a day's marketing emails are split between clinic and provider outreach: each active target
 * (Prelaunch/Live state) votes with its primary-side share. After noon Eastern a side may also use
 * what the other side left unused, so the cap is never wasted.
 */
export async function outreachSideAllowance(side: Side) {
  const s = await getSettings();
  const cap = s["growth.dailyOutreachCap"];
  const ctx = await priorityContext();
  const targets = await activeTargets();
  const states = [...new Set(targets.map((t) => t.state))];
  const demandPct = states.length ? states.reduce((a, st) => a + (ctx.resolve(st).primary === "DEMAND" ? ctx.share : 100 - ctx.share), 0) / states.length : 50;
  const split = sideSplit(cap, demandPct >= 50 ? "DEMAND" : "SUPPLY", demandPct >= 50 ? demandPct : 100 - demandPct);
  const now = clock.now();
  const dayStart = DateTime.fromJSDate(now, { zone: "America/New_York" }).startOf("day").toJSDate();
  const sent = async (entityType: string) => prisma.communication.count({ where: { entityType, direction: "OUT", status: "SENT", purpose: "COMMERCIAL", createdById: null, createdAt: { gte: dayStart } } });
  const [clinicSent, providerSent] = await Promise.all([sent("PROSPECT"), sent("PROVIDER_PROSPECT")]);
  const mine = side === "DEMAND" ? clinicSent : providerSent;
  const other = side === "DEMAND" ? providerSent : clinicSent;
  const otherSide: Side = side === "DEMAND" ? "SUPPLY" : "DEMAND";
  const afternoon = DateTime.fromJSDate(now, { zone: "America/New_York" }).hour >= 12;
  const allowance = split[side] + (afternoon ? Math.max(0, split[otherSide] - other) : 0);
  return { remaining: Math.max(0, allowance - mine), cap: split[side], sent: mine };
}

/** Admin: set (or clear, null) one market's acquisition priority. */
export async function setMarketPriority(actor: Actor, key: string, side: Side | null) {
  requireAdmin(actor);
  if (side !== null && side !== "SUPPLY" && side !== "DEMAND") throw new DomainError("VALIDATION", "Priority must be SUPPLY, DEMAND or empty.");
  const m = await prisma.growthMarket.findUnique({ where: { key } });
  if (!m) throw new DomainError("NOT_FOUND", "Market not found");
  await prisma.growthMarket.update({ where: { key }, data: { acquisitionPriority: side } });
  await audit(prisma, actor, "growth.market.priority", "GrowthMarket", m.id, { acquisitionPriority: m.acquisitionPriority }, { acquisitionPriority: side });
}

/** Admin: record (or clear) the CASL consent basis for commercial email to a Canadian prospect, with a note on how it was obtained. */
export async function setConsentBasis(actor: Actor, entity: "PROSPECT" | "PROVIDER_PROSPECT", id: string, basis: string | null, note: string | null) {
  requireAdmin(actor);
  if (basis && !(CASL_CONSENT_BASES as readonly string[]).includes(basis)) throw new DomainError("VALIDATION", "Unknown consent basis.");
  if (basis && !note?.trim()) throw new DomainError("VALIDATION", "Add a note on how consent was obtained (e.g. the page where they published the address).");
  const data = { consentBasis: basis, consentNote: basis ? note!.trim().slice(0, 500) : null };
  if (entity === "PROSPECT") await prisma.clinicProspect.update({ where: { id }, data });
  else await prisma.providerProspect.update({ where: { id }, data });
  await audit(prisma, actor, "growth.consent_basis", entity, id, null, data);
}
