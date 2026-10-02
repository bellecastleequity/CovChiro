import { prisma } from "@cm/db";
import { stateAreasByCode, type StateAreas } from "@cm/core";
import { absoluteUrl } from "@cm/services";

/** Site root without a trailing slash (APP_BASE_URL). */
export const siteUrl = () => absoluteUrl("/").replace(/\/$/, "");

/** "chiropractic" → "Chiropractic", "physical-therapy" → "Physical Therapy". */
export const serviceWord = (slug: string) => slug.split("-").map((w) => w[0].toUpperCase() + w.slice(1)).join(" ");

/** What's actually live: active professions × enabled states that have marketing service areas. */
export async function liveMarket() {
  const rows = await prisma.professionStateConfig.findMany({
    where: { enabled: true, profession: { active: true } },
    include: { profession: true },
    orderBy: { profession: { sortOrder: "asc" } },
  });
  const enabledStates = new Set((await prisma.stateConfig.findMany({ where: { enabled: true }, select: { state: true } })).map((s) => s.state));
  const pairs = rows
    .filter((r) => enabledStates.has(r.state))
    .map((r) => ({ profession: r.profession, state: stateAreasByCode(r.state) }))
    .filter((x): x is { profession: (typeof rows)[number]["profession"]; state: StateAreas } => !!x.state);
  return pairs;
}

/** The live (profession, state) pair for a landing URL, or null (→ 404). */
export async function landingPair(professionSlug: string, stateSlug: string) {
  return (await liveMarket()).find((p) => p.profession.slug === professionSlug && p.state.slug === stateSlug.toLowerCase()) ?? null;
}

export type RateGroup = { id: string; name: string; tier: number; zip3List: string[]; cards: { durationTier: string; volumeTier: string | null; clinicPriceCents: number }[] };

/** Current clinic prices per rate group (e.g. major vs smaller cities) for one profession in one state. */
export async function stateRates(professionCode: string, state: string): Promise<RateGroup[]> {
  const regions = await prisma.rateRegion.findMany({
    where: { state },
    include: { rateCards: { where: { professionCode, effectiveTo: null }, select: { durationTier: true, volumeTier: true, clinicPriceCents: true } } },
    orderBy: { tier: "asc" },
  });
  return regions.filter((r) => r.rateCards.length).map((r) => ({ id: r.id, name: r.name, tier: r.tier, zip3List: r.zip3List, cards: r.rateCards }));
}

export function priceRange(groups: RateGroup[]) {
  const all = groups.flatMap((g) => g.cards.map((c) => c.clinicPriceCents));
  return all.length ? { low: Math.min(...all), high: Math.max(...all) } : null;
}

/** Words for titles: the first live profession × state (falls back to generic wording). */
export async function marketWords() {
  const first = (await liveMarket().catch(() => []))[0];
  if (!first) return { service: "Healthcare", noun: "Provider", nounLower: "provider", state: "", suffix: "", slug: "", stateSlug: "" };
  return {
    service: serviceWord(first.profession.slug),
    noun: first.profession.displayName,
    nounLower: first.profession.displayName.toLowerCase(),
    state: first.state.name,
    suffix: first.profession.credentialSuffix,
    slug: first.profession.slug,
    stateSlug: first.state.slug,
  };
}
