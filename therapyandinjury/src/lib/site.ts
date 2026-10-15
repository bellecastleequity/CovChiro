import site from '../data/site.json';
import branchData from '../data/branches.json';

export { site };

export type Hours = { day: string; opens: string; closes: string };
export type Doctor = { name: string; title: string; bio?: string };
export type Branch = {
  slug: string;
  city: string;
  county: string;
  status: 'open' | 'coming soon';
  /** The location's own professional entity (e.g. its PLLC), shown on its page once set. */
  legalEntity: string;
  openingNote: string;
  address: { street: string; city: string; state: string; zip: string } | null;
  phone: string;
  email: string;
  hours: Hours[];
  doctors: Doctor[];
  mapEmbed: string;
  gbpUrl: string;
  domains: string[];
  nearbyAreas: string[];
  geo: { lat: number | null; lng: number | null };
};

export const branches = branchData as Branch[];
export const openBranches = branches.filter((b) => b.status === 'open');

/** A value in the data files that hasn't been filled in yet, e.g. "[OCALA PHONE]". */
export const isPlaceholder = (v: unknown) => typeof v !== 'string' || v.trim() === '' || v.trim().startsWith('[');

export const branchName = (b: Branch) => `${b.city} Therapy & Injury`;
export const branchPath = (b: Branch) => `/${b.slug}/`;
export const isOpen = (b: Branch) => b.status === 'open';

export const oneLineAddress = (b: Branch) =>
  b.address ? `${b.address.street}, ${b.address.city}, ${b.address.state} ${b.address.zip}` : '';

export const mapEmbedSrc = (b: Branch) => {
  if (!isPlaceholder(b.mapEmbed)) return b.mapEmbed;
  if (!b.address) return '';
  return `https://www.google.com/maps?q=${encodeURIComponent(`${branchName(b)}, ${oneLineAddress(b)}`)}&output=embed`;
};

export const directionsUrl = (b: Branch) =>
  b.address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(oneLineAddress(b))}` : '';

export const telHref = (phone: string) => (isPlaceholder(phone) ? '' : `tel:${phone.replace(/[^\d+]/g, '')}`);

export const WEEK = ['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];

const fmtTime = (t: string) => {
  const [h, m] = t.split(':').map(Number);
  const suffix = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, '0')} ${suffix}` : `${h12} ${suffix}`;
};

/** Full Monday–Sunday table; days missing from the data show as Closed. */
export const weekHours = (b: Branch) =>
  WEEK.map((day) => {
    const h = b.hours.find((x) => x.day === day);
    return { day, text: h ? `${fmtTime(h.opens)} – ${fmtTime(h.closes)}` : 'Closed', open: !!h };
  });

/** Compact summary, e.g. "Mon, Wed, Thu · 1 pm – 6 pm". */
export const hoursSummary = (b: Branch) => {
  if (!b.hours.length) return '';
  const groups = new Map<string, string[]>();
  for (const h of b.hours) {
    const key = `${fmtTime(h.opens)} – ${fmtTime(h.closes)}`;
    groups.set(key, [...(groups.get(key) ?? []), h.day.slice(0, 3)]);
  }
  return [...groups].map(([time, days]) => `${days.join(', ')} · ${time}`).join('; ');
};

/** Treating doctors listed in branches.json. Empty until the practice confirms who they are. */
export const doctorsFor = (b: Branch): Doctor[] => b.doctors;

/**
 * Only open locations are indexed. Coming-soon pages stay reachable (city domains point to them)
 * but are noindex and left out of the sitemap, IndexNow and llms.txt, so search engines never
 * see thin pages without an address.
 */
export const isIndexable = (b: Branch) => isOpen(b);
export const indexableBranches = branches.filter(isIndexable);

export const abs = (path: string) => new URL(path, site.domain).toString();

/** Organization + WebSite JSON-LD, emitted on every page (same @id everywhere). */
export const orgSchema = () => {
  const sameAs = [site.social.instagram, site.social.facebook, ...branches.map((b) => b.gbpUrl)].filter((u) => !isPlaceholder(u));
  return [
    {
      '@context': 'https://schema.org',
      '@type': 'Organization',
      '@id': abs('/#org'),
      name: site.brandName,
      alternateName: site.alternateNames,
      url: site.domain,
      logo: { '@type': 'ImageObject', url: abs('/brand/favicon-512.png'), width: 512, height: 512 },
      image: abs('/og/default.png'),
      slogan: site.tagline,
      areaServed: { '@type': 'State', name: 'Florida' },
      ...(sameAs.length ? { sameAs } : {}),
      subOrganization: indexableBranches.map((b) => ({ '@id': abs(`${branchPath(b)}#business`) })),
    },
    {
      '@context': 'https://schema.org',
      '@type': 'WebSite',
      '@id': abs('/#website'),
      name: site.brandName,
      alternateName: site.alternateNames,
      url: site.domain,
      publisher: { '@id': abs('/#org') },
      inLanguage: 'en-US',
    },
  ];
};

/** BreadcrumbList JSON-LD from [name, path] pairs (Home is added first). */
export const breadcrumbSchema = (trail: [string, string][]) => ({
  '@context': 'https://schema.org',
  '@type': 'BreadcrumbList',
  itemListElement: [['Home', '/'] as [string, string], ...trail].map(([name, path], i) => ({
    '@type': 'ListItem',
    position: i + 1,
    name,
    item: abs(path),
  })),
});

/** FAQPage JSON-LD. Answers may contain [PLACEHOLDER] text; those questions are left out until filled. */
export const faqSchema = (faqs: { q: string; a: string }[]) => {
  const ready = faqs.filter((f) => !/\[[^\]]+\]/.test(f.a));
  return ready.length
    ? {
        '@context': 'https://schema.org',
        '@type': 'FAQPage',
        mainEntity: ready.map((f) => ({ '@type': 'Question', name: f.q, acceptedAnswer: { '@type': 'Answer', text: f.a } })),
      }
    : null;
};

const SCHEMA_DAY: Record<string, string> = Object.fromEntries(WEEK.map((d) => [d, `https://schema.org/${d}`]));

export const branchSchema = (b: Branch) => {
  const schema: Record<string, unknown> = {
    '@context': 'https://schema.org',
    '@type': 'MedicalBusiness',
    '@id': abs(`${branchPath(b)}#business`),
    name: branchName(b),
    description: `Chiropractic injury and wellness care in ${b.city}, Florida, including care for auto accident injuries.`,
    url: abs(branchPath(b)),
    image: abs(`/og/${b.slug}.png`),
    logo: abs('/brand/favicon-512.png'),
    areaServed: [b.city, ...b.nearbyAreas].map((name) => ({ '@type': 'City', name })),
    parentOrganization: { '@id': abs('/#org') },
    hasMap: b.address ? `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(oneLineAddress(b))}` : undefined,
  };
  if (!isPlaceholder(b.legalEntity)) schema.legalName = b.legalEntity;
  if (b.doctors.length) {
    schema.employee = b.doctors.map((d) => ({ '@type': 'Person', name: d.name, jobTitle: d.title }));
  }
  if (b.address) {
    schema.address = {
      '@type': 'PostalAddress',
      streetAddress: b.address.street,
      addressLocality: b.address.city,
      addressRegion: b.address.state,
      postalCode: b.address.zip,
      addressCountry: 'US',
    };
  }
  if (!isPlaceholder(b.phone)) schema.telephone = b.phone;
  if (b.geo.lat != null && b.geo.lng != null) schema.geo = { '@type': 'GeoCoordinates', latitude: b.geo.lat, longitude: b.geo.lng };
  if (b.hours.length) {
    schema.openingHoursSpecification = b.hours.map((h) => ({
      '@type': 'OpeningHoursSpecification',
      dayOfWeek: SCHEMA_DAY[h.day],
      opens: h.opens,
      closes: h.closes,
    }));
  }
  if (!isPlaceholder(b.gbpUrl)) schema.sameAs = [b.gbpUrl];
  return schema;
};
