import type { Side } from "./acquisition";
import { CA_PROVINCES, US_STATES } from "./credentials";

/**
 * Apollo.io as one more prospecting source (owner request Oct 2026). Pure helpers: region codes,
 * search bodies, record mapping and the credit budget. An Apollo record is a lead, never proof of a
 * license: provider eligibility stays with verified credentials (INV-1).
 */

const byName = (table: Record<string, string>) => new Map(Object.entries(table).map(([code, name]) => [name.toLowerCase(), code]));
const US_BY_NAME = byName(US_STATES);
const CA_BY_NAME = byName(CA_PROVINCES);
const norm = (s: string) => s.trim().toLowerCase().replace(/\./g, "").replace(/\s+/g, " ");

/** Apollo's state + country → our region code (US state/territory or Canadian province), else null. */
export function apolloRegion(state: string | null | undefined, country: string | null | undefined): string | null {
  const c = country ? norm(country) : "";
  const s = state ? norm(state) : "";
  if (/puerto rico/.test(c) || /puerto rico/.test(s)) return "PR";
  if (/virgin islands/.test(c) || /virgin islands/.test(s) || ["st croix", "st thomas", "st john"].includes(s)) return "VI";
  const isCa = c === "canada" || c === "ca";
  const isUs = ["united states", "us", "usa", "united states of america"].includes(c);
  if (!isCa && !isUs) return null;
  if (!s) return null;
  if (isCa) {
    if (CA_PROVINCES[s.toUpperCase()]) return s.toUpperCase();
    return CA_BY_NAME.get(s) ?? null;
  }
  if (US_STATES[s.toUpperCase()]) return s.toUpperCase();
  return US_BY_NAME.get(s) ?? null;
}

/** Apollo location filter text for a region (and optional city). */
export function apolloLocation(region: string, city?: string | null): string {
  const r = region.toUpperCase();
  let place: string;
  if (r === "PR") place = "Puerto Rico";
  else if (r === "VI") place = "U.S. Virgin Islands";
  else if (CA_PROVINCES[r]) place = `${CA_PROVINCES[r]}, Canada`;
  else place = `${US_STATES[r] ?? r}, US`;
  return city?.trim() ? `${city.trim()}, ${place}` : place;
}

/**
 * Request body for Apollo's people search. SUPPLY = practitioners by title where they live/work;
 * DEMAND = decision-makers (owner, director, manager) at companies of this kind headquartered there.
 */
export function apolloSearchBody(side: Side, q: { region: string; city?: string | null; titles: string[]; keywords: string[]; page: number; perPage: number }) {
  const loc = [apolloLocation(q.region, q.city)];
  const paging = { page: Math.max(1, Math.min(500, Math.floor(q.page))), per_page: Math.max(1, Math.min(100, Math.floor(q.perPage))) };
  if (side === "SUPPLY") return { person_titles: q.titles, person_locations: loc, ...paging };
  return { person_titles: q.titles, organization_locations: loc, ...(q.keywords.length ? { q_organization_keyword_tags: q.keywords } : {}), ...paging };
}

/** Body for Apollo's organization search (clinics of a kind headquartered in a region). */
export function apolloOrganizationSearchBody(q: { region: string; city?: string | null; keywords: string[]; page: number; perPage: number }) {
  return {
    organization_locations: [apolloLocation(q.region, q.city)],
    ...(q.keywords.length ? { q_organization_keyword_tags: q.keywords } : {}),
    page: Math.max(1, Math.min(500, Math.floor(q.page))),
    per_page: Math.max(1, Math.min(100, Math.floor(q.perPage))),
  };
}

type Raw = Record<string, unknown>;
const s = (v: unknown) => (typeof v === "string" && v.trim() ? v.trim() : null);

export interface ApolloPerson {
  apolloPersonId: string;
  apolloOrganizationId: string | null;
  firstName: string | null;
  lastName: string | null;
  /** Search results hide the surname until the person is enriched. */
  lastNameHidden: boolean;
  title: string | null;
  city: string | null;
  region: string | null;
  organizationName: string | null;
  organizationDomain: string | null;
  email: string | null;
  emailStatus: string | null;
}

export function mapApolloPerson(p: Raw): ApolloPerson | null {
  const id = s(p.id);
  if (!id) return null;
  const org = (p.organization && typeof p.organization === "object" ? p.organization : {}) as Raw;
  const lastName = s(p.last_name);
  return {
    apolloPersonId: id,
    apolloOrganizationId: s(p.organization_id) ?? s(org.id),
    firstName: s(p.first_name),
    lastName,
    lastNameHidden: !lastName && !!s(p.last_name_obfuscated),
    title: s(p.title),
    city: s(p.city),
    region: apolloRegion(s(p.state), s(p.country)),
    organizationName: s(org.name),
    organizationDomain: s(org.primary_domain),
    email: s(p.email)?.toLowerCase() ?? null,
    emailStatus: s(p.email_status)?.toLowerCase() ?? null,
  };
}

/** Apollo returns placeholder addresses for emails it hasn't revealed. */
const PLACEHOLDER = /^email_not_unlocked@|@domain\.com$|not_unlocked/i;

/** An Apollo email worth keeping: verified (or "likely" when the admin allows it), never a placeholder. Our own acceptance rules still apply after this. */
export function usableApolloEmail(p: { email: string | null; emailStatus: string | null }, allowLikely: boolean): string | null {
  if (!p.email || PLACEHOLDER.test(p.email)) return null;
  const st = (p.emailStatus ?? "").toLowerCase();
  if (st === "verified") return p.email;
  if (allowLikely && st.startsWith("likely")) return p.email;
  return null;
}

export interface ApolloOrganization {
  apolloOrganizationId: string;
  name: string;
  website: string | null;
  domain: string | null;
  phone: string | null;
  address: string | null;
  city: string | null;
  region: string | null;
  zip: string | null;
}

export function mapApolloOrganization(o: Raw): ApolloOrganization | null {
  const id = s(o.id);
  const name = s(o.name);
  if (!id || !name) return null;
  const phone = s(o.phone) ?? s((o.primary_phone as Raw | undefined)?.number);
  return {
    apolloOrganizationId: id, name, website: s(o.website_url), domain: s(o.primary_domain), phone,
    address: s(o.street_address), city: s(o.city), region: apolloRegion(s(o.state), s(o.country)), zip: s(o.postal_code),
  };
}

const DECISION = /\b(owner|co-?owner|founder|ceo|president|principal|partner|director|manager|administrator|practice lead|managing)\b/i;
const NOT_DECISION = /\b(assistant|front desk|receptionist|therapist|technician|intern|student)\b/i;

/** Owner / director / manager-type titles worth contacting about coverage. */
export function isDecisionMakerTitle(title: string | null | undefined): boolean {
  if (!title) return false;
  return DECISION.test(title) && !NOT_DECISION.test(title);
}

export interface ApolloCreditCosts { organizationSearchPage: number; personEnrich: number; organizationEnrich: number }

/** Estimated credits for a job (people search is free; Apollo's own account page is the real balance). */
export function estimateApolloCredits(job: { peopleSearchPages?: number; organizationSearchPages?: number; personEnrich?: number; organizationEnrich?: number }, c: ApolloCreditCosts): number {
  return (job.organizationSearchPages ?? 0) * c.organizationSearchPage + (job.personEnrich ?? 0) * c.personEnrich + (job.organizationEnrich ?? 0) * c.organizationEnrich;
}

/** May this job run now? Caps count estimated credits used; large jobs need an admin's explicit approval. */
export function apolloBudget(p: { estimate: number; usedToday: number; usedMonth: number; dailyCap: number; monthlyCap: number; largeJob: number; approved: boolean; paused: boolean }): { ok: boolean; reason: null | "paused" | "daily_cap" | "monthly_cap" | "needs_approval" } {
  if (p.paused) return { ok: false, reason: "paused" };
  if (p.estimate <= 0) return { ok: true, reason: null };
  if (p.usedToday + p.estimate > p.dailyCap) return { ok: false, reason: "daily_cap" };
  if (p.usedMonth + p.estimate > p.monthlyCap) return { ok: false, reason: "monthly_cap" };
  if (p.estimate > p.largeJob && !p.approved) return { ok: false, reason: "needs_approval" };
  return { ok: true, reason: null };
}

// ---------------- Apollo CSV exports (owner request Oct 2026) ----------------
// Apollo's trial plan has no API access, so its exports (Search → select → Export → CSV) are read by the
// ordinary clinic and provider CSV imports. Same rules as the API path: only "verified" emails (or
// "likely" when allowed), U.S. rows only (Canada needs a CASL basis recorded per prospect).

const exportKey = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]+/g, "_").replace(/^_|_$/g, "");

/** True when a CSV header row looks like an Apollo people or company export. */
export function isApolloExport(header: string[]): boolean {
  const k = new Set(header.map(exportKey));
  return (k.has("company") || k.has("company_name")) && (k.has("email_status") || k.has("apollo_contact_id") || k.has("apollo_account_id") || k.has("company_linkedin_url"));
}

const OWNER_TITLE = /\b(owner|founder|co-?founder|president|ceo|chief executive|proprietor|principal|clinic director|practice director)\b/i;
const ASSOCIATE_TITLE = /\bassociate\b/i;

/** "Owner" / "Associate Chiropractor" → the import's practice_role, else "". */
export function apolloTitleRole(title: string | null | undefined): "owner" | "associate" | "" {
  if (!title) return "";
  if (ASSOCIATE_TITLE.test(title)) return "associate";
  return OWNER_TITLE.test(title) ? "owner" : "";
}

export interface ApolloExportResult { rows: string[][]; notUs: number; unverifiedEmails: number; merged: number; misplaced: number }

/**
 * An Apollo export → rows in our own import format (header row first). side "clinic" gives
 * clinic_name/owner_name/…/notes and keeps one row per company (the first with a usable email);
 * side "provider" gives first_name/last_name/…/practice_role. Rows outside the U.S. are dropped.
 */
export function fromApolloExport(rows: string[][], side: "clinic" | "provider", allowLikely: boolean): ApolloExportResult {
  const keys = rows[0].map(exportKey);
  const col = (r: string[], ...names: string[]) => {
    for (const n of names) { const i = keys.indexOf(n); const v = i >= 0 ? r[i]?.trim() : ""; if (v) return v; }
    return "";
  };
  const out: ApolloExportResult = { rows: [], notUs: 0, unverifiedEmails: 0, merged: 0, misplaced: 0 };
  const byCompany = new Map<string, number>();
  out.rows.push(side === "clinic"
    ? ["clinic_name", "owner_name", "email", "phone", "website", "address", "city", "state", "zip", "notes"]
    : ["first_name", "last_name", "email", "website", "city", "state", "zip", "practice_role"]);
  for (const r of rows.slice(1)) {
    const personRegion = col(r, "state") ? apolloRegion(col(r, "state"), col(r, "country") || "United States") : null;
    const companyRegion = col(r, "company_state") ? apolloRegion(col(r, "company_state"), col(r, "company_country") || "United States") : null;
    // Apollo sometimes attaches a same-named company elsewhere (another state, another country). For a
    // clinic, where our contact works wins: the company's street/ZIP are then dropped.
    const misplaced = side === "clinic" && !!personRegion && !!col(r, "company_state", "company_country") && companyRegion !== personRegion;
    if (misplaced) out.misplaced++;
    const region = side === "clinic" ? (misplaced ? personRegion : companyRegion ?? personRegion) : personRegion ?? companyRegion;
    if (!region || CA_PROVINCES[region]) { out.notUs++; continue; }
    const rawEmail = col(r, "email");
    const email = usableApolloEmail({ email: rawEmail || null, emailStatus: col(r, "email_status") || null }, allowLikely) ?? "";
    if (rawEmail && !email) out.unverifiedEmails++;
    const fullAddress = misplaced ? "" : col(r, "company_address");
    const zip = (misplaced ? "" : col(r, "company_postal_code", "company_zip")) || col(r, "postal_code", "zip") || (fullAddress.match(/\b(\d{5})(?:-\d{4})?\b(?!.*\b\d{5}\b)/)?.[1] ?? "");
    const first = col(r, "first_name"), last = col(r, "last_name"), title = col(r, "title");
    if (side === "provider") {
      out.rows.push([first, last, email, col(r, "website"), col(r, "city", "company_city"), region, zip, apolloTitleRole(title)]);
      continue;
    }
    const name = col(r, "company_name", "company");
    if (!name) continue;
    const owner = [first, last].filter(Boolean).join(" ");
    // A misplaced company's website and phone are usually the other business's: kept only when the
    // contact's verified email is on that website's domain.
    const site = col(r, "website");
    const siteDomain = site.toLowerCase().replace(/^https?:\/\//, "").replace(/^www\./, "").split(/[/?#]/)[0];
    const trusted = !misplaced || (!!email && !!siteDomain && email.toLowerCase().endsWith(`@${siteDomain}`));
    const row = [
      name, owner, email, trusted ? col(r, "company_phone", "corporate_phone", "phone") : "", trusted ? site : "",
      misplaced ? "" : col(r, "company_street", "company_address_1") || (fullAddress ? fullAddress.split(",")[0].trim() : ""),
      misplaced ? col(r, "city") : col(r, "company_city", "city"), region, zip,
      [owner && title ? `Apollo contact: ${owner}, ${title}` : "", misplaced ? `Apollo listed the company in ${[col(r, "company_city"), col(r, "company_state"), col(r, "company_country")].filter(Boolean).join(", ")}; location taken from the contact (check the website and phone).` : ""].filter(Boolean).join(" "),
    ];
    const key = `${name.toLowerCase()}|${zip}`;
    const seen = byCompany.get(key);
    if (seen === undefined) { byCompany.set(key, out.rows.length); out.rows.push(row); continue; }
    out.merged++;
    if (!out.rows[seen][2] && email) out.rows[seen] = row; // prefer a contact with a usable email
  }
  return out;
}
