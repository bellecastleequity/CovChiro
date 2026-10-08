import { normalizeLicenseNumber } from "./boardcheck";

/**
 * Clinic ownership verification (owner decision Oct 2026). A clinic tells us its legal entity,
 * who owns it (and their licenses), its organization NPI and, where the state requires one for
 * clinics not wholly owned by licensed practitioners, its facility license. Automatic checks run
 * against public records; a clean practitioner-owned clinic is approved at once, anything else
 * goes to an admin. Until a clinic is cleared, its shifts aren't shown or offered to providers
 * (eligibility F13). Ownership rules differ by state, so they are data (Setting
 * clinicVerify.stateRules), never hard-coded; an attorney should confirm each state's rule.
 */

export type ClinicVerificationStatus = "NOT_STARTED" | "PENDING" | "NEEDS_INFO" | "VERIFIED" | "REJECTED";

export interface ClinicClearFacts {
  status: ClinicVerificationStatus;
  /** Verification lapses after this (yearly renewal plus the grace period). */
  verifiedUntil: Date | null;
  /** Clinics that were on the platform before verification started (or renewing) may keep working until this. */
  graceUntil: Date | null;
}

/** May providers see and take this clinic's shifts? */
export function clinicCleared(f: ClinicClearFacts, now: Date, enabled = true): boolean {
  if (!enabled) return true;
  if (f.status === "REJECTED") return false;
  if (f.status === "VERIFIED" && (!f.verifiedUntil || +now < +f.verifiedUntil)) return true;
  return !!f.graceUntil && +now < +f.graceUntil;
}

/** The date the clinic must verify (or renew) by to keep its shifts going out; null = nothing due. */
export function clinicVerifyDeadline(f: ClinicClearFacts, now: Date): Date | null {
  if (f.status === "REJECTED") return null;
  const dates = [f.graceUntil, f.status === "VERIFIED" ? f.verifiedUntil : null].filter((d): d is Date => !!d && +d > +now);
  return dates.length ? new Date(Math.max(...dates.map(Number))) : null;
}

/** Which reminder (index into reminderDays, largest first) is due before a deadline, or null. */
export function verifyReminderDue(deadline: Date | null, now: Date, reminderDays: number[]): number | null {
  if (!deadline) return null;
  const left = (+deadline - +now) / 86_400_000;
  if (left <= 0) return null;
  const days = [...reminderDays].sort((a, b) => b - a);
  let due: number | null = null;
  days.forEach((d, i) => {
    if (left <= d) due = i;
  });
  return due;
}

export interface StateOwnershipRule {
  /** Where to look the entity up (e.g. Florida Division of Corporations, Sunbiz). */
  entityRegistry: string;
  entityLookupUrl: string;
  /** Owners who aren't licensed practitioners: allowed, allowed with a facility license, or not allowed. */
  nonPractitionerOwners: "ALLOWED" | "FACILITY_LICENSE" | "NOT_ALLOWED";
  facilityLicenseName?: string;
  facilityLicenseLookupUrl?: string;
  /** Plain note shown to the clinic and the admin. */
  note?: string;
}

export interface OwnerInput {
  name: string;
  percent: number;
  licensed: boolean;
  professionCode?: string | null;
  licenseState?: string | null;
  licenseNumber?: string | null;
  /** Their individual NPI (optional; helps the automatic check). */
  npi?: string | null;
}

export interface VerificationInput {
  entityName: string;
  entityState: string;
  entityNumber: string;
  orgNpi: string | null;
  owners: OwnerInput[];
  facilityLicenseNumber: string | null;
  /** Florida-style certificate of exemption on file (practitioner-owned). */
  facilityExemptionNumber: string | null;
  documentKeys: string[];
  /** Couldn't upload: the clinic will email the documents (an admin uploads them and marks the item OK). */
  documentsLater?: boolean;
  /** Typed name for the sworn statement. */
  attestName: string;
}

export const isNpi = (s: string) => /^\d{10}$/.test(s) && luhnNpi(s);

/** NPI check digit (Luhn with the 80840 prefix). */
function luhnNpi(npi: string): boolean {
  const digits = `80840${npi}`.split("").map(Number);
  let sum = 0;
  for (let i = 0; i < digits.length; i++) {
    let v = digits[digits.length - 1 - i];
    if (i % 2 === 1) {
      v *= 2;
      if (v > 9) v -= 9;
    }
    sum += v;
  }
  return sum % 10 === 0;
}

export const practitionerOwned = (owners: OwnerInput[]) => owners.length > 0 && owners.every((o) => o.licensed);

/** Form problems the clinic must fix before submitting (plain sentences). */
export function verificationInputProblems(input: VerificationInput, rule: StateOwnershipRule | null): string[] {
  const out: string[] = [];
  if (input.entityName.trim().length < 2) out.push("Enter the clinic's legal business name as registered with the state.");
  if (!/^[A-Z]{2}$/.test(input.entityState)) out.push("Choose the state the business is registered in.");
  if (input.entityNumber.trim().length < 3) out.push(`Enter the state registration (document) number${rule ? ` from ${rule.entityRegistry}` : ""}.`);
  if (input.orgNpi && !isNpi(input.orgNpi)) out.push("The organization NPI should be 10 digits. Check it on the NPI registry.");
  if (!input.owners.length) out.push("List everyone who owns part of the clinic.");
  const total = input.owners.reduce((a, o) => a + (Number.isFinite(o.percent) ? o.percent : 0), 0);
  if (input.owners.length && Math.abs(total - 100) > 0.5) out.push(`Ownership adds up to ${Math.round(total * 10) / 10}%. It should add up to 100%.`);
  input.owners.forEach((o, i) => {
    const who = o.name.trim() || `Owner ${i + 1}`;
    if (o.name.trim().length < 3) out.push(`Enter owner ${i + 1}'s full legal name.`);
    if (!(o.percent > 0 && o.percent <= 100)) out.push(`Enter ${who}'s ownership share (1–100%).`);
    if (o.licensed && (!o.licenseNumber?.trim() || !o.licenseState || !o.professionCode)) out.push(`Enter ${who}'s license: profession, state and number.`);
    if (o.npi && !isNpi(o.npi)) out.push(`${who}'s NPI should be 10 digits.`);
  });
  if (rule?.nonPractitionerOwners === "FACILITY_LICENSE" && input.owners.length && !practitionerOwned(input.owners)) {
    if (!input.facilityLicenseNumber?.trim()) out.push(`Not every owner is a licensed practitioner, so enter the clinic's ${rule.facilityLicenseName ?? "facility license"} number.`);
    if (!input.documentKeys.length && !input.documentsLater) out.push(`Upload a copy of the ${rule.facilityLicenseName ?? "facility license"}, or tick "I'll email the documents instead".`);
  }
  if (input.attestName.trim().length < 3) out.push("Type your full name to sign the ownership statement.");
  return out;
}

/** Lower-case name tokens without titles/credentials. */
export function nameTokens(name: string): string[] {
  const drop = new Set(["dr", "doctor", "dc", "md", "do", "pa", "pt", "dpt", "lmt", "jr", "sr", "ii", "iii", "iv", "mr", "mrs", "ms", "phd", "chiropractic", "physician"]);
  return name
    .toLowerCase()
    .replace(/[.,'’]/g, "")
    .split(/[\s-]+/)
    .filter((t) => t && !drop.has(t));
}

/** Same person: same last name and the same first name (or first initial). */
export function namesMatch(a: string, b: string): boolean {
  const x = nameTokens(a);
  const y = nameTokens(b);
  if (x.length < 2 || y.length < 2) return false;
  if (x[x.length - 1] !== y[y.length - 1]) return false;
  const f1 = x[0];
  const f2 = y[0];
  return f1 === f2 || ((f1.length === 1 || f2.length === 1) && f1[0] === f2[0]);
}

export const sameLicenseNumber = (a: string, b: string) => {
  const na = normalizeLicenseNumber(a);
  const nb = normalizeLicenseNumber(b);
  if (na === nb) return true;
  const da = na.replace(/\D/g, "").replace(/^0+/, "");
  return da.length >= 4 && da === nb.replace(/\D/g, "").replace(/^0+/, "");
};

/** What the services looked up, per owner and for the organization. */
export interface VerificationFacts {
  rule: StateOwnershipRule | null;
  /** The clinic's primary location state (the entity may be registered elsewhere). */
  locationState: string | null;
  locationZip: string | null;
  orgNpi: { found: boolean; name: string; state: string | null; zip: string | null; authorizedOfficial: string | null } | null;
  /** NPPES couldn't be reached: those checks go to a person. */
  registryDown?: boolean;
  owners: {
    /** Where the license was confirmed: a verified license on this platform, the NPI registry, or not found. */
    license: "PLATFORM" | "NPPES" | "NOT_FOUND" | null;
    /** The name on that record matches the owner's name. */
    nameMatches: boolean;
    /** The state's license file shows it inactive (State license check). */
    boardInactive?: boolean;
  }[];
  /** Shares a phone number or address with a suspended or banned clinic. */
  linkedToBlocked: boolean;
}

export type CheckOutcome = "PASS" | "FAIL" | "REVIEW" | "SKIP";
export interface VerificationCheck {
  key: string;
  label: string;
  outcome: CheckOutcome;
  detail: string;
  /** An admin marked this item OK by hand (what it was before, who, when, how they checked). */
  override?: { from: CheckOutcome; by: string; at: string; note: string };
}

/** An admin approves one item by hand: it becomes PASS, keeping what it was and how they checked. */
export function overrideCheck(checks: VerificationCheck[], key: string, by: string, note: string, at: Date): VerificationCheck[] {
  if (!checks.some((c) => c.key === key)) throw new Error(`No check ${key}`);
  return checks.map((c) => (c.key === key && c.outcome !== "PASS" ? { ...c, outcome: "PASS", override: { from: c.outcome, by, at: at.toISOString(), note } } : c));
}

/** Items still needing a person (the registration spot-check never blocks). */
export const openChecks = (checks: VerificationCheck[]) => checks.filter((c) => c.key !== "entity" && (c.outcome === "FAIL" || c.outcome === "REVIEW"));

/** The automatic checks, one row each, in plain words (shown to the admin). */
export function verificationChecks(input: VerificationInput, f: VerificationFacts): VerificationCheck[] {
  const out: VerificationCheck[] = [];
  const rule = f.rule;
  const state = f.locationState ?? input.entityState;
  out.push(
    rule
      ? { key: "state_rule", label: "Ownership rule for the state", outcome: "PASS", detail: rule.note ?? `${state}: rules on file.` }
      : { key: "state_rule", label: "Ownership rule for the state", outcome: "REVIEW", detail: `No ownership rule is set up for ${state} yet (Settings → Clinic verification). A person reviews this clinic.` },
  );
  const allLicensed = practitionerOwned(input.owners);
  if (allLicensed) out.push({ key: "ownership", label: "Who owns it", outcome: "PASS", detail: "Every owner is a licensed practitioner." });
  else if (rule?.nonPractitionerOwners === "NOT_ALLOWED")
    out.push({ key: "ownership", label: "Who owns it", outcome: "FAIL", detail: `Some owners aren't licensed practitioners, and ${state}'s rule on file says that isn't allowed. Check with counsel before approving.` });
  else if (rule?.nonPractitionerOwners === "FACILITY_LICENSE")
    out.push({ key: "ownership", label: "Who owns it", outcome: "REVIEW", detail: `Some owners aren't licensed practitioners, so the clinic needs a ${rule.facilityLicenseName ?? "facility license"}. Check the number${rule.facilityLicenseLookupUrl ? " on the state's lookup" : ""} and the upload.` });
  else out.push({ key: "ownership", label: "Who owns it", outcome: "REVIEW", detail: "Some owners aren't licensed practitioners. Check the ownership is allowed." });

  input.owners.forEach((o, i) => {
    const r = f.owners[i];
    const label = `License: ${o.name}`;
    if (!o.licensed) return;
    if (!r || r.license === null) out.push({ key: `owner_${i}`, label, outcome: "REVIEW", detail: "Not checked automatically." });
    else if (r.boardInactive) out.push({ key: `owner_${i}`, label, outcome: "FAIL", detail: `The state's license file shows ${o.licenseState} ${o.licenseNumber} as not active.` });
    else if (r.license === "NOT_FOUND") out.push({ key: `owner_${i}`, label, outcome: "REVIEW", detail: `${o.licenseState} license ${o.licenseNumber} wasn't found on this platform or in the NPI registry. Look it up with the state board.` });
    else if (!r.nameMatches) out.push({ key: `owner_${i}`, label, outcome: "REVIEW", detail: `License ${o.licenseNumber} was found, but under a different name. Check it's the same person.` });
    else out.push({ key: `owner_${i}`, label, outcome: "PASS", detail: r.license === "PLATFORM" ? "Matches a license we've verified." : "Matches the NPI registry (name, state and license number)." });
  });

  if (!input.orgNpi) out.push({ key: "org_npi", label: "Organization NPI", outcome: "REVIEW", detail: "No organization NPI given. Check the business another way." });
  else if (f.registryDown || !f.orgNpi) out.push({ key: "org_npi", label: "Organization NPI", outcome: "REVIEW", detail: "The NPI registry couldn't be reached. Look the NPI up by hand." });
  else if (!f.orgNpi.found) out.push({ key: "org_npi", label: "Organization NPI", outcome: "FAIL", detail: `NPI ${input.orgNpi} isn't an active organization in the NPI registry.` });
  else {
    const problems: string[] = [];
    if (state && f.orgNpi.state && f.orgNpi.state !== state) problems.push(`its practice address is in ${f.orgNpi.state}`);
    if (f.locationZip && f.orgNpi.zip && f.orgNpi.zip.slice(0, 5) !== f.locationZip.slice(0, 5)) problems.push(`its ZIP is ${f.orgNpi.zip.slice(0, 5)}, not ${f.locationZip.slice(0, 5)}`);
    const official = f.orgNpi.authorizedOfficial;
    const officialOwner = official ? input.owners.some((o) => namesMatch(o.name, official)) : false;
    if (!officialOwner) problems.push(official ? `its authorized official is ${official}, who isn't listed as an owner` : "it lists no authorized official");
    out.push(
      problems.length
        ? { key: "org_npi", label: "Organization NPI", outcome: "REVIEW", detail: `${f.orgNpi.name}: ${problems.join("; ")}.` }
        : { key: "org_npi", label: "Organization NPI", outcome: "PASS", detail: `${f.orgNpi.name}: active, at this location, authorized official is an owner.` },
    );
  }

  out.push({
    key: "entity",
    label: "State business registration",
    outcome: "REVIEW",
    detail: `${input.entityName}, ${input.entityState} #${input.entityNumber}. ${rule ? `Spot-check on ${rule.entityRegistry}: active, and owners/officers match.` : "Spot-check on the state's business registry."}`,
  });
  if (input.facilityLicenseNumber || input.facilityExemptionNumber) {
    out.push({
      key: "facility",
      label: rule?.facilityLicenseName ?? "Facility license",
      outcome: allLicensed ? "PASS" : "REVIEW",
      detail: input.facilityLicenseNumber ? `License ${input.facilityLicenseNumber}.` : `Exemption ${input.facilityExemptionNumber}.`,
    });
  }
  if (input.documentsLater) {
    out.push({ key: "documents", label: "Documents", outcome: "REVIEW", detail: "The clinic couldn't upload and will email the documents. Upload them here when they arrive, then mark this OK." });
  }
  if (f.linkedToBlocked) out.push({ key: "linked", label: "Links to blocked clinics", outcome: "FAIL", detail: "Shares a phone number or address with a suspended or banned clinic." });
  return out;
}

/**
 * Approve automatically only when nothing needs a person: a state rule on file, every owner a
 * licensed practitioner whose license checked out, the organization NPI matching, and no links to
 * blocked clinics. The entity registration is always only a spot-check (no free state API), so
 * it never stops auto-approval on its own.
 */
export function autoApprovable(checks: VerificationCheck[]): { approve: boolean; reasons: string[] } {
  const blocking = openChecks(checks);
  return { approve: blocking.length === 0, reasons: blocking.map((c) => `${c.label}: ${c.detail}`) };
}
