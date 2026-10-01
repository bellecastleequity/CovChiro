import { cityFromSlug, jobPostable, nearbyCities, OPEN_SHIFT_STATUSES, slugify, stateFromSlug, US_STATES } from "@cm/core";
import { prisma } from "@cm/db";
import { haversineMiles } from "@cm/integrations";
import { clock, getSettings } from "./context";

/**
 * Data for the public search-engine pages: which profession/state/city pages
 * exist, honest local numbers for them, and open shifts published as job
 * postings. Public output only: never a clinic's name, street address or
 * contact details, and never patient information.
 */

const NEARBY_MILES = 50;

/** Live professions (active, with at least one enabled state). */
export async function seoLive() {
  const professions = await prisma.profession.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, include: { stateConfigs: { where: { enabled: true }, select: { state: true } } } });
  return professions.filter((p) => p.stateConfigs.length).map((p) => ({ code: p.code, slug: p.slug, name: p.displayName, suffix: p.credentialSuffix, states: p.stateConfigs.map((s) => s.state).sort() }));
}

export async function seoCities(state: string): Promise<string[]> {
  const s = await getSettings();
  return s["seo.cities"][state.toUpperCase()] ?? [];
}

/** Resolves /{profession}/{state}/{city} slugs; null = no such page. */
export async function resolveSeoPath(professionSlug: string, stateSlugValue: string, citySlug?: string) {
  const profession = await prisma.profession.findUnique({ where: { slug: professionSlug } });
  const state = stateFromSlug(stateSlugValue);
  if (!profession?.active || !state) return null;
  const enabled = await prisma.professionStateConfig.findUnique({ where: { professionCode_state: { professionCode: profession.code, state } } });
  if (!enabled?.enabled) return null;
  const cities = await seoCities(state);
  const city = citySlug ? cityFromSlug(cities, citySlug) : null;
  if (citySlug && !city) return null;
  return { profession, state, stateName: US_STATES[state], cities, city };
}

const cityKey = (c: string) => slugify(c).replace(/^saint-/, "st-").replace(/^fort-/, "ft-");

/** City centers from the practices we know about (geocoded prospects), keyed by configured city name. */
export async function cityCenters(state: string, cities: string[]) {
  const rows = await prisma.clinicProspect.groupBy({ by: ["city"], where: { state, lat: { not: null }, lng: { not: null }, city: { not: null } }, _avg: { lat: true, lng: true }, _count: { _all: true } });
  const byKey = new Map(rows.map((r) => [cityKey(r.city!), r]));
  const out: Record<string, { lat: number; lng: number; practices: number } | undefined> = {};
  for (const c of cities) {
    const r = byKey.get(cityKey(c));
    if (r?._avg.lat != null && r._avg.lng != null) out[c] = { lat: r._avg.lat, lng: r._avg.lng, practices: r._count._all };
  }
  return out;
}

/** Verified providers (this profession + state license) who live within NEARBY_MILES of a point. */
async function providersNear(professionCode: string, state: string, at: { lat: number; lng: number }) {
  const rows = await prisma.provider.findMany({
    where: { status: { notIn: ["SUSPENDED", "DEACTIVATED"] }, homeLat: { not: null }, homeLng: { not: null }, licenses: { some: { professionCode, state, status: "VERIFIED", expiresAt: { gt: clock.now() } } } },
    select: { homeLat: true, homeLng: true },
  });
  return rows.filter((r) => haversineMiles(at, { lat: r.homeLat!, lng: r.homeLng! }) <= NEARBY_MILES).length;
}

/** Everything a city page shows. Numbers below seo.localStatsMinimum are hidden rather than shown as tiny. */
export async function cityPageData(professionCode: string, state: string, city: string, cities: string[]) {
  const s = await getSettings();
  const centers = await cityCenters(state, cities);
  const center = centers[city];
  const min = s["seo.localStatsMinimum"];
  const providers = center ? await providersNear(professionCode, state, center) : 0;
  const jobs = (await publicJobs({ professionCode, state })).filter((j) => cityKey(j.city) === cityKey(city) || (center && j.lat != null && j.lng != null && haversineMiles(center, { lat: j.lat, lng: j.lng }) <= 25));
  return {
    nearby: nearbyCities(city, cities, centers, 8),
    practices: professionCode === "DC" && (center?.practices ?? 0) >= min ? center!.practices : null,
    providersNearby: providers >= min ? providers : null,
    radiusMiles: NEARBY_MILES,
    jobs,
  };
}

export interface PublicJob {
  id: string;
  professionCode: string;
  professionName: string;
  professionSlug: string;
  city: string;
  state: string;
  zip: string;
  lat: number | null;
  lng: number | null;
  timeZone: string;
  startsAt: Date;
  endsAt: Date;
  postedAt: Date;
  providerPayCents: number;
  expectedPatients: number | null;
  travelBudget: boolean;
  lodging: boolean;
  urgent: boolean;
}

function toPublic(sh: {
  id: string; professionCode: string; startsAt: Date; endsAt: Date; postedAt: Date | null; providerPayCents: number; expectedPatients: number | null; maxTravelBudgetCents: number | null;
  lodgingAllowed: boolean; emergencyAt: Date | null; emergencyBonusPercent: number; location: { city: string; state: string; zip: string; lat: number; lng: number; timeZone: string };
}, prof: { displayName: string; slug: string }): PublicJob {
  return {
    id: sh.id, professionCode: sh.professionCode, professionName: prof.displayName, professionSlug: prof.slug,
    city: sh.location.city, state: sh.location.state, zip: sh.location.zip.slice(0, 5),
    // Rounded to ~1 km so a posting never pinpoints the office.
    lat: Math.round(sh.location.lat * 100) / 100, lng: Math.round(sh.location.lng * 100) / 100,
    timeZone: sh.location.timeZone, startsAt: sh.startsAt, endsAt: sh.endsAt, postedAt: sh.postedAt!,
    providerPayCents: sh.emergencyBonusPercent ? Math.round(sh.providerPayCents * (1 + sh.emergencyBonusPercent / 100)) : sh.providerPayCents,
    expectedPatients: sh.expectedPatients, travelBudget: (sh.maxTravelBudgetCents ?? 0) > 0, lodging: sh.lodgingAllowed, urgent: !!sh.emergencyAt,
  };
}

const JOB_SELECT = {
  id: true, professionCode: true, startsAt: true, endsAt: true, postedAt: true, providerPayCents: true, expectedPatients: true, maxTravelBudgetCents: true, lodgingAllowed: true,
  emergencyAt: true, emergencyBonusPercent: true, status: true, standingBookingId: true, cancelledAt: true,
  location: { select: { city: true, state: true, zip: true, lat: true, lng: true, timeZone: true } },
} as const;

/** Open shifts publishable as job postings (seo.publicJobListings), soonest first. */
export async function publicJobs(f: { professionCode?: string; state?: string; take?: number } = {}): Promise<PublicJob[]> {
  const s = await getSettings();
  if (!s["seo.publicJobListings"]) return [];
  const now = clock.now();
  const [rows, professions] = await Promise.all([
    prisma.shift.findMany({
      where: {
        status: { in: [...OPEN_SHIFT_STATUSES] }, postedAt: { not: null }, standingBookingId: null, cancelledAt: null, startsAt: { gt: now },
        ...(f.professionCode ? { professionCode: f.professionCode } : {}), ...(f.state ? { state: f.state } : {}),
      },
      select: JOB_SELECT,
      orderBy: { startsAt: "asc" },
      take: f.take ?? 500,
    }),
    prisma.profession.findMany({ where: { active: true }, select: { code: true, displayName: true, slug: true } }),
  ]);
  const prof = new Map(professions.map((p) => [p.code, p]));
  return rows.filter((r) => prof.has(r.professionCode) && jobPostable(r, now)).map((r) => toPublic(r, prof.get(r.professionCode)!));
}

/** One posting; null once it's filled, cancelled, started or unpublished (the page then 404s). */
export async function publicJob(id: string): Promise<PublicJob | null> {
  const s = await getSettings();
  if (!s["seo.publicJobListings"]) return null;
  const sh = await prisma.shift.findUnique({ where: { id }, select: JOB_SELECT });
  if (!sh || !jobPostable(sh, clock.now())) return null;
  const prof = await prisma.profession.findUnique({ where: { code: sh.professionCode } });
  return prof?.active ? toPublic(sh, prof) : null;
}

/** Every indexable URL path with its last change, for sitemap.xml. */
export async function sitemapEntries(): Promise<{ path: string; lastModified?: Date; priority: number; changeFrequency: "daily" | "weekly" | "monthly" }[]> {
  const [live, allProfessions, jobs] = await Promise.all([seoLive(), prisma.profession.findMany({ select: { slug: true, active: true } }), publicJobs()]);
  const out: Awaited<ReturnType<typeof sitemapEntries>> = [
    { path: "/", priority: 1, changeFrequency: "weekly" },
    { path: "/for-clinics", priority: 0.9, changeFrequency: "monthly" },
    { path: "/for-providers", priority: 0.9, changeFrequency: "monthly" },
    { path: "/how-it-works", priority: 0.7, changeFrequency: "monthly" },
    { path: "/tools/cost-of-closing", priority: 0.7, changeFrequency: "monthly" },
    { path: "/states", priority: 0.6, changeFrequency: "weekly" },
    { path: "/faq", priority: 0.6, changeFrequency: "monthly" },
    { path: "/contact", priority: 0.4, changeFrequency: "monthly" },
    { path: "/jobs", priority: 0.8, changeFrequency: "daily" },
  ];
  for (const p of allProfessions) out.push({ path: `/${p.slug}`, priority: p.active ? 0.9 : 0.4, changeFrequency: "monthly" });
  for (const p of live) {
    for (const st of p.states) {
      const stSlug = slugify(US_STATES[st]);
      out.push({ path: `/${p.slug}/${stSlug}`, priority: 0.8, changeFrequency: "weekly" });
      out.push({ path: `/jobs/${p.slug}/${stSlug}`, priority: 0.8, changeFrequency: "daily" });
      for (const c of await seoCities(st)) {
        out.push({ path: `/${p.slug}/${stSlug}/${slugify(c)}`, priority: 0.7, changeFrequency: "weekly" });
        out.push({ path: `/jobs/${p.slug}/${stSlug}/${slugify(c)}`, priority: 0.6, changeFrequency: "daily" });
      }
    }
  }
  for (const j of jobs) out.push({ path: `/jobs/shift/${j.id}`, lastModified: j.postedAt, priority: 0.6, changeFrequency: "daily" });
  return out;
}
