import defaultSite from '../data/site.json';
import defaultBranches from '../data/branches.json';

/**
 * Live site data. Starts from src/data/*.json (the defaults shipped with each release) and is
 * refreshed in place from the content editor's content.json (see applyContent / content-store.ts),
 * so edits made at /_admin show up on the next page view with no rebuild.
 */
export type Video = {
  /** YouTube link or video ID. When set, it's shown instead of the self-hosted file. */
  youtube: string;
  /** Self-hosted MP4 (in public/media/) and its poster image. */
  file: string;
  poster: string;
  title: string;
  /** Short line under the player, e.g. "60 sec · captioned". */
  caption: string;
  /** Plain-text transcript paragraphs (blank lines separate paragraphs). Shown in a "Transcript" disclosure. */
  transcript: string;
  /** For search engines (video rich results): publish date YYYY-MM-DD and length in seconds. */
  uploadDate?: string;
  duration?: string;
};
/**
 * Editable page text (content editor → Page text). Values may contain "[PLACEHOLDER]" parts, which
 * are highlighted on the site until replaced; an empty value drops that sentence.
 */
export type SiteCopy = {
  formConsent: string; billing: string; after14Days: string; healthInsurance: string; firstVisitLength: string;
  onlineIntake: string; rehabEquipment: string; servicesApproved: boolean; privacyDraftNotice: string;
  privacyProviders: string; privacyNoticeUrl: string; privacyRetention: string;
  attorneyHeadline: string; attorneyNote: string;
};
export type SiteData = typeof defaultSite & {
  copy: SiteCopy;
  social: { instagram: string; facebook: string; youtube: string; instagramHandle?: string };
  heroVideo: Video;
};
export const site = structuredClone(defaultSite) as SiteData;

export type Hours = { day: string; opens: string; closes: string };
export type Doctor = { name: string; title: string; bio?: string };
export type Branch = {
  slug: string;
  /** Optional: this location's own hero video (blank fields fall back to the site-wide heroVideo). */
  heroVideo?: Partial<Video>;
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
  /**
   * Visit conveniences competitors lead with (same-day, walk-ins, Spanish, X-ray).
   * Each shows on the site ONLY when set to true / listed, so nothing is claimed until confirmed.
   */
  features: {
    sameDayAppointments: boolean;
    walkInsWelcome: boolean;
    eveningHours: boolean;
    onSiteXray: boolean;
    languages: string[];
  };
  doctors: Doctor[];
  mapEmbed: string;
  /** Google Maps zoom for the location map (1 = world … 21 = building). Default 17: street-intersection scale. */
  mapZoom?: number;
  gbpUrl: string;
  /** Optional per-location Carepatron links; blank = use the brand-wide link in site.json. */
  patientLinks: { booking: string; intake: string };
  domains: string[];
  nearbyAreas: string[];
  geo: { lat: number | null; lng: number | null };
  /** City-center fallback for "nearest location" until the exact geo point is set. */
  cityCenter?: { lat: number; lng: number };
};

export const branches = structuredClone(defaultBranches) as Branch[];
export const openBranches: Branch[] = [];
export const indexableBranches: Branch[] = [];

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
  const z = Number.isFinite(b.mapZoom) ? Math.min(21, Math.max(3, Math.round(b.mapZoom!))) : 17;
  // Search by the exact coordinates when they're set, otherwise by the street address alone. Leaving
  // the business name out matters: Google doesn't know it yet, so with the name it guesses a different
  // place (and shows no pin). A plain address or "lat,lng" always drops a pin and centers on it.
  const where = b.geo?.lat != null && b.geo?.lng != null ? `${b.geo.lat},${b.geo.lng}` : oneLineAddress(b);
  return `https://www.google.com/maps?q=${encodeURIComponent(where)}&z=${z}&output=embed`;
};

export const directionsUrl = (b: Branch) =>
  b.address ? `https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(oneLineAddress(b))}` : '';

export const telHref = (phone: string) => {
  if (isPlaceholder(phone)) return '';
  const digits = phone.replace(/\D/g, '');
  return `tel:${digits.length === 10 ? `+1${digits}` : `+${digits}`}`;
};

/** The brand's main line, e.g. (844) 84-TREAT · 848-7328. */
export const mainLine = { digits: '', vanity: '', tel: '' };

/**
 * Which number to call: a location's own local number once it's set, otherwise the brand's
 * main line. (Location schema/Google listings only ever use the location's own number.)
 */
export const callFor = (b?: Branch) => {
  if (b && !isPlaceholder(b.phone)) return { tel: telHref(b.phone), label: b.phone, digits: b.phone, isMain: false };
  return { tel: mainLine.tel, label: mainLine.vanity || mainLine.digits, digits: mainLine.digits, isMain: true };
};

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

/** Confirmed conveniences for a location, as short labels (empty until the practice turns them on). */
export const featureLabels = (b: Branch): string[] => {
  const f = b.features;
  const otherLangs = f.languages.filter((l) => l !== 'English');
  return [
    f.sameDayAppointments && 'Same-day appointments',
    f.walkInsWelcome && 'Walk-ins welcome',
    f.eveningHours && 'Evening hours',
    f.onSiteXray && 'X-rays on-site',
    ...otherLangs.map((l) => (l === 'Español' ? 'Hablamos español' : `${l} spoken`)),
  ].filter(Boolean) as string[];
};

/**
 * Carepatron (EHR/EMR) links: online booking, new-patient paperwork, patient portal.
 * A location's own link wins over the brand-wide one in site.json. Returns '' while the
 * value is still a [PLACEHOLDER], so buttons fall back to the request form / are hidden.
 */
export type PatientLinkKind = 'booking' | 'intake' | 'portal';
export const patientLink = (kind: PatientLinkKind, b?: Branch): string => {
  const own = kind !== 'portal' && b ? b.patientLinks?.[kind] : '';
  if (!isPlaceholder(own)) return own as string;
  const brand = site.patientLinks[kind];
  return isPlaceholder(brand) ? '' : brand;
};

/** Where "Request an appointment" goes: Carepatron booking when set (open locations only), else the form. */
export const bookingHref = (b?: Branch): string => {
  if (b && !isOpen(b)) return '#request';
  return patientLink('booking', b) || (b ? '#request' : '/locations/');
};

/** Treating doctors listed in branches.json. Empty until the practice confirms who they are. */
export const doctorsFor = (b: Branch): Doctor[] => b.doctors;

/**
 * Only open locations are indexed. Coming-soon pages stay reachable (city domains point to them)
 * but are noindex and left out of the sitemap, IndexNow and llms.txt, so search engines never
 * see thin pages without an address.
 */
export const isIndexable = (b: Branch) => isOpen(b);

/** Recomputes everything derived from the data (called after every content change). */
function derive() {
  openBranches.splice(0, openBranches.length, ...branches.filter(isOpen));
  indexableBranches.splice(0, indexableBranches.length, ...branches.filter(isIndexable));
  mainLine.digits = site.mainPhone;
  mainLine.vanity = isPlaceholder(site.mainPhoneVanity) ? '' : site.mainPhoneVanity;
  mainLine.tel = telHref(site.mainPhone);
}

const isObj = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);
/** Edited values win; keys the editor never saw (e.g. added in a newer release) keep their defaults. */
declare const __BUILD_DATE__: string;
const builtAt = new Date(typeof __BUILD_DATE__ === 'string' ? __BUILD_DATE__ : Date.now());
let contentSavedAt: Date | null = null;
/** When the site's content last changed: the later of this release's build and the last editor save (sitemap lastmod). */
export const siteUpdatedAt = (): Date => (contentSavedAt && contentSavedAt > builtAt ? contentSavedAt : builtAt);

function merge<T>(base: T, over: unknown): T {
  if (!isObj(base) || !isObj(over)) return (over === undefined ? base : over) as T;
  const out: Record<string, unknown> = { ...base };
  for (const [k, v] of Object.entries(over)) out[k] = merge((base as Record<string, unknown>)[k], v);
  return out as T;
}

/**
 * Replaces the live data with defaults + `content` ({ site, branches }) in place, so every module
 * holding a reference sees the new values. Locations merge by slug; a location only present in
 * the content file is added as-is.
 */
export function applyContent(content: { site?: unknown; branches?: unknown; updatedAt?: unknown } | null) {
  const saved = typeof content?.updatedAt === 'string' ? new Date(content.updatedAt) : null;
  contentSavedAt = saved && !Number.isNaN(saved.getTime()) ? saved : null;
  const nextSite = merge(structuredClone(defaultSite), content?.site) as SiteData;
  for (const k of Object.keys(site)) delete (site as Record<string, unknown>)[k];
  Object.assign(site, nextSite);
  const edited = Array.isArray(content?.branches) ? (content!.branches as Partial<Branch>[]) : [];
  const defaults = structuredClone(defaultBranches) as Branch[];
  const next = defaults.map((b) => merge(b, edited.find((e) => e?.slug === b.slug)));
  for (const e of edited) if (e?.slug && !defaults.some((b) => b.slug === e.slug)) next.push(e as Branch);
  branches.splice(0, branches.length, ...next);
  derive();
}
derive();

/** A page-text value with no leading/trailing space ('' when it was cleared in the editor). */
export const copyText = (k: Exclude<keyof SiteCopy, 'servicesApproved'>) => String(site.copy?.[k] ?? '').trim();
/** A sentence for inside running text: the value plus a following space, or nothing when cleared. */
export const sentence = (k: Exclude<keyof SiteCopy, 'servicesApproved'>) => (copyText(k) ? `${copyText(k)} ` : '');

/** Where a location is, for "nearest location": its exact map point if set, else its city center. */
export const branchPoint = (b: Branch): { lat: number; lng: number } | null =>
  b.geo?.lat != null && b.geo?.lng != null ? { lat: b.geo.lat, lng: b.geo.lng } : b.cityCenter ?? null;

/** Compact location list for the browser-side "nearest location" feature. */
export const nearestData = () =>
  branches.flatMap((b) => {
    const p = branchPoint(b);
    return p ? [{ s: b.slug, n: branchName(b), c: b.city, u: branchPath(b), o: isOpen(b), lat: p.lat, lng: p.lng }] : [];
  });

/** The hero video for a page: the location's own fields first, then the site-wide video. */
export const heroVideoFor = (b?: Branch): Video => {
  const base = site.heroVideo;
  const own = b?.heroVideo ?? {};
  const pick = (k: keyof Video) => (typeof own[k] === 'string' && own[k]!.trim() ? own[k]! : base[k]);
  return { youtube: pick('youtube'), file: pick('file'), poster: pick('poster'), title: pick('title'), caption: pick('caption'), transcript: pick('transcript'), uploadDate: pick('uploadDate'), duration: pick('duration') };
};

/** "https://youtu.be/ID", "…watch?v=ID", "…/shorts/ID", "…/embed/ID" or a bare ID → ID (else ''). */
export const youtubeId = (v: string): string => {
  if (isPlaceholder(v)) return '';
  const s = v.trim();
  if (/^[\w-]{11}$/.test(s)) return s;
  const m = /(?:youtu\.be\/|[?&]v=|\/shorts\/|\/embed\/|\/live\/)([\w-]{11})/.exec(s);
  return m ? m[1] : '';
};

export const abs = (path: string) => new URL(path, site.domain).toString();

/**
 * The hero commercial as search engines see it (VideoObject JSON-LD and sitemap video entries), or
 * null when there's no video or it lacks a poster or date. Self-hosted files give a contentUrl,
 * YouTube links an embedUrl.
 */
export const videoFacts = (b?: Branch) => {
  const v = heroVideoFor(b);
  const yt = youtubeId(v.youtube);
  const file = yt || isPlaceholder(v.file) ? '' : v.file;
  const poster = !isPlaceholder(v.poster) && v.poster ? abs(v.poster) : yt ? `https://i.ytimg.com/vi/${yt}/hqdefault.jpg` : '';
  const date = /^\d{4}-\d{2}-\d{2}/.test(v.uploadDate ?? '') ? v.uploadDate!.slice(0, 10) : '';
  if ((!yt && !file) || !poster || !date) return null;
  const title = isPlaceholder(v.title) ? 'Therapy & Injury commercial' : v.title;
  const transcript = isPlaceholder(v.transcript) ? '' : v.transcript.replace(/\s*\n\s*/g, ' ').trim();
  const where = b ? branchName(b) : site.brandName;
  const description = `${title}, a commercial from ${where} about getting checked after a car accident. Florida PIP generally requires care within 14 days.`;
  const seconds = Number(v.duration);
  return {
    title, description, transcript, poster, date,
    contentUrl: file ? abs(file) : '',
    embedUrl: yt ? `https://www.youtube.com/embed/${yt}` : '',
    seconds: Number.isFinite(seconds) && seconds > 0 ? Math.round(seconds) : 0,
  };
};

export const videoSchema = (b?: Branch) => {
  const f = videoFacts(b);
  if (!f) return null;
  return {
    '@context': 'https://schema.org',
    '@type': 'VideoObject',
    name: f.title,
    description: f.description,
    thumbnailUrl: [f.poster],
    uploadDate: f.date,
    ...(f.seconds ? { duration: `PT${f.seconds}S` } : {}),
    ...(f.contentUrl ? { contentUrl: f.contentUrl } : {}),
    ...(f.embedUrl ? { embedUrl: f.embedUrl } : {}),
    ...(f.transcript ? { transcript: f.transcript } : {}),
    inLanguage: 'en-US',
    publisher: { '@id': abs('/#org') },
  };
};

/** Organization + WebSite JSON-LD, emitted on every page (same @id everywhere). */
export const orgSchema = () => {
  // sameAs also carries profile URLs from business directories (e.g. Black-owned business
  // directories) so search engines connect those listings to this site without any visible text.
  const sameAs = [site.social.instagram, site.social.facebook, site.social.youtube, ...branches.map((b) => b.gbpUrl), ...site.directoryListings].filter((u) => !isPlaceholder(u));
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
      ...(mainLine.tel
        ? {
            telephone: mainLine.digits,
            contactPoint: {
              '@type': 'ContactPoint',
              telephone: mainLine.tel.replace('tel:', ''),
              contactType: 'customer service',
              areaServed: 'US-FL',
              availableLanguage: ['en'],
            },
          }
        : {}),
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
    '@type': 'Chiropractor',
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
  if (b.features.languages.length) schema.knowsLanguage = b.features.languages.map((l) => (l === 'Español' ? 'es' : l === 'English' ? 'en' : l));
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
