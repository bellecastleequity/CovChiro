import { CA_PROVINCES, jurisdictionOf, regionName, US_STATES, type Jurisdiction } from "@cm/core";
import { prisma } from "@cm/db";
import { DateTime } from "luxon";
import { clock, requireAdmin, type Actor } from "../context";
import { priorityContext } from "./priority";

/**
 * Geographic supply/demand report (Growth → Supply & Demand → By region): every number is from the
 * marketplace itself. Prospects (discovered / contacted / registered) are kept apart from accounts,
 * and registered providers apart from providers with a verified license; posted shifts apart from
 * clinics who couldn't post (PostingDemand).
 */
const DAY = 86_400_000;
const CONTACTED_PROVIDER = ["CONTACTED", "ENGAGED", "REGISTERED", "NOT_INTERESTED"];
const CONTACTED_CLINIC = ["OUTREACH_STARTED", "ENGAGED", "INTERESTED", "ACCOUNT_STARTED", "ACCOUNT_CREATED", "COVERAGE_REQUESTED", "FIRST_SHIFT_BOOKED", "FIRST_SHIFT_COMPLETED", "REPEAT_CLINIC", "NOT_INTERESTED"];

export type GeoFilter = { jurisdiction?: Jurisdiction | ""; state?: string; profession?: string; source?: string };

type Count = { state: string; n: bigint };
const toMap = (rows: Count[]) => new Map(rows.map((r) => [r.state.trim(), Number(r.n)]));

export async function geographyReport(actor: Actor, f: GeoFilter = {}) {
  requireAdmin(actor);
  const now = clock.now();
  const code = f.profession || null;
  const src = f.source || null;
  const [pp, ppContacted, ppRegistered, cp, cpContacted, cpRegistered, providers, verified, clinics, active, open, unfilled, blocked] = await Promise.all([
    prisma.$queryRaw<Count[]>`SELECT "state"::text AS state, count(*) AS n FROM "ProviderProspect" WHERE (${code}::text IS NULL OR "professionCode" = ${code}) AND (${src}::text IS NULL OR "source" = ${src}) GROUP BY 1`,
    prisma.$queryRaw<Count[]>`SELECT "state"::text AS state, count(*) AS n FROM "ProviderProspect" WHERE stage = ANY(${CONTACTED_PROVIDER}) AND (${code}::text IS NULL OR "professionCode" = ${code}) AND (${src}::text IS NULL OR "source" = ${src}) GROUP BY 1`,
    prisma.$queryRaw<Count[]>`SELECT "state"::text AS state, count(*) AS n FROM "ProviderProspect" WHERE "providerId" IS NOT NULL AND (${code}::text IS NULL OR "professionCode" = ${code}) AND (${src}::text IS NULL OR "source" = ${src}) GROUP BY 1`,
    prisma.$queryRaw<Count[]>`SELECT "state"::text AS state, count(*) AS n FROM "ClinicProspect" WHERE (${code}::text IS NULL OR ${code} = ANY("professionCodes")) AND (${src}::text IS NULL OR "source" = ${src}) GROUP BY 1`,
    prisma.$queryRaw<Count[]>`SELECT "state"::text AS state, count(*) AS n FROM "ClinicProspect" WHERE stage::text = ANY(${CONTACTED_CLINIC}) AND (${code}::text IS NULL OR ${code} = ANY("professionCodes")) AND (${src}::text IS NULL OR "source" = ${src}) GROUP BY 1`,
    prisma.$queryRaw<Count[]>`SELECT "state"::text AS state, count(*) AS n FROM "ClinicProspect" WHERE "clinicOrgId" IS NOT NULL AND (${code}::text IS NULL OR ${code} = ANY("professionCodes")) AND (${src}::text IS NULL OR "source" = ${src}) GROUP BY 1`,
    // Accounts (not filtered by prospect source: they're real users however they found us).
    prisma.$queryRaw<Count[]>`SELECT COALESCE(p."homeState", '')::text AS state, count(DISTINCT p.id) AS n FROM "Provider" p JOIN "ProviderProfession" pp ON pp."providerId" = p.id WHERE p.status NOT IN ('SUSPENDED', 'DEACTIVATED') AND (${code}::text IS NULL OR pp."professionCode" = ${code}) GROUP BY 1`,
    prisma.$queryRaw<Count[]>`SELECT l."state"::text AS state, count(DISTINCT l."providerId") AS n FROM "License" l JOIN "Provider" p ON p.id = l."providerId" WHERE l.status = 'VERIFIED' AND (l."expiresAt" IS NULL OR l."expiresAt" > ${now}) AND p.status = 'ACTIVE' AND (${code}::text IS NULL OR l."professionCode" = ${code}) GROUP BY 1`,
    prisma.$queryRaw<Count[]>`SELECT cl."state"::text AS state, count(DISTINCT cl."clinicOrgId") AS n FROM "ClinicLocation" cl JOIN "ClinicOrg" o ON o.id = cl."clinicOrgId" WHERE cl.active AND o.status = 'ACTIVE' GROUP BY 1`,
    prisma.$queryRaw<Count[]>`SELECT cl."state"::text AS state, count(DISTINCT cl."clinicOrgId") AS n FROM "Shift" s JOIN "ClinicLocation" cl ON cl.id = s."locationId" WHERE s."postedAt" > ${new Date(+now - 90 * DAY)} AND (${code}::text IS NULL OR s."professionCode" = ${code}) GROUP BY 1`,
    prisma.$queryRaw<Count[]>`SELECT cl."state"::text AS state, count(*) AS n FROM "Shift" s JOIN "ClinicLocation" cl ON cl.id = s."locationId" WHERE s.status IN ('OPEN', 'FAVORITES_ONLY', 'SELECTING', 'CASCADING') AND s."startsAt" > ${now} AND (${code}::text IS NULL OR s."professionCode" = ${code}) GROUP BY 1`,
    prisma.$queryRaw<Count[]>`SELECT cl."state"::text AS state, count(*) AS n FROM "Shift" s JOIN "ClinicLocation" cl ON cl.id = s."locationId" WHERE s.status = 'UNFILLED' AND s."startsAt" > ${new Date(+now - 30 * DAY)} AND (${code}::text IS NULL OR s."professionCode" = ${code}) GROUP BY 1`,
    prisma.$queryRaw<Count[]>`SELECT "state"::text AS state, count(*) AS n FROM "PostingDemand" WHERE "postedAt" IS NULL AND "createdAt" > ${new Date(+now - 90 * DAY)} AND (${code}::text IS NULL OR "professionCode" = ${code}) GROUP BY 1`,
  ]);
  const m = { pp: toMap(pp), ppContacted: toMap(ppContacted), ppRegistered: toMap(ppRegistered), cp: toMap(cp), cpContacted: toMap(cpContacted), cpRegistered: toMap(cpRegistered), providers: toMap(providers), verified: toMap(verified), clinics: toMap(clinics), active: toMap(active), open: toMap(open), unfilled: toMap(unfilled), blocked: toMap(blocked) };
  const ctx = await priorityContext();
  const targets = new Map<string, string>();
  for (const t of await prisma.growthTarget.findMany({ where: code ? { professionCode: code } : {} })) {
    const prev = targets.get(t.state);
    if (!prev || prev === "OFF" || (prev === "PRELAUNCH" && t.status === "LIVE")) targets.set(t.state, t.status);
  }
  const regions = [...Object.keys(US_STATES), ...Object.keys(CA_PROVINCES)];
  const pct = (a: number, b: number) => (b ? Math.round((a / b) * 100) : null);
  const rows = regions
    .filter((r) => (!f.state || r === f.state.toUpperCase()) && (!f.jurisdiction || jurisdictionOf(r) === f.jurisdiction))
    .map((r) => {
      const g = (k: keyof typeof m) => m[k].get(r) ?? 0;
      const supply = { prospects: g("pp"), contacted: g("ppContacted"), registeredFromProspects: g("ppRegistered"), providers: g("providers"), verified: g("verified") };
      const demand = { prospects: g("cp"), contacted: g("cpContacted"), registeredFromProspects: g("cpRegistered"), clinics: g("clinics"), activeClinics: g("active"), openShifts: g("open"), unfilled30: g("unfilled"), couldntPost: g("blocked") };
      const priority = ctx.resolve(r);
      // A simple, explainable imbalance flag from real numbers (the per-market Supply Gap agent goes deeper).
      const needProviders = demand.unfilled30 > 0 || demand.couldntPost > 0 || demand.openShifts > supply.verified;
      const needClinics = supply.verified >= 3 && demand.activeClinics === 0;
      return {
        region: r, name: regionName(r), jurisdiction: jurisdictionOf(r), target: targets.get(r) ?? "OFF", priority, supply, demand,
        conversion: { providers: pct(supply.registeredFromProspects, supply.contacted), clinics: pct(demand.registeredFromProspects, demand.contacted) },
        needs: needProviders ? "PROVIDERS" : needClinics ? "CLINICS" : null,
        active: Object.values(supply).some(Boolean) || Object.values(demand).some(Boolean) || targets.get(r) !== undefined,
      };
    });
  const sum = (j: Jurisdiction | null) => {
    const list = rows.filter((x) => !j || x.jurisdiction === j);
    const add = (pick: (x: (typeof rows)[number]) => number) => list.reduce((a, x) => a + pick(x), 0);
    return {
      jurisdiction: j ?? "ALL", regions: list.length,
      providerProspects: add((x) => x.supply.prospects), providers: add((x) => x.supply.providers), verified: add((x) => x.supply.verified),
      clinicProspects: add((x) => x.demand.prospects), clinics: add((x) => x.demand.clinics), activeClinics: add((x) => x.demand.activeClinics), openShifts: add((x) => x.demand.openShifts), unfilled30: add((x) => x.demand.unfilled30),
    };
  };
  const monthStart = DateTime.fromJSDate(now, { zone: "America/New_York" }).startOf("month").toJSDate();
  const [providerSources, clinicSources, apolloCredits] = await Promise.all([
    prisma.providerProspect.groupBy({ by: ["source"], where: code ? { professionCode: code } : {}, _count: { _all: true } }),
    prisma.clinicProspect.groupBy({ by: ["source"], where: code ? { professionCodes: { has: code } } : {}, _count: { _all: true } }),
    prisma.dataSourceUsage.groupBy({ by: ["side"], where: { source: "apollo", createdAt: { gte: monthStart } }, _sum: { creditsEstimated: true } }),
  ]);
  return {
    rows,
    totals: [sum(null), sum("US_STATE"), sum("US_TERRITORY"), sum("CANADA")],
    sources: {
      providers: providerSources.map((x) => ({ source: x.source, n: x._count._all })).sort((a, b) => b.n - a.n),
      clinics: clinicSources.map((x) => ({ source: x.source ?? "Unknown", n: x._count._all })).sort((a, b) => b.n - a.n),
    },
    apolloCreditsMonth: apolloCredits.map((x) => ({ side: x.side ?? "OTHER", credits: x._sum.creditsEstimated ?? 0 })),
  };
}
