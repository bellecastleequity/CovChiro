import "server-only";
import { prisma } from "@cm/db";
import { getSettings } from "@cm/services";
import type { CalcPrices } from "@/app/(public)/tools/cost-of-closing/calculator";

/** Current full-day Light / Busy clinic prices per rate group (e.g. major vs smaller cities) in open states, plus the visit rules. */
export async function calculatorPrices(): Promise<CalcPrices | null> {
  const s = await getSettings();
  const states = (await prisma.stateConfig.findMany({ where: { enabled: true }, select: { state: true } })).map((x) => x.state);
  const regions = await prisma.rateRegion.findMany({
    where: { state: { in: states } },
    include: { rateCards: { where: { durationTier: "FULL_DAY", effectiveTo: null, profession: { active: true } }, select: { clinicPriceCents: true, volumeTier: true } } },
    orderBy: { tier: "asc" },
  });
  const groups = new Map<number, { light: number[]; busy: number[] }>();
  for (const r of regions) {
    const g = groups.get(r.tier) ?? { light: [], busy: [] };
    for (const c of r.rateCards) (c.volumeTier === "LIGHT" ? g.light : g.busy).push(c.clinicPriceCents);
    groups.set(r.tier, g);
  }
  const out = [...groups.entries()]
    .filter(([, g]) => g.busy.length)
    .map(([tier, g]) => ({ tier, label: tier === 1 ? "Major city" : "Smaller city or town", lightCents: Math.min(...(g.light.length ? g.light : g.busy)), busyCents: Math.min(...g.busy) }));
  if (!out.length) return null;
  return {
    groups: out,
    lightCeiling: s["pricing.volumeLightVisitsFullDay"],
    busyCeiling: s["pricing.volumeBusyVisitsFullDay"],
    graceVisits: s["pricing.volumeGraceVisits"],
    overagePerVisitCents: s["pricing.volumeOverageClinicCents"],
  };
}

