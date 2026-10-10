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
