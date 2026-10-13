import { prisma } from "@cm/db";
import { stateAreasByCode, type StateAreas } from "@cm/core";
import { absoluteUrl, getSettings } from "@cm/services";

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

/** label: shown instead of "Major cities" / "Smaller cities & towns" (statewide fallback prices). */
export type RateGroup = { id: string; name: string; tier: number; zip3List: string[]; label?: string; cards: { durationTier: string; volumeTier: string | null; clinicPriceCents: number }[] };

/**
 * Current clinic prices per rate group (e.g. major vs smaller cities) for one profession in one state.
 * A state without rate regions of its own is priced like posting does: the state's default region,
 * else pricing.nationalRateRegion, shown as one statewide group covering every listed city.
 */
export async function stateRates(professionCode: string, state: string): Promise<RateGroup[]> {
  const cards = { where: { professionCode, effectiveTo: null }, select: { durationTier: true, volumeTier: true, clinicPriceCents: true } } as const;
  const regions = await prisma.rateRegion.findMany({ where: { state }, include: { rateCards: cards }, orderBy: { tier: "asc" } });
  const own = regions.filter((r) => r.rateCards.length).map((r) => ({ id: r.id, name: r.name, tier: r.tier, zip3List: r.zip3List, cards: r.rateCards }));
  if (own.length) return own;
  const sc = await prisma.stateConfig.findUnique({ where: { state }, select: { defaultRateRegionId: true } });
  const national = (await getSettings())["pricing.nationalRateRegion"].trim();
  const fallback = sc?.defaultRateRegionId
    ? await prisma.rateRegion.findUnique({ where: { id: sc.defaultRateRegionId }, include: { rateCards: cards } })
    : national ? await prisma.rateRegion.findUnique({ where: { name: national }, include: { rateCards: cards } }) : null;
  if (!fallback?.rateCards.length) return [];
  const zips = [...new Set((stateAreasByCode(state)?.areas ?? []).flatMap((a) => a.cities.map((c) => c.zip3)))];
  return [{ id: fallback.id, name: fallback.name, tier: 1, zip3List: zips, label: "Statewide rates", cards: fallback.rateCards }];
}

/** Licensing facts for a live pair: malpractice minimums and the license lookup link (pair's own, else the state's). */
export async function stateFacts(professionCode: string, state: string) {
  const [psc, sc] = await Promise.all([
    prisma.professionStateConfig.findUnique({ where: { professionCode_state: { professionCode, state } }, select: { malpracticeMinOccurrenceCents: true, malpracticeMinAggregateCents: true, boardLookupUrl: true } }),
    prisma.stateConfig.findUnique({ where: { state }, select: { boardLookupUrl: true } }),
  ]);
  return {
    perClaimCents: psc?.malpracticeMinOccurrenceCents ?? null,
    aggregateCents: psc?.malpracticeMinAggregateCents ?? null,
    lookupUrl: psc?.boardLookupUrl || sc?.boardLookupUrl || null,
  };
}
export type StateFacts = Awaited<ReturnType<typeof stateFacts>>;

export function priceRange(groups: RateGroup[]) {
  const all = groups.flatMap((g) => g.cards.map((c) => c.clinicPriceCents));
  return all.length ? { low: Math.min(...all), high: Math.max(...all) } : null;
}

/**
 * Words for titles and descriptions. One open state → that state ("Chiropractic Coverage Florida");
 * more than one (open states, Oct 2026) → nationwide wording. Falls back to generic wording.
 */
export async function marketWords() {
  const first = (await liveMarket().catch(() => []))[0];
  if (!first) return { service: "Healthcare", noun: "Provider", nounLower: "provider", state: "", scope: "", where: "", suffix: "", slug: "", stateSlug: "" };
  const enabledStates = new Set((await prisma.stateConfig.findMany({ where: { enabled: true }, select: { state: true } })).map((s) => s.state));
  const openStates = (await prisma.professionStateConfig.findMany({ where: { professionCode: first.profession.code, enabled: true }, select: { state: true } })).filter((r) => enabledStates.has(r.state)).length;
  const nationwide = openStates > 1;
  return {
    service: serviceWord(first.profession.slug),
    noun: first.profession.displayName,
    nounLower: first.profession.displayName.toLowerCase(),
    state: nationwide ? "" : first.state.name,
    /** Title words after "<Service> Coverage": "Nationwide" or the one state's name. */
    scope: nationwide ? "Nationwide" : first.state.name,
    /** Sentence words: " across the U.S." or " in Florida". */
    where: nationwide ? " across the U.S." : ` in ${first.state.name}`,
    suffix: first.profession.credentialSuffix,
    slug: first.profession.slug,
    stateSlug: first.state.slug,
  };
}
