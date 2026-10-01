import { providerGrowthState } from "@cm/core";
import { haversineMiles } from "@cm/integrations";
import { prisma } from "@cm/db";
import { clock, getSettings } from "../context";
import { aiSpendCents } from "./engine";

/**
 * Growth analytics: funnels, KPIs, geographic liquidity and attribution,
 * computed live from platform tables. Aggregates only — nothing here is sent
 * to an AI model except these totals.
 */

const DAY = 86_400_000;

export async function marketForPoint(lat: number, lng: number) {
  const markets = await prisma.growthMarket.findMany({ where: { active: true } });
  let best: (typeof markets)[number] | null = null, bestD = Infinity;
  for (const m of markets) {
    const d = haversineMiles({ lat, lng }, { lat: m.centerLat, lng: m.centerLng });
    if (d <= m.radiusMiles && d < bestD) { best = m; bestD = d; }
  }
  return best;
}

/** Coverage-ready providers (launch profession + state) with a home location. Messaging/planning view only. */
export async function coverageReadyProviders() {
  const s = await getSettings();
  const professionCode = s["growth.launchProfession"], state = s["growth.launchState"];
  const [profession, psc] = await Promise.all([
    prisma.profession.findUnique({ where: { code: professionCode } }),
    prisma.professionStateConfig.findUnique({ where: { professionCode_state: { professionCode, state } } }),
  ]);
  const mins = {
    malpracticeMinOccurrenceCents: psc?.malpracticeMinOccurrenceCents ?? profession?.defaultMalpracticeMinOccurrenceCents ?? 0,
    malpracticeMinAggregateCents: psc?.malpracticeMinAggregateCents ?? profession?.defaultMalpracticeMinAggregateCents ?? 0,
  };
  const rows = await prisma.provider.findMany({
    where: { status: { notIn: ["SUSPENDED", "DEACTIVATED"] }, licenses: { some: { professionCode, status: "VERIFIED" } } },
    include: { licenses: true, malpractice: true, stats: true },
  });
  const now = clock.now();
  return rows
    .map((p) => ({
      p,
      st: providerGrowthState({
        licenses: p.licenses, malpractice: p.malpractice, professionCode, state, mins,
        nationalCredentialAccepted: !!psc && !psc.licensedAtStateLevel && psc.alternativeCredentialAllowed,
        graduationDate: p.graduationDate, isStudent: p.isStudent, shiftsCompleted: p.stats?.completedShifts ?? 0, now,
      }),
    }))
    .filter((x) => x.st.coverageReady)
    .map((x) => x.p);
}

export async function liquidity() {
  const ready = (await coverageReadyProviders()).filter((p) => p.homeLat != null && p.homeLng != null);
  const markets = await prisma.growthMarket.findMany({ orderBy: [{ priority: "asc" }, { name: "asc" }] });
  const out = [];
  for (const m of markets) {
    const within = { 25: 0, 50: 0, 75: 0, 100: 0 } as Record<25 | 50 | 75 | 100, number>;
    let inMarket = 0;
    for (const p of ready) {
      const d = haversineMiles({ lat: p.homeLat!, lng: p.homeLng! }, { lat: m.centerLat, lng: m.centerLng });
      for (const r of [25, 50, 75, 100] as const) if (d <= r) within[r]++;
      if (d <= m.radiusMiles) inMarket++;
    }
    const [prospects, accounts, booked] = await Promise.all([
      prisma.clinicProspect.count({ where: { marketKey: m.key } }),
      prisma.clinicProspect.count({ where: { marketKey: m.key, clinicOrgId: { not: null } } }),
      prisma.clinicProspect.count({ where: { marketKey: m.key, stage: { in: ["FIRST_SHIFT_BOOKED", "FIRST_SHIFT_COMPLETED", "REPEAT_CLINIC"] } } }),
    ]);
    out.push({ market: m, within, inMarket, ready: inMarket >= m.targetProviders, prospects, accounts, booked });
  }
  return out;
}

const AFTER_ENGAGED = ["ENGAGED", "INTERESTED", "ACCOUNT_STARTED", "ACCOUNT_CREATED", "COVERAGE_REQUESTED", "FIRST_SHIFT_BOOKED", "FIRST_SHIFT_COMPLETED", "REPEAT_CLINIC"] as const;
const AFTER_REQUESTED = ["COVERAGE_REQUESTED", "FIRST_SHIFT_BOOKED", "FIRST_SHIFT_COMPLETED", "REPEAT_CLINIC"] as const;

export async function growthFunnels() {
  const s = await getSettings();
  const professionCode = s["growth.launchProfession"];
  const ready = await coverageReadyProviders();
  const stage = (stages: readonly string[]) => prisma.clinicProspect.count({ where: { stage: { in: stages as never } } });
  const clinic = [
    { label: "Clinics identified", count: await prisma.clinicProspect.count() },
    { label: "Valid contacts", count: await prisma.clinicProspect.count({ where: { email: { not: null }, emailStatus: { notIn: ["BOUNCED", "COMPLAINED"] } } }) },
    { label: "Contacted", count: (await prisma.communication.groupBy({ by: ["entityId"], where: { entityType: "PROSPECT", direction: "OUT", status: "SENT" } })).length },
    { label: "Engaged", count: await stage(AFTER_ENGAGED) },
    { label: "Website visitors (tracked links)", count: (await prisma.leadSignal.groupBy({ by: ["entityId"], where: { entityType: "PROSPECT", kind: { in: ["site_visit", "calculator_used", "pricing_viewed"] } } })).length },
    { label: "Accounts created", count: await prisma.clinicProspect.count({ where: { clinicOrgId: { not: null } } }) },
    { label: "Coverage requested", count: await stage(AFTER_REQUESTED) },
    { label: "Shift filled", count: await stage(["FIRST_SHIFT_BOOKED", "FIRST_SHIFT_COMPLETED", "REPEAT_CLINIC"]) },
    { label: "Shift completed", count: await stage(["FIRST_SHIFT_COMPLETED", "REPEAT_CLINIC"]) },
    { label: "Repeat clinic", count: await stage(["REPEAT_CLINIC"]) },
  ];
  const inProf = { professions: { some: { professionCode } } };
  const provider = [
    { label: "Registered", count: await prisma.provider.count({ where: inProf }) },
    { label: "Graduated", count: await prisma.provider.count({ where: { ...inProf, OR: [{ graduationDate: null, isStudent: false }, { graduationDate: { lte: clock.now() } }] } }) },
    { label: "Licensed (verified)", count: await prisma.provider.count({ where: { licenses: { some: { professionCode, status: "VERIFIED" } } } }) },
    { label: "Insured (verified)", count: await prisma.provider.count({ where: { ...inProf, malpractice: { some: { status: "VERIFIED" } } } }) },
    { label: "Coverage ready", count: ready.length },
    { label: "First shift", count: ready.filter((p) => (p.stats?.completedShifts ?? 0) >= 1).length },
    { label: "Repeat provider", count: ready.filter((p) => (p.stats?.completedShifts ?? 0) >= 2).length },
  ];
  return { clinic, provider };
}

export async function growthKpis() {
  const now = clock.now();
  const d30 = new Date(+now - 30 * DAY), d90 = new Date(+now - 90 * DAY);
  const pct = (a: number, b: number) => (b > 0 ? Math.round((1000 * a) / b) / 10 : null);
  const ready = await coverageReadyProviders();
  const registered = await prisma.provider.count();
  const withShift = ready.filter((p) => (p.stats?.completedShifts ?? 0) >= 1).length;
  const repeatProv = ready.filter((p) => (p.stats?.completedShifts ?? 0) >= 2).length;
  const active = await prisma.providerStats.count({ where: { lastShiftAt: { gte: d90 } } });

  const posted = await prisma.shift.count({ where: { postedAt: { not: null } } });
  const filled = await prisma.shift.count({ where: { status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] } } });
  const unfilled = await prisma.shift.count({ where: { status: "UNFILLED" } });
  const cancelled = await prisma.shift.count({ where: { status: "CANCELLED", postedAt: { not: null } } });
  const money = await prisma.shift.aggregate({ where: { status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] } }, _sum: { clinicPriceCents: true, providerPayCents: true }, _avg: { clinicPriceCents: true } });
  const fillTimes = await prisma.$queryRawUnsafe<{ hours: number | null }[]>(
    `SELECT AVG(EXTRACT(EPOCH FROM (a."confirmedAt" - s."postedAt")) / 3600)::float8 AS hours FROM "Assignment" a JOIN "Shift" s ON s.id = a."shiftId" WHERE s."postedAt" IS NOT NULL AND a."confirmedAt" > s."postedAt"`,
  ).catch(() => [{ hours: null }]);
  const clinicsBooked = await prisma.$queryRawUnsafe<{ org: string; n: bigint }[]>(
    `SELECT l."clinicOrgId"::text AS org, COUNT(*) AS n FROM "Shift" s JOIN "ClinicLocation" l ON l.id = s."locationId" WHERE s.status IN ('CONFIRMED','IN_PROGRESS','COMPLETED') GROUP BY l."clinicOrgId"`,
  );
  const firstTime30 = await prisma.$queryRawUnsafe<{ n: bigint }[]>(
    `SELECT COUNT(*) AS n FROM (SELECT l."clinicOrgId", MIN(s."postedAt") AS first FROM "Shift" s JOIN "ClinicLocation" l ON l.id = s."locationId" WHERE s."postedAt" IS NOT NULL GROUP BY l."clinicOrgId") t WHERE t.first >= $1`, d30,
  );
  const spend = await prisma.growthCampaign.groupBy({ by: ["audience"], _sum: { spendCents: true } });
  const spendFor = (a: "CLINIC" | "PROVIDER") => spend.find((x) => x.audience === a)?._sum.spendCents ?? 0;
  const requesting = await prisma.$queryRawUnsafe<{ n: bigint }[]>(`SELECT COUNT(DISTINCT l."clinicOrgId") AS n FROM "Shift" s JOIN "ClinicLocation" l ON l.id = s."locationId" WHERE s."postedAt" IS NOT NULL`);
  const nBooked = clinicsBooked.length, nRepeat = clinicsBooked.filter((c) => Number(c.n) >= 2).length;
  return {
    supply: { registeredProviders: registered, coverageReadyProviders: ready.length, activeProviders90d: active, activationRatePct: pct(ready.length, registered), firstShiftConversionPct: pct(withShift, ready.length), repeatProviderRatePct: pct(repeatProv, withShift) },
    demand: { clinicProspects: await prisma.clinicProspect.count(), registeredClinics: await prisma.clinicOrg.count(), requestingClinics: Number(requesting[0]?.n ?? 0), firstTimeClinics30d: Number(firstTime30[0]?.n ?? 0), repeatClinics: nRepeat },
    marketplace: {
      coverageRequests: posted, filledShifts: filled, unfilledShifts: unfilled, fillRatePct: pct(filled, filled + unfilled), avgHoursToFill: fillTimes[0]?.hours != null ? Math.round(fillTimes[0].hours * 10) / 10 : null,
      cancellationRatePct: pct(cancelled, posted), repeatBookingRatePct: pct(nRepeat, nBooked), averageBookingValueCents: money._avg.clinicPriceCents != null ? Math.round(money._avg.clinicPriceCents) : null,
      grossVolumeCents: money._sum.clinicPriceCents ?? 0, providerPayoutCents: money._sum.providerPayCents ?? 0, platformTakeCents: (money._sum.clinicPriceCents ?? 0) - (money._sum.providerPayCents ?? 0),
    },
    marketing: {
      clinicCacCents: nBooked ? Math.round(spendFor("CLINIC") / nBooked) : null, providerCacCents: ready.length ? Math.round(spendFor("PROVIDER") / ready.length) : null,
      unpostedDrafts: await prisma.shift.count({ where: { status: "DRAFT", startsAt: { gt: now } } }),
      aiSpend30dCents: Math.round(await aiSpendCents(d30)),
    },
  };
}

/** Conversions by campaign, by message version (downstream outcomes, not opens), and by metro. */
export async function attribution() {
  const campaigns = await prisma.growthCampaign.findMany({ orderBy: { createdAt: "desc" } });
  const providerRows = await prisma.provider.findMany({ where: { campaignCode: { not: null } }, select: { id: true, campaignCode: true, stats: { select: { completedShifts: true } } } });
  const readyIds = new Set((await coverageReadyProviders()).map((p) => p.id));
  const prospectRows = await prisma.clinicProspect.findMany({ where: { campaignCode: { not: null } }, select: { campaignCode: true, stage: true } });
  const booked = (st: string) => ["FIRST_SHIFT_BOOKED", "FIRST_SHIFT_COMPLETED", "REPEAT_CLINIC"].includes(st);
  const byCampaign = campaigns.map((c) => {
    const ps = providerRows.filter((p) => p.campaignCode === c.code);
    const cs = prospectRows.filter((p) => p.campaignCode === c.code);
    return { campaign: c, registered: ps.length, coverageReady: ps.filter((p) => readyIds.has(p.id)).length, firstShift: ps.filter((p) => (p.stats?.completedShifts ?? 0) >= 1).length, clinics: cs.length, clinicsBooked: cs.filter((p) => booked(p.stage)).length };
  });
  const sent = await prisma.communication.groupBy({ by: ["entityType", "promptKey", "promptVersion", "entityId"], where: { status: "SENT", promptKey: { not: null }, direction: "OUT" } });
  const prospects = new Map((await prisma.clinicProspect.findMany({ select: { id: true, stage: true } })).map((p) => [p.id, p.stage as string]));
  const providers = new Map((await prisma.provider.findMany({ select: { id: true, stats: { select: { completedShifts: true } } } })).map((p) => [p.id, p.stats?.completedShifts ?? 0]));
  const prompts = new Map<string, { key: string; version: number; sent: number; engaged: number; booked: number; coverageReady: number; firstShift: number }>();
  for (const r of sent) {
    const k = `${r.promptKey}:${r.promptVersion}`;
    const row = prompts.get(k) ?? { key: r.promptKey!, version: r.promptVersion ?? 0, sent: 0, engaged: 0, booked: 0, coverageReady: 0, firstShift: 0 };
    row.sent++;
    if (r.entityType === "PROSPECT") {
      const st = prospects.get(r.entityId) ?? "";
      if ((AFTER_ENGAGED as readonly string[]).includes(st)) row.engaged++;
      if (booked(st)) row.booked++;
    } else if (r.entityType === "PROVIDER") {
      if (readyIds.has(r.entityId)) row.coverageReady++;
      if ((providers.get(r.entityId) ?? 0) >= 1) row.firstShift++;
    }
    prompts.set(k, row);
  }
  const metros = await prisma.clinicProspect.groupBy({ by: ["marketKey"], _count: { _all: true } });
  return { byCampaign, prompts: [...prompts.values()].sort((a, b) => a.key.localeCompare(b.key) || a.version - b.version), metros };
}
