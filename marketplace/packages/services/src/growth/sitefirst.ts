import { contactPageLinks, extractEmails, hasContactForm, placeMatches, safeFetchUrl, siteSocialLinks, siteUrl, type FoundEmail } from "@cm/core";
import { prisma, type Prisma } from "@cm/db";
import { placesErrorHelp, siteFinder } from "@cm/integrations";
import { DateTime } from "luxon";
import { clock, getSettings } from "../context";
import { logAgent } from "./engine";

/**
 * Website first (owner request Oct 2026: AI web research cost about $0.20-$0.40 per contact).
 * findWebsite: Google Maps (Places API, New) lookup of a practice we have no website for, kept
 * only when the listing matches the registry address or phone. readSite: the server reads the
 * home page and the site's own contact/about pages and collects the addresses shown. Which
 * address is kept is decided by core (pickClinicEmail / pickProviderEmail), never here.
 */

const PAUSE_KEY = "growth.placesPause";

export async function placesPause(): Promise<{ until: Date; error: string; help: string } | null> {
  const row = await prisma.setting.findUnique({ where: { key: PAUSE_KEY } });
  const v = row?.value as { until?: string; error?: string; help?: string } | null;
  if (!v?.until || new Date(v.until) <= clock.now()) return null;
  return { until: new Date(v.until), error: v.error ?? "", help: v.help ?? "" };
}

export async function clearPlacesPause() {
  await prisma.setting.deleteMany({ where: { key: PAUSE_KEY } });
}

/** Website lookups this calendar month (Eastern time), for the monthly cap. */
export async function placesLookupsThisMonth(): Promise<number> {
  const start = DateTime.fromJSDate(clock.now(), { zone: "America/New_York" }).startOf("month").toJSDate();
  return prisma.dataSourceUsage.count({ where: { source: "google_places", createdAt: { gte: start } } });
}

export type WebsiteLookup =
  | { website: string; name: string | null; phone: string | null; closed: boolean; reason?: undefined }
  | { website: null; reason: "off" | "no_key" | "cap" | "paused" | "no_match" | "no_website" | "error"; name?: string | null; phone?: string | null; closed?: boolean };

/** A practice's website from its Google Maps listing (one Text Search, counted against the monthly cap). */
export async function findWebsite(p: { name: string; noun: string; nameIsPerson: boolean; address: string | null; city: string | null; state: string; zip: string | null; phone: string | null }, task: string): Promise<WebsiteLookup> {
  const s = await getSettings();
  const finder = siteFinder();
  if (!s["growth.researchFindWebsite"] || s["growth.researchPlacesMonthlyCap"] <= 0) return { website: null, reason: "off" };
  if (!finder.findPlaces) return { website: null, reason: "no_key" };
  if (await placesPause()) return { website: null, reason: "paused" };
  if ((await placesLookupsThisMonth()) >= s["growth.researchPlacesMonthlyCap"]) return { website: null, reason: "cap" };
  const where = [p.address, p.city, `${p.state} ${p.zip ?? ""}`.trim()].filter(Boolean).join(", ");
  const r = await finder.findPlaces(`${p.name}${p.nameIsPerson ? ` ${p.noun}` : ""}, ${where}`);
  await prisma.dataSourceUsage.create({ data: { source: "google_places", operation: "text_search", task, region: p.state, records: r.places.length, ok: r.ok, error: r.ok ? null : (r.error ?? "").slice(0, 250) } });
  if (!r.ok) {
    const help = placesErrorHelp(r.error ?? "", r.status);
    // A key or setup problem won't fix itself between clinics: stop looking up for a while.
    if (r.status === 400 || r.status === 403 || r.status === 429) {
      const until = new Date(+clock.now() + (r.status === 429 ? 60 : 6 * 60) * 60_000);
      const value = { until: until.toISOString(), error: (r.error ?? "").slice(0, 300), help } as unknown as Prisma.InputJsonValue;
      await prisma.setting.upsert({ where: { key: PAUSE_KEY }, create: { key: PAUSE_KEY, value }, update: { value } });
      await logAgent("clinicProspecting", "places_paused", { output: `Google Maps website lookups paused until ${until.toISOString()}. ${help}`.trim(), error: (r.error ?? "").slice(0, 300) });
    }
    return { website: null, reason: "error" };
  }
  const match = r.places.filter((pl) => placeMatches({ address: p.address, zip: p.zip, phone: p.phone }, { address: pl.address, phone: pl.phone }));
  const withSite = match.find((pl) => siteUrl(pl.website));
  const closed = match.some((pl) => pl.status === "CLOSED_PERMANENTLY");
  if (withSite) return { website: siteUrl(withSite.website)!, name: withSite.name, phone: withSite.phone, closed: withSite.status === "CLOSED_PERMANENTLY" };
  return { website: null, reason: match.length ? "no_website" : "no_match", name: match[0]?.name ?? null, phone: match[0]?.phone ?? null, closed };
}

export interface SiteRead { reachable: boolean; home: string | null; emails: FoundEmail[]; pages: string[]; contactForm: boolean; socials: string[]; error?: string }

/**
 * Reads the home page, then the site's own contact/about pages (up to growth.researchSitePages in all),
 * stopping as soon as `enough` is satisfied by what has been found.
 */
export async function readSite(website: string, enough: (found: FoundEmail[]) => boolean): Promise<SiteRead> {
  const s = await getSettings();
  const finder = siteFinder();
  const out: SiteRead = { reachable: false, home: null, emails: [], pages: [], contactForm: false, socials: [] };
  const take = (url: string, html: string) => {
    out.pages.push(url);
    for (const e of extractEmails(html)) if (!out.emails.some((f) => f.email === e)) out.emails.push({ email: e, url });
    out.contactForm ||= hasContactForm(html);
    for (const u of siteSocialLinks(html)) if (!out.socials.includes(u)) out.socials.push(u);
  };
  const home = await finder.fetchPage(website, safeFetchUrl);
  if (!home.ok) return { ...out, error: home.error };
  out.reachable = true;
  out.home = home.url;
  take(home.url, home.html);
  for (const link of contactPageLinks(home.html, home.url, Math.max(0, s["growth.researchSitePages"] - 1))) {
    if (enough(out.emails)) break;
    const page = await finder.fetchPage(link, safeFetchUrl);
    if (page.ok) take(page.url, page.html);
  }
  return out;
}
