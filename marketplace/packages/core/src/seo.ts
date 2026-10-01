import { US_STATES } from "./credentials";

/**
 * Search-engine rules (pure): URL slugs for the state/city landing pages and
 * which shifts may be published as public job postings. The web app renders;
 * these decide.
 */

export function slugify(s: string): string {
  return s
    .normalize("NFKD")
    .replace(/[̀-ͯ]/g, "")
    .toLowerCase()
    .replace(/&/g, " and ")
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-+|-+$/g, "");
}

/** "FL" → "florida"; "DC" (the district) → "district-of-columbia". */
export const stateSlug = (code: string) => slugify(US_STATES[code.toUpperCase()] ?? code);

export function stateFromSlug(slug: string): string | null {
  const s = slug.toLowerCase();
  return Object.keys(US_STATES).find((code) => slugify(US_STATES[code]) === s) ?? null;
}

/** Resolves a city slug against the configured city list (unknown city = no page). */
export function cityFromSlug(cities: string[], slug: string): string | null {
  return cities.find((c) => slugify(c) === slug.toLowerCase()) ?? null;
}

/** Display name: "St Petersburg" → "St. Petersburg". */
export const cityLabel = (city: string) => city.replace(/\b(St|Ft|Mt)\b(?!\.)/g, "$1.");

const toRad = (d: number) => (d * Math.PI) / 180;
function miles(a: { lat: number; lng: number }, b: { lat: number; lng: number }) {
  const h = Math.sin(toRad(b.lat - a.lat) / 2) ** 2 + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(toRad(b.lng - a.lng) / 2) ** 2;
  return 3958.8 * 2 * Math.asin(Math.sqrt(h));
}

/**
 * Nearby cities for internal links: by distance when both centers are known,
 * otherwise neighbours in the configured list (which is grouped by region).
 */
export function nearbyCities(city: string, cities: string[], centers: Record<string, { lat: number; lng: number } | undefined>, n = 6): string[] {
  const here = centers[city];
  const others = cities.filter((c) => c !== city);
  if (here) {
    const known = others.filter((c) => centers[c]).sort((a, b) => miles(here, centers[a]!) - miles(here, centers[b]!));
    if (known.length >= n) return known.slice(0, n);
  }
  const i = cities.indexOf(city);
  return others.sort((a, b) => Math.abs(cities.indexOf(a) - i) - Math.abs(cities.indexOf(b) - i)).slice(0, n);
}

/** Shift statuses still looking for a provider. */
export const OPEN_SHIFT_STATUSES = ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"] as const;

/**
 * A shift may appear as a public job posting only while it is open, posted,
 * not a standing booking, and starts in the future (with a little lead time,
 * so a posting never advertises a shift nobody can still reach).
 */
export function jobPostable(s: { status: string; postedAt: Date | null; startsAt: Date; standingBookingId: string | null; cancelledAt: Date | null }, now: Date, minLeadMinutes = 60): boolean {
  return (
    (OPEN_SHIFT_STATUSES as readonly string[]).includes(s.status) &&
    !!s.postedAt &&
    !s.standingBookingId &&
    !s.cancelledAt &&
    +s.startsAt - +now >= minLeadMinutes * 60_000
  );
}
