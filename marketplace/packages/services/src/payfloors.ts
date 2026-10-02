import { DomainError, formatCents } from "@cm/core";
import { prisma } from "@cm/db";
import { audit, clock, requireAdmin, requireProvider, type Actor } from "./context";

/**
 * Provider minimum pay (Addendum 03 §7, filter F12 in core eligibility). A floor only filters
 * what the provider is shown and offered; it never changes a price (INV-7). Clinics never see it.
 */

const cents = (v: number | null | undefined) => {
  if (v == null) return null;
  if (!Number.isInteger(v) || v < 0 || v > 1_000_000) throw new DomainError("VALIDATION", "Enter a dollar amount.");
  return v || null;
};

export async function myPayFloors(actor: Actor) {
  const providerId = requireProvider(actor);
  return prisma.providerPayFloor.findMany({ where: { providerId } });
}

export async function savePayFloor(actor: Actor, input: { professionCode: string; minHalfDayCents?: number | null; minFullDayCents?: number | null; minHourlyCents?: number | null; includeMileage?: boolean }) {
  const providerId = requireProvider(actor);
  const pp = await prisma.providerProfession.findFirst({ where: { providerId, professionCode: input.professionCode } });
  if (!pp) throw new DomainError("VALIDATION", "Add this profession to your profile first.");
  const data = { minHalfDayCents: cents(input.minHalfDayCents), minFullDayCents: cents(input.minFullDayCents), minHourlyCents: cents(input.minHourlyCents), includeMileage: !!input.includeMileage };
  const before = await prisma.providerPayFloor.findUnique({ where: { providerId_professionCode: { providerId, professionCode: input.professionCode } } });
  if (!data.minHalfDayCents && !data.minFullDayCents && !data.minHourlyCents) {
    if (before) await prisma.providerPayFloor.delete({ where: { providerId_professionCode: { providerId, professionCode: input.professionCode } } });
  } else {
    await prisma.providerPayFloor.upsert({ where: { providerId_professionCode: { providerId, professionCode: input.professionCode } }, create: { providerId, professionCode: input.professionCode, ...data }, update: data });
  }
  await audit(prisma, actor, "payfloor.saved", "Provider", providerId, before, data);
}

/** "Florida chiropractic full days currently pay $390–$500 before extra visits." from live rate cards. */
export async function payGuidance(professionCode: string, states: string[]) {
  const now = clock.now();
  const cards = await prisma.rateCard.findMany({
    where: { professionCode, rateRegion: { state: { in: states.length ? states : ["FL"] } }, effectiveFrom: { lte: now }, OR: [{ effectiveTo: null }, { effectiveTo: { gt: now } }] },
    select: { durationTier: true, providerPayCents: true },
  });
  const range = (t: string) => {
    const v = cards.filter((c) => c.durationTier === t).map((c) => c.providerPayCents);
    return v.length ? { min: Math.min(...v), max: Math.max(...v) } : null;
  };
  const fmt = (r: { min: number; max: number } | null) => (r ? (r.min === r.max ? formatCents(r.min) : `${formatCents(r.min)}–${formatCents(r.max)}`) : null);
  return { halfDay: fmt(range("HALF_DAY")), fullDay: fmt(range("FULL_DAY")), hourly: fmt(range("HOURLY")) };
}

/** Admin: how floors are spread (feeds rate decisions). Never shown to clinics. */
export async function floorStats(actor: Actor) {
  requireAdmin(actor);
  const rows = await prisma.providerPayFloor.findMany({ select: { professionCode: true, minHalfDayCents: true, minFullDayCents: true } });
  const by = new Map<string, { providers: number; full: number[]; half: number[] }>();
  for (const r of rows) {
    const g = by.get(r.professionCode) ?? { providers: 0, full: [], half: [] };
    g.providers++;
    if (r.minFullDayCents) g.full.push(r.minFullDayCents);
    if (r.minHalfDayCents) g.half.push(r.minHalfDayCents);
    by.set(r.professionCode, g);
  }
  const med = (v: number[]) => (v.length ? [...v].sort((a, b) => a - b)[Math.floor(v.length / 2)] : null);
  return [...by.entries()].map(([professionCode, g]) => ({ professionCode, providers: g.providers, medianFullDayCents: med(g.full), medianHalfDayCents: med(g.half), maxFullDayCents: g.full.length ? Math.max(...g.full) : null }));
}
