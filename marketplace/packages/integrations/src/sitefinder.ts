import { env } from "@cm/config";

/**
 * Website-first email finding (owner request Oct 2026): Google Maps (Places API, New) gives a
 * practice's website, then the server reads a few of its pages itself. No AI. Places uses
 * GOOGLE_MAPS_API_KEY (the "Places API (New)" must be enabled for it); pages are plain fetches.
 * Under test (or without a key for Places) the fake below is used.
 */

export interface PlaceHit { name: string | null; address: string | null; website: string | null; phone: string | null; status: string | null }
export interface PlaceSearch { ok: boolean; places: PlaceHit[]; error?: string; status?: number }
export interface Page { ok: boolean; url: string; html: string; status?: number; error?: string }

export interface SiteFinder {
  name: string;
  /** Places Text Search; null when no key (website lookup off). */
  findPlaces: ((query: string) => Promise<PlaceSearch>) | null;
  /** `allow` checks every address (and redirect hop) before it is fetched. */
  fetchPage(url: string, allow: (url: string) => boolean): Promise<Page>;
}

const MAX_BYTES = 1_500_000;
const UA = "Mozilla/5.0 (compatible; CoverageOnCallBot/1.0; +https://coverageoncall.com)";

async function readCapped(res: Response): Promise<string> {
  if (!res.body) return "";
  const reader = res.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (done || !value) break;
    chunks.push(value);
    size += value.length;
    if (size >= MAX_BYTES) { await reader.cancel().catch(() => undefined); break; }
  }
  return new TextDecoder("utf-8", { fatal: false }).decode(Buffer.concat(chunks.map((c) => Buffer.from(c))));
}

/** One page, redirects followed by hand so every hop is checked (no internal addresses). */
export async function fetchSitePage(url: string, allow: (url: string) => boolean, f: typeof fetch = fetch): Promise<Page> {
  let current = url;
  for (let hop = 0; hop < 5; hop++) {
    if (!allow(current)) return { ok: false, url: current, html: "", error: "address not allowed" };
    const ctl = new AbortController();
    const timer = setTimeout(() => ctl.abort(), 8000);
    try {
      const res = await f(current, { redirect: "manual", signal: ctl.signal, headers: { "User-Agent": UA, Accept: "text/html,application/xhtml+xml" } });
      if (res.status >= 300 && res.status < 400 && res.headers.get("location")) {
        current = new URL(res.headers.get("location")!, current).toString();
        continue;
      }
      const type = res.headers.get("content-type") ?? "";
      if (!res.ok) return { ok: false, url: current, html: "", status: res.status, error: `HTTP ${res.status}` };
      if (type && !/html|xml|text\/plain/i.test(type)) return { ok: false, url: current, html: "", status: res.status, error: `not a web page (${type.split(";")[0]})` };
      return { ok: true, url: current, html: await readCapped(res), status: res.status };
    } catch (e) {
      return { ok: false, url: current, html: "", error: (e as Error).name === "AbortError" ? "timed out" : (e as Error).message };
    } finally {
      clearTimeout(timer);
    }
  }
  return { ok: false, url: current, html: "", error: "too many redirects" };
}

export async function googlePlaces(key: string, query: string, f: typeof fetch = fetch): Promise<PlaceSearch> {
  try {
    const res = await f("https://places.googleapis.com/v1/places:searchText", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": key,
        "X-Goog-FieldMask": "places.displayName,places.formattedAddress,places.websiteUri,places.nationalPhoneNumber,places.businessStatus",
      },
      body: JSON.stringify({ textQuery: query, maxResultCount: 3, regionCode: "US" }),
    });
    const j = (await res.json().catch(() => ({}))) as {
      places?: { displayName?: { text?: string }; formattedAddress?: string; websiteUri?: string; nationalPhoneNumber?: string; businessStatus?: string }[];
      error?: { message?: string; status?: string };
    };
    if (!res.ok) return { ok: false, places: [], status: res.status, error: j.error?.message ?? `HTTP ${res.status}` };
    return {
      ok: true,
      places: (j.places ?? []).map((p) => ({ name: p.displayName?.text ?? null, address: p.formattedAddress ?? null, website: p.websiteUri ?? null, phone: p.nationalPhoneNumber ?? null, status: p.businessStatus ?? null })),
    };
  } catch (e) {
    return { ok: false, places: [], error: (e as Error).message };
  }
}

/** Plain-language fix for a Places refusal (shown on Prospecting and in the log). */
export function placesErrorHelp(error: string, status?: number): string {
  if (/not been used|disabled|SERVICE_DISABLED|not enabled/i.test(error)) return "Turn on \"Places API (New)\" for the Google Cloud project of GOOGLE_MAPS_API_KEY (APIs & Services → Library).";
  if (/referer|referrer|API_KEY_HTTP_REFERRER/i.test(error)) return "GOOGLE_MAPS_API_KEY only allows browser use. Use a server key (no website restriction).";
  if (/not authorized|API restrictions|API_KEY_SERVICE_BLOCKED|blocked/i.test(error)) return "The key's API restrictions don't include Places API (New). Add it in Google Cloud → Credentials → the key → API restrictions.";
  if (/billing/i.test(error)) return "Billing isn't enabled for the Google Cloud project.";
  if (status === 429 || /quota|rate/i.test(error)) return "Google's Places quota was reached; it resets on its own.";
  return "";
}

/** Fake for tests: pages and places set per test. */
export class FakeSiteFinder implements SiteFinder {
  name = "fake";
  pages = new Map<string, string>();
  places = new Map<string, PlaceHit[]>();
  placesError: string | null = null;
  calls: string[] = [];
  findPlaces = async (query: string): Promise<PlaceSearch> => {
    this.calls.push(`places:${query}`);
    if (this.placesError) return { ok: false, places: [], status: 403, error: this.placesError };
    const hit = [...this.places.entries()].find(([k]) => query.toLowerCase().includes(k.toLowerCase()));
    return { ok: true, places: hit?.[1] ?? [] };
  };
  async fetchPage(url: string, allow: (url: string) => boolean): Promise<Page> {
    if (!allow(url)) return { ok: false, url, html: "", error: "address not allowed" };
    this.calls.push(`page:${url}`);
    const key = url.replace(/\/$/, "");
    const html = this.pages.get(key) ?? this.pages.get(key.replace("://www.", "://"));
    return html === undefined ? { ok: false, url, html: "", status: 404, error: "HTTP 404" } : { ok: true, url, html };
  }
}

let override: SiteFinder | null = null;
export function setSiteFinder(f: SiteFinder | null) {
  override = f;
}

export function siteFinder(): SiteFinder {
  if (override) return override;
  const e = env();
  if (e.NODE_ENV === "test") return { name: "none", findPlaces: null, fetchPage: async (url) => ({ ok: false, url, html: "", error: "off under test" }) };
  const key = e.GOOGLE_MAPS_API_KEY;
  return { name: "web", findPlaces: key ? (q) => googlePlaces(key, q) : null, fetchPage: (u, allow) => fetchSitePage(u, allow) };
}
