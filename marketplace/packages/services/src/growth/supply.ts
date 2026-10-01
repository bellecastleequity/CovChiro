import { demandLevel, marketReadiness, recruitmentPriority, supplyStatus, type SupplyStatus } from "@cm/core";
import { prisma } from "@cm/db";
import { haversineMiles } from "@cm/integrations";
import { clock } from "../context";
import { coverageReadyProviders } from "./analytics";
import { agentOn, escalate, logAgent } from "./engine";

/**
 * Supply & demand per metro market (GrowthMarket: profession × state × metro).
 * Supply = coverage-ready providers (messaging view; never eligibility) whose home is within
 * the market radius. Demand = posted/booked shifts at clinic locations in the radius.
 * The Supply Gap agent stores each market's status hourly and steers recruitment.
 */
const DAY = 86_400_000;
const OPEN = ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"] as const;
const FILLED = ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] as const;

export type MarketRow = Awaited<ReturnType<typeof marketSupply>>[number];

export async function marketSupply(opts: { key?: string } = {}) {
  const now = clock.now();
  const markets = await prisma.growthMarket.findMany({ where: opts.key ? { key: opts.key } : {}, orderBy: [{ priority: "asc" }, { name: "asc" }] });
  const pairs = [...new Set(markets.map((m) => `${m.professionCode}|${m.state}`))];
  const ready = new Map<string, { lat: number; lng: number; id: string }[]>();
  for (const pair of pairs) {
    const [professionCode, state] = pair.split("|");
    ready.set(pair, (await coverageReadyProviders({ professionCode, state })).filter((p) => p.homeLat != null && p.homeLng != null).map((p) => ({ lat: p.homeLat!, lng: p.homeLng!, id: p.id })));
  }
  const shifts = await prisma.shift.findMany({
    where: { OR: [{ status: { in: [...OPEN, "CONFIRMED"] }, startsAt: { gt: now, lt: new Date(+now + 30 * DAY) } }, { status: { in: [...FILLED, "UNFILLED"] }, startsAt: { gt: new Date(+now - 30 * DAY), lt: now } }] },
    select: { status: true, startsAt: true, professionCode: true, location: { select: { lat: true, lng: true, clinicOrgId: true } } },
  });
  const targets = new Map((await prisma.growthTarget.findMany()).map((t) => [`${t.professionCode}|${t.state}`, t.status as "OFF" | "PRELAUNCH" | "LIVE"]));
  const [providerProspects, clinicProspects] = await Promise.all([
    prisma.providerProspect.groupBy({ by: ["marketKey", "contactStatus", "stage"], where: { marketKey: { in: markets.map((m) => m.key) } }, _count: { _all: true } }),
    prisma.clinicProspect.groupBy({ by: ["marketKey"], where: { marketKey: { in: markets.map((m) => m.key) } }, _count: { _all: true } }),
  ]);
  return markets.map((m) => {
    const pair = `${m.professionCode}|${m.state}`;
    const center = { lat: m.centerLat, lng: m.centerLng };
    const within = { 25: 0, 50: 0, 75: 0, 100: 0 } as Record<25 | 50 | 75 | 100, number>;
    let inMarket = 0;
    for (const p of ready.get(pair) ?? []) {
      const d = haversineMiles(p, center);
      for (const r of [25, 50, 75, 100] as const) if (d <= r) within[r]++;
      if (d <= m.radiusMiles) inMarket++;
    }
    const here = shifts.filter((s) => s.professionCode === m.professionCode && haversineMiles({ lat: s.location.lat, lng: s.location.lng }, center) <= m.radiusMiles);
    const upcoming = here.filter((s) => s.startsAt > now);
    const past = here.filter((s) => s.startsAt <= now);
    const upcomingOpen = upcoming.filter((s) => (OPEN as readonly string[]).includes(s.status)).length;
    const filled30 = past.filter((s) => (FILLED as readonly string[]).includes(s.status)).length;
    const unfilled30 = past.filter((s) => s.status === "UNFILLED").length;
    const completed30 = past.filter((s) => s.status === "COMPLETED").length;
    const clinics = new Set(here.map((s) => s.location.clinicOrgId)).size;
    const status: SupplyStatus = supplyStatus({ ready: inMarket, target: m.targetProviders, upcomingRequests: upcomingOpen, filled30, unfilled30 });
    const pp = providerProspects.filter((x) => x.marketKey === m.key);
    const sum = (f: (x: (typeof pp)[number]) => boolean) => pp.filter(f).reduce((a, x) => a + x._count._all, 0);
    return {
      market: m, ready: inMarket, within, upcomingRequests: upcoming.length, upcomingOpen, filled30, unfilled30, completed30, clinics,
      supply: status, priority: recruitmentPriority(status), demand: demandLevel({ upcomingRequests: upcoming.length, clinics }),
      readiness: marketReadiness({ targetStatus: targets.get(pair) ?? "OFF", paused: !m.active, ready: inMarket, target: m.targetProviders, supply: status, completed30 }),
      targetStatus: targets.get(pair) ?? "OFF",
      prospects: {
        providers: sum(() => true), contactable: sum((x) => x.contactStatus === "VERIFIED"), contacted: sum((x) => ["CONTACTED", "ENGAGED", "REGISTERED", "NOT_INTERESTED"].includes(x.stage)),
        registered: sum((x) => x.stage === "REGISTERED"), clinics: clinicProspects.find((x) => x.marketKey === m.key)?._count._all ?? 0,
      },
    };
  });
}

/**
 * Supply Gap agent (hourly): stores every market's status, logs changes, and puts CRITICAL
 * markets with upcoming demand in front of a person with the recruiting numbers.
 */
export async function marketSupplySweep() {
  if (!(await agentOn("matching"))) return { markets: 0, changed: 0 };
  const rows = await marketSupply();
  let changed = 0;
  for (const r of rows) {
    if (r.market.supplyStatus !== r.supply) {
      changed++;
      await prisma.growthMarket.update({ where: { id: r.market.id }, data: { supplyStatus: r.supply, supplyCheckedAt: clock.now() } });
      if (r.market.supplyStatus) {
        await logAgent("matching", "supply_status", { entityType: "MARKET", entityId: r.market.key, output: `${r.market.name} supply ${r.market.supplyStatus} → ${r.supply} (${r.ready} coverage-ready, ${r.upcomingRequests} upcoming requests)` });
      }
    } else {
      await prisma.growthMarket.update({ where: { id: r.market.id }, data: { supplyCheckedAt: clock.now() } });
    }
    if (r.supply === "CRITICAL" && r.upcomingRequests > 0 && r.market.active) {
      await escalate({
        entityType: "MARKET", entityId: r.market.key, label: r.market.name, reasonCode: "supply_critical", intent: "HIGH",
        reason: `${r.upcomingRequests} upcoming request${r.upcomingRequests === 1 ? "" : "s"}, ${r.ready} coverage-ready provider${r.ready === 1 ? "" : "s"} nearby.`,
        summary: `Provider prospects in this market: ${r.prospects.providers} (${r.prospects.contactable} contactable, ${r.prospects.contacted} contacted, ${r.prospects.registered} registered).`,
        action: "Increase provider recruitment here (Provider Recruitment Outreach works the neediest markets first); consider widening travel or lodging on open shifts.",
      });
    }
  }
  return { markets: rows.length, changed };
}
