/**
 * Automatic clinic prospecting rules (pure). Discovery reads the public NPPES
 * NPI registry; AI web research then fills in website, business email and
 * practice details. These functions decide what a record is, how duplicates
 * match, and which researched values are safe to keep. AI never writes to a
 * prospect except through applyResearch().
 */

/** One NPPES result, reduced to the public practice-location facts we use. */
export interface RegistryRecord {
  npi: string;
  kind: "individual" | "organization";
  /** Organization legal name (organizations) — individuals use first/last. */
  name: string;
  firstName: string | null;
  lastName: string | null;
  credential: string | null;
  /** NPI taxonomy codes on the record (e.g. 111N00000X = chiropractor). */
  taxonomyCodes: string[];
  location: { line1: string; line2: string | null; city: string; state: string; zip: string; phone: string | null } | null;
}

/** What counts as a practice of one profession in the registry, and how to name it. */
export interface RegistryProfile {
  /** Taxonomy code prefixes for the profession, e.g. ["111N"]. */
  taxonomyCodes: string[];
  /** After a sole practitioner's name, e.g. "D.C." (blank = none). */
  nameSuffix: string;
  /** e.g. "chiropractic practice". */
  practiceNoun: string;
}

export const CHIROPRACTIC_PROFILE: RegistryProfile = { taxonomyCodes: ["111N"], nameSuffix: "D.C.", practiceNoun: "chiropractic practice" };

export function matchesProfile(r: Pick<RegistryRecord, "taxonomyCodes">, profile: RegistryProfile) {
  return profile.taxonomyCodes.length > 0 && r.taxonomyCodes.some((c) => profile.taxonomyCodes.some((p) => p && c.toUpperCase().startsWith(p.toUpperCase())));
}

export interface ClinicCandidate {
  addressKey: string;
  clinicName: string;
  /** The name is just a doctor's name; research may replace it with the practice name. */
  nameFromIndividual: boolean;
  ownerName: string | null;
  doctors: string[];
  providerCount: number;
  npis: string[];
  address: string;
  city: string;
  state: string;
  zip: string;
  phone: string | null;
}

const ABBREV: [RegExp, string][] = [
  [/\bSTREET\b/g, "ST"], [/\bAVENUE\b/g, "AVE"], [/\bROAD\b/g, "RD"], [/\bBOULEVARD\b/g, "BLVD"], [/\bDRIVE\b/g, "DR"], [/\bLANE\b/g, "LN"],
  [/\bCOURT\b/g, "CT"], [/\bPARKWAY\b/g, "PKWY"], [/\bHIGHWAY\b/g, "HWY"], [/\bCIRCLE\b/g, "CIR"], [/\bPLACE\b/g, "PL"], [/\bTERRACE\b/g, "TER"], [/\bTRAIL\b/g, "TRL"],
  [/\bNORTH\b/g, "N"], [/\bSOUTH\b/g, "S"], [/\bEAST\b/g, "E"], [/\bWEST\b/g, "W"], [/\bSUITE\b/g, "STE"], [/\bUNIT\b/g, "STE"], [/#\s*/g, " STE "],
];

/** Same building + same suite + same ZIP → same key. */
export function addressKey(line1: string, zip: string): string {
  let s = ` ${line1.toUpperCase()} `;
  for (const [re, to] of ABBREV) s = s.replace(re, to);
  s = s.replace(/[^A-Z0-9 ]/g, " ").replace(/\s+/g, " ").trim();
  return `${s}|${zip.replace(/\D/g, "").slice(0, 5)}`;
}

const SMALL = new Set(["of", "and", "the", "at", "in", "for", "on"]);
function titleCase(s: string) {
  return s
    .toLowerCase()
    .replace(/\b(llc|pllc|pa|p\.a\.|inc|corp|co|pc|p\.c\.|ltd)\b\.?/g, "")
    .replace(/[,\s]+$/g, "")
    .split(/\s+/)
    .filter(Boolean)
    .map((w, i) => (i > 0 && SMALL.has(w) ? w : w.charAt(0).toUpperCase() + w.slice(1)))
    .join(" ")
    .trim();
}
const doctorName = (r: RegistryRecord) => `Dr. ${titleCase(`${r.firstName ?? ""} ${r.lastName ?? ""}`)}`.trim();

function formatPhone(p: string | null): string | null {
  const d = (p ?? "").replace(/\D/g, "");
  const ten = d.length === 11 && d.startsWith("1") ? d.slice(1) : d;
  return ten.length === 10 ? `(${ten.slice(0, 3)}) ${ten.slice(3, 6)}-${ten.slice(6)}` : null;
}

/** Groups registry records of one profession into one candidate per practice location in `state`. */
export function groupRegistryRecords(records: RegistryRecord[], state: string, profile: RegistryProfile = CHIROPRACTIC_PROFILE): ClinicCandidate[] {
  const groups = new Map<string, RegistryRecord[]>();
  for (const r of records) {
    if (!matchesProfile(r, profile) || !r.location || r.location.state.toUpperCase() !== state.toUpperCase() || !r.location.line1.trim()) continue;
    const key = addressKey(r.location.line1, r.location.zip);
    groups.set(key, [...(groups.get(key) ?? []), r]);
  }
  const out: ClinicCandidate[] = [];
  for (const [key, rs] of groups) {
    const orgs = rs.filter((r) => r.kind === "organization");
    const people = [...new Map(rs.filter((r) => r.kind === "individual").map((r) => [r.npi, r])).values()];
    const loc = (orgs[0] ?? rs[0]).location!;
    const doctors = people.map(doctorName);
    const orgName = orgs.map((o) => titleCase(o.name)).find(Boolean);
    out.push({
      addressKey: key,
      clinicName: orgName ?? (doctors.length === 1 ? `${doctors[0]}${profile.nameSuffix ? `, ${profile.nameSuffix}` : ""}` : `${titleCase(loc.city)} ${profile.practiceNoun} (${titleCase(loc.line1)})`),
      nameFromIndividual: !orgName,
      ownerName: people.length === 1 ? doctors[0] : null,
      doctors,
      providerCount: people.length,
      npis: [...new Set(rs.map((r) => r.npi))].sort(),
      address: [loc.line1, loc.line2].filter(Boolean).join(", "),
      city: titleCase(loc.city),
      state: loc.state.toUpperCase(),
      zip: loc.zip.replace(/\D/g, "").slice(0, 5),
      phone: rs.map((r) => formatPhone(r.location?.phone ?? null)).find(Boolean) ?? null,
    });
  }
  return out;
}

/** One licensed individual from the registry, for provider recruitment. */
export interface ProviderCandidate {
  npi: string;
  firstName: string | null;
  lastName: string | null;
  credential: string | null;
  displayName: string;
  address: string;
  city: string;
  state: string;
  zip: string;
  addressKey: string;
  /** Individuals of this profession at the same practice address in this batch. */
  providersAtPractice: number;
}

/** Individual registry records of one profession practising in `state` (organizations and other states skipped). */
export function registryIndividuals(records: RegistryRecord[], state: string, profile: RegistryProfile = CHIROPRACTIC_PROFILE): ProviderCandidate[] {
  const people = [...new Map(records.filter((r) => r.kind === "individual" && matchesProfile(r, profile) && r.location && r.location.state.toUpperCase() === state.toUpperCase() && r.location.line1.trim()).map((r) => [r.npi, r])).values()];
  const perAddress = new Map<string, number>();
  for (const r of people) {
    const k = addressKey(r.location!.line1, r.location!.zip);
    perAddress.set(k, (perAddress.get(k) ?? 0) + 1);
  }
  return people.map((r) => {
    const loc = r.location!;
    const key = addressKey(loc.line1, loc.zip);
    const name = titleCase(`${r.firstName ?? ""} ${r.lastName ?? ""}`);
    return {
      npi: r.npi, firstName: r.firstName ? titleCase(r.firstName) : null, lastName: r.lastName ? titleCase(r.lastName) : null, credential: r.credential?.trim() || null,
      displayName: `${name}${r.credential?.trim() ? `, ${r.credential.trim()}` : ""}`, address: [loc.line1, loc.line2].filter(Boolean).join(", "), city: titleCase(loc.city), state: loc.state.toUpperCase(),
      zip: loc.zip.replace(/\D/g, "").slice(0, 5), addressKey: key, providersAtPractice: perAddress.get(key) ?? 1,
    };
  });
}

const GENERIC_LOCAL = /^(info|office|contact|frontdesk|front\.desk|front|hello|admin|appointments?|appts|reception|team|care|clinic|chiro|chiropractic|scheduling|schedule|staff|mail|inquiries|wellness|help|billing)\d*$/;
const NEVER = /^(no-?reply|donotreply|postmaster|webmaster|abuse|sentry|privacy|example)/;
const PLATFORM_DOMAINS = /(wixpress\.com|sentry\.io|squarespace\.com|godaddy\.com|example\.(com|org)|domain\.com)$/;

/** Public business email only: the clinic's own domain, or a generic front-desk mailbox. Never a personal address. */
export function acceptBusinessEmail(email: string, website: string | null): boolean {
  const e = email.trim().toLowerCase();
  const m = /^([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})$/.exec(e);
  if (!m) return false;
  const [, local, domain] = m;
  if (NEVER.test(local) || PLATFORM_DOMAINS.test(domain)) return false;
  let host: string | null = null;
  try { host = website ? new URL(website.includes("//") ? website : `https://${website}`).host.replace(/^www\./, "") : null; } catch { host = null; }
  if (host && (domain === host || domain.endsWith(`.${host}`))) return true;
  if (GENERIC_LOCAL.test(local)) return true;
  // Unknown website: a non-free-mail domain is most likely the business's own.
  return !host && !/(gmail|yahoo|hotmail|outlook|aol|icloud|msn|live|comcast|bellsouth|me)\.(com|net)$/.test(domain);
}

const FRANCHISES = [
  "The Joint Chiropractic", "HealthSource Chiropractic", "100% Chiropractic", "ChiroOne", "Chiro One", "NuSpine Chiropractic", "Chiropractic Plus", "Align Chiropractic",
  "The Neck and Back Clinics", "Sherman Clinic", "LifeQuest Chiropractic",
];
export function detectFranchise(name: string): string | null {
  const n = name.toLowerCase();
  return FRANCHISES.find((f) => n.includes(f.toLowerCase())) ?? null;
}

/** What the AI web research returned (untrusted until applyResearch accepts it). */
export interface ResearchFindings {
  found: boolean;
  closed: boolean;
  confidence: number;
  practiceName: string | null;
  website: string | null;
  email: string | null;
  emailSourceUrl: string | null;
  phone: string | null;
  hasContactForm: boolean | null;
  practiceType: string | null;
  multidisciplinary: boolean | null;
  franchiseName: string | null;
  locationsCount: number | null;
  providerCount: number | null;
  doctors: string[];
  socialUrls: string[];
  sources: string[];
}

export interface ResearchTarget {
  clinicName: string;
  nameFromIndividual: boolean;
  website: string | null;
  email: string | null;
  phone: string | null;
  hasContactForm: boolean | null;
  practiceType: string | null;
  multidisciplinary: boolean | null;
  ownership: string | null;
  locationsCount: number | null;
  providerCount: number | null;
  doctors: string[];
  socialUrls: string[];
}

const SOCIAL = /^https:\/\/(www\.)?(facebook\.com|instagram\.com|linkedin\.com|youtube\.com|x\.com|twitter\.com|tiktok\.com)\//i;
const isUrl = (u: string | null | undefined) => !!u && /^https?:\/\/[^\s]+\.[^\s]+/i.test(u);

/**
 * Turns research findings into a safe update: fills only empty fields (the
 * registry's facts and anything a person entered win), requires a cited source
 * for an email, keeps business emails only, and ignores low-confidence results.
 */
export function applyResearch(current: ResearchTarget, f: ResearchFindings, minConfidence = 0.5): { patch: Partial<ResearchTarget>; rejected: string[]; pause: boolean; sources: string[] } {
  const rejected: string[] = [];
  const sources = (f.sources ?? []).filter(isUrl).slice(0, 12);
  if (!f.found || !(f.confidence >= minConfidence)) return { patch: {}, rejected: [f.found ? "low_confidence" : "not_found"], pause: false, sources };
  const patch: Partial<ResearchTarget> = {};
  const name = f.practiceName?.trim();
  if (name && name.length <= 160 && current.nameFromIndividual) patch.clinicName = name;
  const website = isUrl(f.website) ? f.website!.trim().replace(/\/$/, "") : null;
  if (!current.website && website) patch.website = website;
  if (!current.email && f.email) {
    if (!f.emailSourceUrl || !isUrl(f.emailSourceUrl)) rejected.push("email:no_source");
    else if (!acceptBusinessEmail(f.email, website ?? current.website)) rejected.push("email:not_business");
    else patch.email = f.email.trim().toLowerCase();
  }
  if (!current.phone && f.phone && /\d{3}\D*\d{3}\D*\d{4}/.test(f.phone)) patch.phone = f.phone.trim();
  if (current.hasContactForm == null && typeof f.hasContactForm === "boolean") patch.hasContactForm = f.hasContactForm;
  if (!current.practiceType && f.practiceType) patch.practiceType = f.practiceType.slice(0, 80);
  if (current.multidisciplinary == null && typeof f.multidisciplinary === "boolean") patch.multidisciplinary = f.multidisciplinary;
  const franchise = f.franchiseName ?? detectFranchise(name ?? current.clinicName);
  if (!current.ownership && franchise) patch.ownership = "franchise";
  if (current.locationsCount == null && Number.isInteger(f.locationsCount) && f.locationsCount! > 0 && f.locationsCount! < 200) patch.locationsCount = f.locationsCount!;
  if (Number.isInteger(f.providerCount) && f.providerCount! > (current.providerCount ?? 0) && f.providerCount! < 100) patch.providerCount = f.providerCount!;
  const doctors = [...new Set([...current.doctors, ...(f.doctors ?? []).map((d) => d.trim()).filter((d) => d.length > 3 && d.length < 80)])].slice(0, 20);
  if (doctors.length > current.doctors.length) patch.doctors = doctors;
  const socials: string[] = [];
  for (const u of f.socialUrls ?? []) {
    if (SOCIAL.test(u)) socials.push(u);
    else rejected.push(`socialUrls:${(() => { try { return new URL(u).host; } catch { return "invalid"; } })()}`);
  }
  if (!current.socialUrls.length && socials.length) patch.socialUrls = socials.slice(0, 6);
  return { patch, rejected, pause: f.closed, sources };
}

/**
 * Personal injury practices (auto accident care) get their own outreach wording and landing page.
 * Decided from the researched practice type (an admin can edit it on the prospect page). "Sports
 * injury" alone isn't personal injury. PI_PRACTICE_PHRASES is also the admin list filter, so the
 * two always agree.
 */
export const PI_PRACTICE_PHRASES = ["personal injury", "personal-injury", "accident", "whiplash", "auto injury", "motor vehicle"];

export function isPersonalInjuryPractice(practiceType: string | null | undefined): boolean {
  const t = (practiceType ?? "").toLowerCase();
  return PI_PRACTICE_PHRASES.some((p) => t.includes(p));
}
