import { prisma, type Prisma } from "@cm/db";
import { requireAdmin, type Actor } from "./context";

/**
 * First-party analytics: page views, CTA clicks and funnel events with an
 * anonymous visitor id (first-party cookie). No IP addresses stored.
 * Plus marketplace KPIs straight from the ledger tables.
 */

export async function track(e: { type: string; path?: string | null; referrer?: string | null; visitorId?: string | null; userId?: string | null; utm?: { source?: string; medium?: string; campaign?: string }; props?: Record<string, unknown> }) {
  try {
    await prisma.analyticsEvent.create({
      data: {
        type: e.type.slice(0, 40),
        path: e.path?.slice(0, 300) ?? null,
        referrer: e.referrer ? safeReferrer(e.referrer) : null,
        visitorId: e.visitorId?.slice(0, 64) ?? null,
        userId: e.userId ?? null,
        utmSource: e.utm?.source?.slice(0, 100) ?? null,
        utmMedium: e.utm?.medium?.slice(0, 100) ?? null,
        utmCampaign: e.utm?.campaign?.slice(0, 100) ?? null,
        props: (e.props ?? undefined) as Prisma.InputJsonValue | undefined,
      },
    });
  } catch {
    /* analytics never breaks a request */
  }
}

/** Keep only the referring host — never full URLs with query strings. */
function safeReferrer(r: string): string | null {
  try {
    return new URL(r).host.slice(0, 200);
  } catch {
    return null;
  }
}

const LIVE = ["CONFIRMED", "IN_PROGRESS", "COMPLETED", "DISPUTED"] as const;

export async function analyticsSummary(actor: Actor, range: { from: Date; to: Date }) {
  requireAdmin(actor);
  const { from, to } = range;
  const inRange = { gte: from, lt: to };

  const [views, visitors, topPages, referrers, utm, events] = await Promise.all([
    prisma.analyticsEvent.count({ where: { type: "PAGE_VIEW", createdAt: inRange } }),
    prisma.analyticsEvent.findMany({ where: { type: "PAGE_VIEW", createdAt: inRange }, distinct: ["visitorId"], select: { visitorId: true } }),
    prisma.analyticsEvent.groupBy({ by: ["path"], where: { type: "PAGE_VIEW", createdAt: inRange }, _count: true, orderBy: { _count: { path: "desc" } }, take: 10 }),
    prisma.analyticsEvent.groupBy({ by: ["referrer"], where: { type: "PAGE_VIEW", createdAt: inRange, referrer: { not: null } }, _count: true, orderBy: { _count: { referrer: "desc" } }, take: 8 }),
    prisma.analyticsEvent.groupBy({ by: ["utmSource", "utmCampaign"], where: { createdAt: inRange, utmSource: { not: null } }, _count: true, orderBy: { _count: { utmSource: "desc" } }, take: 10 }),
    prisma.analyticsEvent.groupBy({ by: ["type"], where: { createdAt: inRange }, _count: true }),
  ]);
  const eventCounts = Object.fromEntries(events.map((e) => [e.type, e._count]));

  // Daily page views for the traffic chart.
  const daily = await prisma.$queryRaw<{ day: Date; views: bigint; visitors: bigint }[]>`
    SELECT date_trunc('day', "createdAt") AS day, count(*) AS views, count(DISTINCT "visitorId") AS visitors
    FROM "AnalyticsEvent" WHERE type = 'PAGE_VIEW' AND "createdAt" >= ${from} AND "createdAt" < ${to}
    GROUP BY 1 ORDER BY 1`;

  // Marketplace.
  const [posted, filled, unfilled, cancelled, assignments, leadsByStatus, leadsBySource, byProfession, byState] = await Promise.all([
    prisma.shift.count({ where: { postedAt: inRange } }),
    prisma.assignment.count({ where: { confirmedAt: inRange, status: { in: [...LIVE] } } }),
    prisma.shift.count({ where: { startsAt: inRange, status: "UNFILLED" } }),
    prisma.assignment.count({ where: { cancelledAt: inRange } }),
    prisma.assignment.findMany({
      where: { confirmedAt: inRange, status: { in: [...LIVE] } },
      select: { clinicPriceCents: true, providerPayCents: true, promoDiscountCents: true, mileageCents: true, lodgingApprovedCents: true, confirmedAt: true, shift: { select: { postedAt: true } } },
    }),
    prisma.lead.groupBy({ by: ["status"], where: { createdAt: inRange }, _count: true }),
    prisma.lead.groupBy({ by: ["source"], where: { createdAt: inRange }, _count: true }),
    prisma.assignment.groupBy({ by: ["professionCode"], where: { confirmedAt: inRange, status: { in: [...LIVE] } }, _count: true, _sum: { clinicPriceCents: true, providerPayCents: true, promoDiscountCents: true } }),
    prisma.assignment.groupBy({ by: ["state"], where: { confirmedAt: inRange, status: { in: [...LIVE] } }, _count: true, _sum: { clinicPriceCents: true, providerPayCents: true, promoDiscountCents: true } }),
  ]);
  const revenue = assignments.reduce((x, a) => x + a.clinicPriceCents - a.promoDiscountCents, 0);
  const providerPay = assignments.reduce((x, a) => x + a.providerPayCents, 0);
  const passThrough = assignments.reduce((x, a) => x + a.mileageCents + a.lodgingApprovedCents, 0);
  const discounts = assignments.reduce((x, a) => x + a.promoDiscountCents, 0);
  const fillHours = assignments.filter((a) => a.shift.postedAt).map((a) => (+a.confirmedAt - +a.shift.postedAt!) / 3_600_000).sort((a, b) => a - b);
  const [pendingPayouts, openShifts, activeProviders, activeClinics] = await Promise.all([
    prisma.payout.aggregate({ where: { status: { in: ["PENDING", "SCHEDULED", "ON_HOLD", "FAILED"] } }, _sum: { amountCents: true } }),
    prisma.shift.groupBy({ by: ["state", "professionCode"], where: { status: { in: ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"] }, startsAt: { gt: new Date() } }, _count: true }),
    prisma.provider.count({ where: { status: "ACTIVE" } }),
    prisma.clinicOrg.count({ where: { status: "ACTIVE" } }),
  ]);
  // Smart Dispatch (Addendum 02 §12).
  const dispatches = await prisma.dispatch.findMany({
    where: { startedAt: inRange },
    select: { id: true, status: true, tierAtStart: true, startedAt: true, endedAt: true, filledVia: true, filledOfferId: true, bestMatchAtStart: true, _count: { select: { offers: true } } },
  });
  const filledDispatches = dispatches.filter((d) => d.status === "FILLED");
  const filledOffers = await prisma.offer.findMany({ where: { id: { in: filledDispatches.map((d) => d.filledOfferId).filter((x): x is string => !!x) } }, select: { id: true, matchScore: true } });
  const offerScore = new Map(filledOffers.map((o) => [o.id, o.matchScore]));
  const median = (xs: number[]) => (xs.length ? [...xs].sort((a, b) => a - b)[Math.floor(xs.length / 2)] : null);
  const tiers = ["SAME_DAY", "SHORT", "NEAR", "PLANNED"] as const;
  const quality = filledDispatches
    .map((d) => (d.filledOfferId && d.bestMatchAtStart ? (offerScore.get(d.filledOfferId) ?? 0) / d.bestMatchAtStart : null))
    .filter((x): x is number => x != null);
  const onCallProviders = await prisma.onCallRule.findMany({ where: { active: true, OR: [{ pausedUntil: null }, { pausedUntil: { lte: new Date() } }], provider: { status: "ACTIVE" } }, distinct: ["providerId"], select: { providerId: true } });
  const dispatchStats = {
    started: dispatches.length,
    filled: filledDispatches.length,
    exhausted: dispatches.filter((d) => d.status === "EXHAUSTED").length,
    fillRate: dispatches.length ? filledDispatches.length / dispatches.length : null,
    byTier: tiers.map((tier) => {
      const ds = dispatches.filter((d) => d.tierAtStart === tier);
      const f = ds.filter((d) => d.status === "FILLED" && d.endedAt);
      return { tier, started: ds.length, filled: f.length, medianMinutesToFill: median(f.map((d) => (+d.endedAt! - +d.startedAt) / 60_000)) };
    }),
    byPath: Object.entries(
      filledDispatches.reduce<Record<string, number>>((acc, d) => {
        const k = d.filledVia ?? "UNKNOWN";
        acc[k] = (acc[k] ?? 0) + 1;
        return acc;
      }, {}),
    ).map(([path, count]) => ({ path, count, share: count / Math.max(1, filledDispatches.length) })),
    medianMatchQuality: median(quality),
    offersPerFill: filledDispatches.length ? dispatches.reduce((x, d) => x + d._count.offers, 0) / filledDispatches.length : null,
    onCallProviders: onCallProviders.length,
    onCallFillShare: filledDispatches.length ? filledDispatches.filter((d) => d.filledVia === "ON_CALL_AUTO").length / filledDispatches.length : null,
  };

  const leadsTotal = leadsByStatus.reduce((x, l) => x + l._count, 0);
  const leadsConverted = leadsByStatus.find((l) => l.status === "CONVERTED")?._count ?? 0;

  return {
    traffic: {
      views,
      visitors: visitors.filter((v) => v.visitorId).length,
      daily: daily.map((d) => ({ day: d.day.toISOString().slice(0, 10), views: Number(d.views), visitors: Number(d.visitors) })),
      topPages: topPages.map((p) => ({ path: p.path ?? "(unknown)", views: p._count })),
      referrers: referrers.map((r) => ({ host: r.referrer!, views: r._count })),
      utm: utm.map((u) => ({ source: u.utmSource!, campaign: u.utmCampaign, events: u._count })),
    },
    funnel: {
      visitors: visitors.filter((v) => v.visitorId).length,
      leads: eventCounts["LEAD_CAPTURED"] ?? 0,
      signups: eventCounts["SIGNUP"] ?? 0,
      shiftsPosted: posted,
      shiftsFilled: filled,
    },
    marketplace: {
      posted,
      filled,
      unfilled,
      cancelled,
      fillRate: posted ? filled / posted : null,
      medianHoursToFill: fillHours.length ? fillHours[Math.floor(fillHours.length / 2)] : null,
      revenueCents: revenue,
      providerPayCents: providerPay,
      marginCents: revenue - providerPay,
      discountsCents: discounts,
      passThroughCents: passThrough,
      pendingPayoutsCents: pendingPayouts._sum.amountCents ?? 0,
      activeProviders,
      activeClinics,
      openShifts: openShifts.map((o) => ({ state: o.state, professionCode: o.professionCode, count: o._count })),
      byProfession: byProfession.map((p) => ({
        professionCode: p.professionCode,
        shifts: p._count,
        revenueCents: (p._sum.clinicPriceCents ?? 0) - (p._sum.promoDiscountCents ?? 0),
        marginCents: (p._sum.clinicPriceCents ?? 0) - (p._sum.promoDiscountCents ?? 0) - (p._sum.providerPayCents ?? 0),
      })),
      byState: byState.map((p) => ({
        state: p.state,
        shifts: p._count,
        revenueCents: (p._sum.clinicPriceCents ?? 0) - (p._sum.promoDiscountCents ?? 0),
        marginCents: (p._sum.clinicPriceCents ?? 0) - (p._sum.promoDiscountCents ?? 0) - (p._sum.providerPayCents ?? 0),
      })),
    },
    dispatch: dispatchStats,
    leads: {
      total: leadsTotal,
      converted: leadsConverted,
      conversionRate: leadsTotal ? leadsConverted / leadsTotal : null,
      byStatus: Object.fromEntries(leadsByStatus.map((l) => [l.status, l._count])),
      bySource: Object.fromEntries(leadsBySource.map((l) => [l.source, l._count])),
    },
  };
}
