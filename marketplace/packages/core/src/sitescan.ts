import { acceptBusinessEmail } from "./prospecting";
import { acceptProviderEmail } from "./providerAcquisition";

/**
 * Finding a practice's email on its own website, without AI (owner request Oct 2026: AI web
 * research cost about $0.20-$0.40 per contact). The server reads a few of the practice's own
 * pages; these pure rules pull out the addresses, pick the one to keep and decide which pages to
 * read next. The same email rules as AI research apply (acceptBusinessEmail / acceptProviderEmail).
 */

const EMAIL = /[a-z0-9][a-z0-9._%+-]{0,63}@(?:[a-z0-9-]+\.)+[a-z]{2,24}/gi;
/** "name [at] domain [dot] com" and "(at)/(dot)" spellings some sites use against scrapers. */
const SPELLED = /([a-z0-9][a-z0-9._%+-]{0,63})\s*[[(]\s*at\s*[\])]\s*([a-z0-9-]+(?:\s*[[(]\s*dot\s*[\])]\s*[a-z0-9-]+)+)/gi;
const NOT_A_TLD = /\.(png|jpe?g|gif|svg|webp|avif|ico|css|js|mjs|json|xml|pdf|woff2?|ttf|eot|mp4|webm|min)$/i;

/** Cloudflare's "email protection": hex, first byte is the key, the rest XORed with it. */
export function decodeCfEmail(hex: string): string | null {
  if (!/^[0-9a-f]{4,}$/i.test(hex) || hex.length % 2) return null;
  const key = parseInt(hex.slice(0, 2), 16);
  let out = "";
  for (let i = 2; i < hex.length; i += 2) out += String.fromCharCode(parseInt(hex.slice(i, i + 2), 16) ^ key);
  return /^[^@\s]+@[^@\s]+\.[a-z]{2,}$/i.test(out) ? out : null;
}

const decodeEntities = (s: string) =>
  s.replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n))).replace(/&#x([0-9a-f]+);/gi, (_, n) => String.fromCharCode(parseInt(n, 16))).replace(/&amp;/g, "&").replace(/&nbsp;/g, " ");

/** Every address on a page (lower case, de-duplicated, in page order). */
export function extractEmails(html: string): string[] {
  const out = new Set<string>();
  const add = (e: string | null) => {
    if (!e) return;
    const v = e.trim().toLowerCase().replace(/^mailto:/, "").replace(/[.,;:]+$/, "");
    if (!/^[^@\s]+@[^@\s]+\.[a-z]{2,24}$/.test(v) || NOT_A_TLD.test(v) || /@\d+x\./.test(v)) return;
    out.add(v);
  };
  for (const m of html.matchAll(/data-cfemail\s*=\s*["']([0-9a-f]+)["']/gi)) add(decodeCfEmail(m[1]));
  for (const m of html.matchAll(/email-protection#([0-9a-f]+)/gi)) add(decodeCfEmail(m[1]));
  const text = decodeEntities(html);
  for (const m of text.matchAll(/mailto:([^"'?\s>]+)/gi)) add(decodeURIComponent(m[1]));
  for (const m of text.matchAll(EMAIL)) add(m[0]);
  for (const m of text.matchAll(SPELLED)) add(`${m[1]}@${m[2].replace(/\s*[[(]\s*dot\s*[\])]\s*/gi, ".")}`);
  return [...out];
}

const hostOf = (u: string | null | undefined) => {
  if (!u) return null;
  try { return new URL(u.includes("//") ? u : `https://${u}`).host.toLowerCase().replace(/^www\./, ""); } catch { return null; }
};
const FREE_MAIL = /(^|\.)(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|me|mac|comcast|bellsouth|att|verizon|protonmail|proton)\.(com|net|me)$/;
const FRONT_DESK = /^(info|office|contact|frontdesk|front\.desk|front|hello|admin|appointments?|appts|reception|team|care|clinic|chiro|chiropractic|scheduling|schedule|staff|mail|inquiries|wellness|help)\d*$/;

export interface FoundEmail { email: string; url: string }

/**
 * The practice's business email from what its pages showed: its own domain first (a front-desk
 * mailbox before a person's), else a front-desk mailbox on free mail (small clinics often use
 * gmail). Another business's domain is usually the web designer or a parent company: never kept.
 */
export function pickClinicEmail(found: FoundEmail[], website: string | null): FoundEmail | null {
  const host = hostOf(website);
  const ok = found.filter((f) => acceptBusinessEmail(f.email, website));
  const domainOf = (e: string) => e.split("@")[1];
  const local = (e: string) => e.split("@")[0];
  const own = ok.filter((f) => host && (domainOf(f.email) === host || domainOf(f.email).endsWith(`.${host}`)));
  return own.find((f) => FRONT_DESK.test(local(f.email))) ?? own[0]
    ?? ok.find((f) => FREE_MAIL.test(domainOf(f.email)) && FRONT_DESK.test(local(f.email))) ?? null;
}

/** A provider's own address on their practice's site (same rule as researched contacts). */
export function pickProviderEmail(found: FoundEmail[], c: { firstName: string | null; lastName: string | null; website: string | null; practiceRole: "OWNER" | "ASSOCIATE" | "UNKNOWN"; providersAtPractice: number }): FoundEmail | null {
  const checked = found.map((f) => ({ f, r: acceptProviderEmail({ ...c, email: f.email }) })).filter((x) => x.r.ok);
  return (checked.find((x) => x.r.reason === "attributed") ?? checked[0])?.f ?? null;
}

const PAGE_WORDS: [RegExp, number][] = [
  [/contact|reach-us|get-in-touch/i, 0],
  [/about|team|staff|doctor|our-dr|meet|provider/i, 1],
  [/location|office|hours|directions/i, 2],
  [/appointment|schedule|book|new-patient|request/i, 3],
];

/** The site's own pages most likely to list an email, contact pages first. */
export function contactPageLinks(html: string, baseUrl: string, max = 4): string[] {
  const base = hostOf(baseUrl);
  const seen = new Map<string, { url: string; rank: number; i: number }>();
  let i = 0;
  for (const m of html.matchAll(/<a\b[^>]*href\s*=\s*["']([^"'#][^"']*)["'][^>]*>([\s\S]{0,200}?)<\/a>/gi)) {
    const href = m[1].trim();
    if (/^(mailto|tel|javascript|sms):/i.test(href)) continue;
    let u: URL;
    try { u = new URL(href, baseUrl); } catch { continue; }
    if (!/^https?:$/.test(u.protocol) || u.host.toLowerCase().replace(/^www\./, "") !== base) continue;
    if (NOT_A_TLD.test(u.pathname)) continue;
    const words = `${u.pathname} ${m[2].replace(/<[^>]+>/g, " ")}`;
    const rank = PAGE_WORDS.find(([re]) => re.test(words))?.[1];
    if (rank === undefined) continue;
    u.hash = "";
    const key = `${u.host.replace(/^www\./, "")}${u.pathname.replace(/\/$/, "")}`;
    if (!seen.has(key)) seen.set(key, { url: u.toString().replace(/\/$/, ""), rank, i: i++ });
  }
  return [...seen.values()].sort((a, b) => a.rank - b.rank || a.i - b.i).slice(0, max).map((x) => x.url);
}

/** A form someone can write to (an email field or a message box), not a site search. */
export function hasContactForm(html: string): boolean {
  return [...html.matchAll(/<form\b[\s\S]*?<\/form>/gi)].some((f) => /type\s*=\s*["']email["']|<textarea/i.test(f[0]));
}

const SOCIAL = /^https:\/\/(www\.)?(facebook\.com|instagram\.com|linkedin\.com|youtube\.com|x\.com|twitter\.com|tiktok\.com)\/[^"'\s]+$/i;
const SHARE = /sharer|share\?|intent\/|\/share|dialog\/|plugins\//i;

/** The practice's own social profiles linked from its site (never share buttons). */
export function siteSocialLinks(html: string): string[] {
  const out = new Set<string>();
  for (const m of html.matchAll(/href\s*=\s*["'](https:\/\/[^"']+)["']/gi)) if (SOCIAL.test(m[1]) && !SHARE.test(m[1])) out.add(m[1]);
  return [...out].slice(0, 6);
}

const digits = (s: string | null | undefined) => (s ?? "").replace(/\D/g, "").replace(/^1(?=\d{10}$)/, "");

/** Is this Google Maps place the practice at the registry address? Same ZIP + street number, or the same phone. */
export function placeMatches(p: { address: string | null; zip: string | null; phone: string | null }, place: { address: string | null; phone: string | null }): boolean {
  if (digits(p.phone).length === 10 && digits(p.phone) === digits(place.phone)) return true;
  const zip = (p.zip ?? "").replace(/\D/g, "").slice(0, 5);
  const num = /^\s*(\d+)/.exec(p.address ?? "")?.[1];
  const a = place.address ?? "";
  return !!zip && !!num && new RegExp(`\\b${zip}\\b`).test(a) && new RegExp(`^\\s*${num}\\b`).test(a);
}

/** A website address cleaned for storing: https assumed, tracking parameters and a bare "/" dropped. */
export function siteUrl(raw: string | null | undefined): string | null {
  if (!raw || /\s/.test(raw.trim())) return null;
  try {
    const u = new URL(raw.includes("//") ? raw.trim() : `https://${raw.trim()}`);
    if (!/^https?:$/.test(u.protocol) || !u.host.includes(".")) return null;
    for (const k of [...u.searchParams.keys()]) if (/^(utm_|gclid|fbclid|y_source)/i.test(k)) u.searchParams.delete(k);
    u.hash = "";
    return u.toString().replace(/\/$/, "");
  } catch {
    return null;
  }
}

/** Only ordinary public web addresses are fetched: no internal hosts, IP literals or odd ports. */
export function safeFetchUrl(raw: string): boolean {
  let u: URL;
  try { u = new URL(raw); } catch { return false; }
  if (!/^https?:$/.test(u.protocol) || u.port || u.username || u.password) return false;
  const h = u.hostname.toLowerCase();
  if (!h.includes(".") || h.startsWith("[") || /^[\d.]+$/.test(h)) return false;
  return !/(^|\.)(localhost|local|internal|intranet|lan|home|corp)$/.test(h);
}
