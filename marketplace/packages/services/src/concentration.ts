import { NATIONAL_CREDENTIAL } from "@cm/core";
import { prisma } from "@cm/db";
import { clock, getSettings, requireAdmin, type Actor } from "./context";
import { liveSet, stateName } from "./enrollment";

/**
 * Shift concentration (Admin → Provider supply): is the work piling onto a few providers?
 *  - markets: per rate region (else state) × profession, booked/worked shifts starting in the last
 *    `days` days: total and the top providers' shares;
 *  - idle: providers ready for shifts (ACTIVE, approved 30+ days ago, a VERIFIED license in a live
 *    market) with no shift in the last 30 days, so someone can reach out;
 *  - heavy: providers averaging 5+ working days a week over the last 4 weeks (contractor-status
 *    check with the attorney; fatigue).
 * Read-only. The optional "spread the work" dispatch setting is dispatch.spreadWork* (off by default).
 */

const DAY = 86_400_000;
const BOOKED = ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] as const;

export async function shiftConcentration(actor: Actor, opts: { days?: number } = {}) {
  requireAdmin(actor);
  const days = opts.days ?? 30;
  const now = clock.now();
  const since = new Date(+now - days * DAY);
  const rows = await prisma.assignment.findMany({
    where: { status: { in: [...BOOKED] }, startsAt: { gte: since, lte: now } },
    select: {
      providerId: true,
      professionCode: true,
      state: true,
      provider: { select: { displayName: true } },
      shift: { select: { location: { select: { rateRegion: { select: { name: true } } } } } },
    },
  });

  // ---- markets ----
  const markets = new Map<string, { market: string; professionCode: string; total: number; by: Map<string, { providerId: string; name: string; count: number }> }>();
  for (const r of rows) {
    const region = r.shift.location.rateRegion?.name ?? stateName(r.state);
    const key = `${r.professionCode}:${region}`;
    const m = markets.get(key) ?? { market: region, professionCode: r.professionCode, total: 0, by: new Map() };
    m.total += 1;
    const p = m.by.get(r.providerId) ?? { providerId: r.providerId, name: r.provider.displayName, count: 0 };
    p.count += 1;
    m.by.set(r.providerId, p);
    markets.set(key, m);
  }
  const marketRows = [...markets.values()]
    .map((m) => {
      const ranked = [...m.by.values()].sort((a, b) => b.count - a.count);
      const top = ranked.slice(0, 3).map((p) => ({ ...p, share: p.count / m.total }));
      return {
        market: m.market,
        professionCode: m.professionCode,
        total: m.total,
        providers: ranked.length,
        top,
        top1Share: top[0]?.share ?? 0,
        top3Share: top.reduce((a, p) => a + p.count, 0) / m.total,
      };
    })
    .sort((a, b) => b.total - a.total);

  // ---- idle: ready, in a live market, no shift in 30 days ----
  const live = await liveSet();
  const readyBefore = new Date(+now - 30 * DAY);
  const ready = await prisma.provider.findMany({
    where: { status: "ACTIVE", OR: [{ adminApprovedAt: { lte: readyBefore } }, { adminApprovedAt: null, createdAt: { lte: readyBefore } }] },
    select: {
      id: true,
      displayName: true,
      adminApprovedAt: true,
      createdAt: true,
      licenses: { where: { status: "VERIFIED", state: { not: NATIONAL_CREDENTIAL } }, select: { professionCode: true, state: true } },
      assignments: { where: { status: { in: [...BOOKED] } }, orderBy: { startsAt: "desc" }, take: 1, select: { startsAt: true } },
    },
  });
  const idle = ready
    .filter((p) => p.licenses.some((l) => live.has(`${l.professionCode}:${l.state}`)))
    .filter((p) => !p.assignments[0] || +p.assignments[0].startsAt < +readyBefore)
    .map((p) => ({
      providerId: p.id,
      name: p.displayName,
      readySince: p.adminApprovedAt ?? p.createdAt,
      lastShift: p.assignments[0]?.startsAt ?? null,
      states: [...new Set(p.licenses.filter((l) => live.has(`${l.professionCode}:${l.state}`)).map((l) => l.state))],
    }))
    .sort((a, b) => +a.readySince - +b.readySince);

  // ---- heavy: 5+ working days a week over the last 4 weeks ----
  const s = await getSettings();
  const heavyDays = s["concentration.heavyDaysPerWeek"];
  const fourWeeks = await prisma.assignment.findMany({
    where: { status: { in: [...BOOKED] }, startsAt: { gte: new Date(+now - 28 * DAY), lte: now } },
    select: { providerId: true, startsAt: true, provider: { select: { displayName: true } }, shift: { select: { location: { select: { timeZone: true } } } } },
  });
  const daysBy = new Map<string, { name: string; days: Set<string> }>();
  for (const a of fourWeeks) {
    const d = daysBy.get(a.providerId) ?? { name: a.provider.displayName, days: new Set<string>() };
    d.days.add(a.startsAt.toLocaleDateString("en-CA", { timeZone: a.shift.location.timeZone }));
    daysBy.set(a.providerId, d);
  }
  const heavy = [...daysBy.entries()]
    .map(([providerId, d]) => ({ providerId, name: d.name, daysPerWeek: Math.round((d.days.size / 4) * 10) / 10 }))
    .filter((h) => h.daysPerWeek >= heavyDays)
    .sort((a, b) => b.daysPerWeek - a.daysPerWeek);

  return {
    days,
    markets: marketRows,
    idle,
    heavy,
    heavyDays,
    spreadWork: { percent: s["dispatch.spreadWorkPercent"], freeShifts: s["dispatch.spreadWorkFreeShifts"], maxPercent: s["dispatch.spreadWorkMaxPercent"], days: s["dispatch.spreadWorkDays"] },
  };
}
