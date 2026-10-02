/**
 * Search-engine and AI-search helpers: public service areas per state (for
 * landing pages) and schema.org JSON-LD builders. Everything profession- and
 * state-agnostic; the pages decide what's live from the database.
 */

export interface AreaCity { name: string; zip3: string }
/** cities: largest first (titles use the first three). */
export interface ServiceArea { slug: string; name: string; blurb: string; cities: AreaCity[] }
export interface StateAreas { code: string; slug: string; name: string; areas: ServiceArea[] }

/** Regions a state is marketed in. A city's ZIP3 decides its rate group (RateRegion.zip3List). */
export const SERVICE_AREAS: StateAreas[] = [
  {
    code: "FL",
    slug: "florida",
    name: "Florida",
    areas: [
      {
        slug: "north-florida",
        name: "North Florida",
        blurb: "From the First Coast to the Panhandle.",
        cities: [
          { name: "Jacksonville", zip3: "322" }, { name: "Tallahassee", zip3: "323" }, { name: "Gainesville", zip3: "326" }, { name: "St. Augustine", zip3: "320" },
          { name: "Pensacola", zip3: "325" }, { name: "Panama City", zip3: "324" },
        ],
      },
      {
        slug: "central-florida",
        name: "Central Florida",
        blurb: "Orlando, Tampa Bay, the Space Coast and everything between.",
        cities: [
          { name: "Orlando", zip3: "328" }, { name: "Tampa", zip3: "336" }, { name: "St. Petersburg", zip3: "337" }, { name: "Kissimmee", zip3: "347" }, { name: "Sanford", zip3: "327" },
          { name: "Brandon", zip3: "335" }, { name: "Clearwater", zip3: "337" }, { name: "Lakeland", zip3: "338" }, { name: "Daytona Beach", zip3: "321" },
          { name: "Melbourne", zip3: "329" }, { name: "Ocala", zip3: "344" }, { name: "Sarasota", zip3: "342" },
        ],
      },
      {
        slug: "south-florida",
        name: "South Florida",
        blurb: "Miami-Dade, Broward, Palm Beach, the Treasure Coast and Southwest Florida.",
        cities: [
          { name: "Miami", zip3: "331" }, { name: "Fort Lauderdale", zip3: "333" }, { name: "West Palm Beach", zip3: "334" }, { name: "Boca Raton", zip3: "334" },
          { name: "Port St. Lucie", zip3: "349" }, { name: "Fort Myers", zip3: "339" }, { name: "Naples", zip3: "341" }, { name: "Key West", zip3: "330" },
        ],
      },
    ],
  },
];

export const stateAreasByCode = (code: string) => SERVICE_AREAS.find((s) => s.code === code) ?? null;
export const stateAreasBySlug = (slug: string) => SERVICE_AREAS.find((s) => s.slug === slug.toLowerCase()) ?? null;
export function areaBySlug(stateSlug: string, areaSlug: string) {
  const st = stateAreasBySlug(stateSlug);
  const area = st?.areas.find((a) => a.slug === areaSlug.toLowerCase()) ?? null;
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

export function organizationLd(o: { name: string; url: string; logo: string; email?: string; sameAs?: string[]; legalName?: string }): Ld {
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": `${o.url}#organization`,
    name: o.name,
    url: o.url,
    logo: o.logo,
    ...(o.legalName ? { legalName: o.legalName } : {}),
    ...(o.email ? { email: o.email, contactPoint: [{ "@type": "ContactPoint", contactType: "customer support", email: o.email, availableLanguage: "English" }] } : {}),
    ...(o.sameAs?.length ? { sameAs: o.sameAs } : {}),
  };
}

export function websiteLd(o: { name: string; url: string }): Ld {
  return { "@context": "https://schema.org", "@type": "WebSite", "@id": `${o.url}#website`, name: o.name, url: o.url, publisher: { "@id": `${o.url}#organization` } };
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
