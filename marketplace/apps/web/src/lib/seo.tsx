import type { Metadata } from "next";
import { brand, env } from "@cm/config";
import type { seo } from "@cm/services";

/**
 * Search-engine helpers: one canonical URL per page, matching Open Graph /
 * Twitter cards, and schema.org structured data (JSON-LD).
 */

export const absoluteUrl = (path: string) => new URL(path, env().APP_BASE_URL).toString();

export function pageMeta(o: { title: string; description: string; path: string; noindex?: boolean; absoluteTitle?: boolean }): Metadata {
  const b = brand();
  const title = o.absoluteTitle ? { absolute: o.title } : o.title;
  const fullTitle = o.absoluteTitle ? o.title : `${o.title} · ${b.name}`;
  return {
    title,
    description: o.description,
    alternates: { canonical: o.path },
    openGraph: { title: fullTitle, description: o.description, url: o.path, siteName: b.name, type: "website", locale: "en_US" },
    twitter: { card: "summary_large_image", title: fullTitle, description: o.description },
    ...(o.noindex ? { robots: { index: false, follow: true } } : {}),
  };
}

/** Private areas (portals, auth, one-tap links): never indexed, links not followed. */
export const PRIVATE_META: Metadata = { robots: { index: false, follow: false, nocache: true, googleBot: { index: false, follow: false } } };

/** Renders JSON-LD safely (no "</script>" breakouts). */
export function JsonLd({ data }: { data: Record<string, unknown> | Record<string, unknown>[] }) {
  return <script type="application/ld+json" dangerouslySetInnerHTML={{ __html: JSON.stringify(data).replace(/</g, "\\u003c") }} />;
}

export function organizationLd(sameAs: string[] = []) {
  const b = brand();
  return {
    "@context": "https://schema.org",
    "@type": "Organization",
    "@id": absoluteUrl("/#organization"),
    name: b.name,
    url: absoluteUrl("/"),
    logo: absoluteUrl("/apple-icon.png"),
    description: b.tagline,
    email: b.supportEmail,
    contactPoint: [{ "@type": "ContactPoint", contactType: "customer support", email: b.supportEmail, areaServed: "US", availableLanguage: "en" }],
    ...(sameAs.length ? { sameAs } : {}),
  };
}

export function websiteLd() {
  const b = brand();
  return { "@context": "https://schema.org", "@type": "WebSite", "@id": absoluteUrl("/#website"), name: b.name, url: absoluteUrl("/"), publisher: { "@id": absoluteUrl("/#organization") }, inLanguage: "en-US" };
}

export function breadcrumbLd(items: { name: string; path: string }[]) {
  return {
    "@context": "https://schema.org",
    "@type": "BreadcrumbList",
    itemListElement: items.map((it, i) => ({ "@type": "ListItem", position: i + 1, name: it.name, item: absoluteUrl(it.path) })),
  };
}

export function faqLd(qa: [string, string][]) {
  return {
    "@context": "https://schema.org",
    "@type": "FAQPage",
    mainEntity: qa.map(([q, a]) => ({ "@type": "Question", name: q, acceptedAnswer: { "@type": "Answer", text: a } })),
  };
}

export function serviceLd(o: { name: string; serviceType: string; description: string; path: string; areaServed: { city?: string; state: string; stateName: string } }) {
  return {
    "@context": "https://schema.org",
    "@type": "Service",
    name: o.name,
    serviceType: o.serviceType,
    description: o.description,
    url: absoluteUrl(o.path),
    provider: { "@id": absoluteUrl("/#organization") },
    areaServed: o.areaServed.city
      ? { "@type": "City", name: `${o.areaServed.city}, ${o.areaServed.state}`, containedInPlace: { "@type": "State", name: o.areaServed.stateName } }
      : { "@type": "State", name: o.areaServed.stateName },
    audience: { "@type": "BusinessAudience", audienceType: "Healthcare practices" },
  };
}

/** Google for Jobs. City/ZIP only (never the clinic's name or street), pay = what the provider earns. */
export function jobPostingLd(j: seo.PublicJob, o: { title: string; descriptionHtml: string; stateName: string }) {
  const b = brand();
  return {
    "@context": "https://schema.org",
    "@type": "JobPosting",
    title: o.title,
    description: o.descriptionHtml,
    identifier: { "@type": "PropertyValue", name: b.name, value: j.id },
    datePosted: j.postedAt.toISOString(),
    validThrough: j.startsAt.toISOString(),
    employmentType: ["PER_DIEM", "TEMPORARY", "CONTRACTOR"],
    hiringOrganization: { "@type": "Organization", name: b.name, sameAs: absoluteUrl("/"), logo: absoluteUrl("/apple-icon.png") },
    jobLocation: {
      "@type": "Place",
      address: { "@type": "PostalAddress", addressLocality: j.city, addressRegion: j.state, postalCode: j.zip, addressCountry: "US" },
      ...(j.lat != null && j.lng != null ? { geo: { "@type": "GeoCoordinates", latitude: j.lat, longitude: j.lng } } : {}),
    },
    baseSalary: { "@type": "MonetaryAmount", currency: "USD", value: { "@type": "QuantitativeValue", value: Math.round(j.providerPayCents) / 100, unitText: "DAY" } },
    qualifications: `Active, verified ${o.stateName} ${j.professionName.toLowerCase()} license valid through the shift date, and verified malpractice insurance.`,
    occupationalCategory: j.professionCode === "DC" ? "29-1011.00 Chiropractors" : j.professionName,
    industry: "Healthcare",
    directApply: false,
    url: absoluteUrl(`/jobs/shift/${j.id}`),
  };
}
