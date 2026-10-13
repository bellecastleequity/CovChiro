/**
 * Search-engine and AI-search helpers: public service areas per state (for
 * landing pages) and schema.org JSON-LD builders. Everything profession- and
 * state-agnostic; the pages decide what's live from the database.
 */

import { STATE_AREAS } from "./serviceAreas";

export interface AreaCity { name: string; zip3: string }
/** cities: largest first (titles use the first three). */
export interface ServiceArea { slug: string; name: string; blurb: string; cities: AreaCity[] }
export interface StateAreas { code: string; slug: string; name: string; areas: ServiceArea[] }

/** Regions a state is marketed in (data in serviceAreas.ts). A city's ZIP3 decides its rate group (RateRegion.zip3List). */
export const SERVICE_AREAS: StateAreas[] = STATE_AREAS;

/** A state with more than one area gets a page per area; one area = the state page lists its cities. */
export const hasAreaPages = (st: StateAreas) => st.areas.length > 1;

export const stateAreasByCode = (code: string) => SERVICE_AREAS.find((s) => s.code === code) ?? null;
export const stateAreasBySlug = (slug: string) => SERVICE_AREAS.find((s) => s.slug === slug.toLowerCase()) ?? null;
export function areaBySlug(stateSlug: string, areaSlug: string) {
  const st = stateAreasBySlug(stateSlug);
  const area = st && hasAreaPages(st) ? (st.areas.find((a) => a.slug === areaSlug.toLowerCase()) ?? null) : null;
  return st && area ? { state: st, area } : null;
}

/** Group a list of cities by which rate group (region id) their ZIP3 falls in. */
export function citiesByRateGroup(cities: AreaCity[], groups: { id: string; zip3List: string[] }[]): Map<string, AreaCity[]> {
  const out = new Map<string, AreaCity[]>();
  for (const c of cities) {
    const g = groups.find((x) => x.zip3List.includes(c.zip3));
    if (!g) continue;
    out.set(g.id, [...(out.get(g.id) ?? []), c]);
  }
  return out;
}

// ---------------- JSON-LD ----------------

type Ld = Record<string, unknown>;

/** Safe to drop into <script type="application/ld+json">: no "</script>" break-out. */
export function jsonLd(data: Ld | Ld[]): string {
  return JSON.stringify(data).replace(/</g, "\\u003c").replace(/>/g, "\\u003e").replace(/&/g, "\\u0026");
}

export function organizationLd(o: { name: string; url: string; logo: string; email?: string; sameAs?: string[]; legalName?: string; alternateName?: string[] }): Ld {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${o.url}#organization`,
    name: o.name,
    url: o.url,
    logo: o.logo,
    ...(o.alternateName?.length ? { alternateName: o.alternateName } : {}),
    ...(o.legalName ? { legalName: o.legalName } : {}),
    ...(o.email ? { email: o.email, contactPoint: [{ "@type": "ContactPoint", contactType: "customer support", email: o.email, availableLanguage: "English" }] } : {}),
    ...(o.sameAs?.length ? { sameAs: o.sameAs } : {}),
  };
}

export function websiteLd(o: { name: string; url: string; alternateName?: string[] }): Ld {
  return { "@context": "https://schema.org", "@type": "WebSite", "@id": `${o.url}#website`, name: o.name, ...(o.alternateName?.length ? { alternateName: o.alternateName } : {}), url: o.url, publisher: { "@id": `${o.url}#organization` } };
}

export function serviceLd(o: { name: string; description: string; url: string; siteUrl: string; serviceType: string; areaServed: string[]; lowPriceCents?: number; highPriceCents?: number }): Ld {
  const usd = (c: number) => (c / 100).toFixed(2);
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: o.name,
    description: o.description,
    url: o.url,
    serviceType: o.serviceType,
    provider: { "@id": `${o.siteUrl}#organization` },
    areaServed: o.areaServed.map((a) => ({ "@type": a.includes(",") ? "City" : "State", name: a })),
    ...(o.lowPriceCents && o.highPriceCents
      ? { offers: { "@type": "AggregateOffer", priceCurrency: "USD", lowPrice: usd(o.lowPriceCents), highPrice: usd(o.highPriceCents), description: "Per half or full day of coverage, before travel." } }
      : {}),
  };
}

export function faqLd(qa: [string, string][]): Ld {
  return { "@context": "https://schema.org", "@type": "FAQPage", mainEntity: qa.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })) };
}

export function breadcrumbLd(items: { name: string; url: string }[]): Ld {
  return { "@context": "https://schema.org", "@type": "BreadcrumbList", itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: it.url })) };
}
