import type { FlyInFacts } from "./flyin";
import { DateTime } from "luxon";
import type { ErrorCode } from "./errors";
import { DomainError } from "./errors";
import { supervisionProblem, type SupervisionAttestation } from "./supervision";
import { NATIONAL_CREDENTIAL } from "./credentials";
import { payFloorProblem, type PayFloor } from "./volume";
import { containedInUnion, expandWeeklyRules, iv, MINUTE, overlaps, type Interval, type WeeklyRule } from "./time";

/**
 * INV-1 (profession + state), INV-3, INV-8 and the other hard filters
 * (SPEC §7.1 as revised by Addendum 01 §7.1), as one pure function.
 *
 * Every eligibility decision goes through `evaluateEligibility`: the single
 * check (`assertProviderEligibleForShift` in @cm/services) loads facts for one
 * provider, and the set-based query (`getEligibleProviders`) prefilters in SQL
 * and then runs this same function on the survivors. A property test asserts
 * the two always agree.
 */

export type CredentialStatus = "PENDING_VERIFICATION" | "VERIFIED" | "EXPIRED" | "SUSPENDED" | "REVOKED" | "REJECTED";
export type ProviderStatus = "ONBOARDING" | "ACTIVE" | "PAUSED" | "SUSPENDED" | "DEACTIVATED";
export type ProviderProfessionStatus = "ONBOARDING" | "ACTIVE" | "PAUSED";

export interface LicenseFact {
  professionCode: string;
  state: string;
  status: CredentialStatus;
  expiresAt: Date;
}

export interface MalpracticeFact {
  status: CredentialStatus;
  expiresAt: Date;
  perOccurrenceCents: number;
  aggregateCents: number;
  coveredProfessionCodes: string[];
  /** States/territories the policy covers; empty or missing = all states. */
  coveredStates?: string[];
}

export interface ProviderSkillFact {
  skillId: string;
  /** Only meaningful when the skill requires certification. */
  certificationStatus: CredentialStatus | null;
  certificationExpiresAt: Date | null;
}

export interface ProviderFacts {
  id: string;
  status: ProviderStatus;
  /** Per-profession activation; F3 checks the shift's profession. */
  professions: { professionCode: string; status: ProviderProfessionStatus; yearsInPractice?: number | null }[];
  payoutsEnabled: boolean;
  /** Signed the current Provider Agreement (any older version doesn't count). */
  agreementCurrent: boolean;
  licenses: LicenseFact[];
  malpractice: MalpracticeFact[];
  skills: ProviderSkillFact[];
  maxDriveMinutes: number;
  willingOvernight: boolean;
  availabilityRules: WeeklyRule[];
  openDates: Interval[];
  blackouts: Interval[];
  /** Taking a break: no shifts starting from `from` until `until` (null = until they resume). */
  onBreak?: { from: number; until: number | null } | null;
  /** Buffered ranges of this provider's CONFIRMED / IN_PROGRESS assignments on other shifts, any profession (INV-2). */
  busy: Interval[];
  /** Lowest pay the provider accepts, per profession (F12). Never shown to clinics. */
  payFloors?: PayFloor[];
  /** States/territories they'll fly to (fly-in coverage; credentials still required). */
  flyInStates?: string[];
}

/** ProfessionStateConfig for the shift's (profession, state), with profession defaults already resolved. */
export interface ProfessionStateFacts {
  enabled: boolean;
  stateEnabled: boolean;
  /**
   * The state does not license this profession and the admin accepts a
   * national registry credential (License.state = "US") instead (A5).
   */
  nationalCredentialAccepted: boolean;
  supervisionRequired: boolean;
  supervisingProfessionCodes: string[];
  malpracticeMinOccurrenceCents: number;
  malpracticeMinAggregateCents: number;
}

export interface SkillFact {
  id: string;
  requiresCertification: boolean;
  scopeSensitive: boolean;
  /** SkillStateRule(skill, shift profession, shift state).allowed; missing rule = false. */
  allowedInScope: boolean;
}

export interface ShiftFacts {
  id: string;
  professionCode: string;
  /** From the geocoded ClinicLocation — never user free text. */
  state: string;
  startsAt: Date;
  endsAt: Date;
  requiredSkillIds: string[];
  /** Clinic preference: minimum years practicing this profession (0 = any). Relaxed in emergencies when the clinic allows it. */
  minYearsExperience?: number;
  lodgingAllowed: boolean;
  maxTravelBudgetCents: number | null;
  supervisionAttestation: SupervisionAttestation | null;
  config: ProfessionStateFacts;
  /** Catalog facts for every skill the shift requires. */
  skills: SkillFact[];
  /** Fly-in allowed for this shift (flyin.ts); null/absent = no fly-in. */
  flyIn?: FlyInFacts | null;
  /** The clinic is verified (or still in its grace period); false = its shifts aren't shown or offered (F13). Absent = cleared. */
  clinicCleared?: boolean;
  /** Quoted provider pay (tier base with premiums, no overage) for F12. Absent = F12 skipped. */
  pay?: { durationTier: "HALF_DAY" | "FULL_DAY" | "HOURLY"; providerPayCents: number; billableHours: number };
}

/** Facts about this particular provider/shift pair. */
export interface PairFacts {
  driveMinutes: number | null;
  /** Estimated mileage + lodging for this provider, from pricing.travelEstimate. */
  travelEstimateCents: number;
  /** Estimated mileage only (F12 when the provider counts mileage); falls back to travelEstimateCents. */
  mileageCents?: number;
  blocked: boolean;
  previouslyDeclined: boolean;
}

export interface EligibilityOptions {
  travelBufferExtraMinutes: number;
  /** Cascade boost widens distance for overnight-willing providers (§7.7). Never touches F0–F2. */
  distanceMultiplier?: number;
  /** Emergency cover widens every provider's drive limit (only offered; they can say no). Never touches F0–F2. */
  distanceMultiplierAll?: number;
  /** Furthest one-way drive for providers taking lodging (pricing.lodgingMaxDriveMinutes); undefined = no limit. */
  lodgingMaxDriveMinutes?: number;
  /** Credential-only checks (nightly sweep, pre-shift check): F0, F1, F1b, F2 only. */
  credentialsOnly?: boolean;
  /** Evaluation time (fly-in cut-off); defaults to now. */
  now?: Date;
}

export type FilterId = "F0" | "F1" | "F1b" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "F10" | "F11" | "F12" | "F13";

export interface EligibilityFailure {
  filter: FilterId;
  code: ErrorCode;
  message: string;
}

export interface EligibilityResult {
  eligible: boolean;
  failures: EligibilityFailure[];
  /** The provider would fly in (beyond driving range, fly-in allowed both sides). */
  flyIn?: boolean;
}

/**
 * A license counts only if VERIFIED, for the shift's profession, in the
 * shift's state, valid past the shift end. Where the state does not license
 * the profession and accepts a national registry credential, a VERIFIED
 * national credential (state "US") for the profession counts instead.
 */
export function hasQualifyingLicense(licenses: LicenseFact[], professionCode: string, state: string, endsAt: Date, nationalCredentialAccepted = false): boolean {
  return licenses.some(
    (l) =>
      l.professionCode === professionCode &&
      (l.state === state || (nationalCredentialAccepted && l.state === NATIONAL_CREDENTIAL)) &&
      l.status === "VERIFIED" &&
      l.expiresAt.getTime() > endsAt.getTime(),
  );
}

export function hasQualifyingMalpractice(
  policies: MalpracticeFact[],
  professionCode: string,
  endsAt: Date,
  mins: Pick<ProfessionStateFacts, "malpracticeMinOccurrenceCents" | "malpracticeMinAggregateCents">,
  /** The shift's state: a policy that lists covered states must include it. */
  state?: string,
): boolean {
  return policies.some(
    (p) =>
      p.status === "VERIFIED" &&
      p.coveredProfessionCodes.includes(professionCode) &&
      (!state || !p.coveredStates?.length || p.coveredStates.includes(state)) &&
      p.expiresAt.getTime() > endsAt.getTime() &&
      p.perOccurrenceCents >= mins.malpracticeMinOccurrenceCents &&
      p.aggregateCents >= mins.malpracticeMinAggregateCents,
  );
}

/**
 * What a provider can take: { DC: ["FL","GA"], LMT: ["FL"] } ("You can take: Chiropractic shifts in FL, GA · …").
 * `nationalStates` lists, per profession, the states that accept a national
 * registry credential; a verified one expands to those states.
 */
export function licensedPairs(licenses: LicenseFact[], at: Date = new Date(), nationalStates: Record<string, string[]> = {}): Record<string, string[]> {
  const out: Record<string, Set<string>> = {};
  for (const l of licenses) {
    if (l.status !== "VERIFIED" || l.expiresAt <= at) continue;
    const states = l.state === NATIONAL_CREDENTIAL ? (nationalStates[l.professionCode] ?? []) : [l.state];
    for (const st of states) (out[l.professionCode] ??= new Set()).add(st);
  }
  return Object.fromEntries(Object.entries(out).map(([k, v]) => [k, [...v].sort()]));
}

/** Why a shift falls outside weekly hours, in the provider's own time zone. */
function availabilityGap(rules: WeeklyRule[], shift: Interval): string {
  const zone = rules[0]?.timeZone ?? "America/New_York";
  const start = DateTime.fromMillis(shift.start, { zone });
  const end = DateTime.fromMillis(shift.end, { zone });
  const t = (d: DateTime) => d.toFormat("h:mm a");
  const hm = (min: number) => DateTime.fromObject({ hour: Math.floor(min / 60) % 24, minute: min % 60 }).toFormat("h:mm a");
  const dayName = start.toFormat("cccc");
  const that = rules.filter((r) => r.weekday === start.weekday % 7);
  const want = `${dayName} ${t(start)}–${t(end)}`;
  if (!that.length) return `Not available on ${dayName}s (shift ${want})`;
  return `Shift ${want} is outside the provider's ${dayName} hours (${that.map((r) => `${hm(r.startMin)}–${hm(r.endMin)}`).join(", ")}, ${zone.replace("America/", "").replace("_", " ")} time)`;
}

export function bufferedRange(startsAt: Date, endsAt: Date, bufferMinutes: number): Interval {
  return iv(startsAt.getTime() - bufferMinutes * MINUTE, endsAt.getTime() + bufferMinutes * MINUTE);
}

export function travelBufferMinutes(driveMinutes: number | null, extra: number): number {
  return Math.max(0, Math.round(driveMinutes ?? 0)) + extra;
}

/** Skills a shift may require/prefer in its profession-state (scope-sensitive needs an allowing rule). */
export function skillScopeProblem(skills: SkillFact[]): string | null {
  const bad = skills.filter((s) => s.scopeSensitive && !s.allowedInScope);
  return bad.length ? `${bad.length} selected skill(s) are outside the scope of practice for this profession in this state` : null;
}

/** Within the provider's drive limit, or the lodging limit when they'll stay overnight (F7). */
export function withinDrive(provider: ProviderFacts, shift: ShiftFacts, driveMinutes: number | null, opts: EligibilityOptions): boolean {
  const overnightOk =
    provider.willingOvernight && shift.lodgingAllowed && (opts.lodgingMaxDriveMinutes === undefined || (driveMinutes !== null && driveMinutes <= opts.lodgingMaxDriveMinutes));
  if (overnightOk) return true;
  const limit = provider.maxDriveMinutes * Math.max(provider.willingOvernight ? (opts.distanceMultiplier ?? 1) : 1, opts.distanceMultiplierAll ?? 1);
  return driveMinutes !== null && driveMinutes <= limit;
}

/** Beyond driving range, but the shift allows fly-in, the provider flies to its state, and there's still time to book flights. */
export function isFlyInPair(provider: ProviderFacts, shift: ShiftFacts, driveMinutes: number | null, opts: EligibilityOptions): boolean {
  if (!shift.flyIn || !provider.flyInStates?.includes(shift.state)) return false;
  if (+(opts.now ?? new Date()) > +shift.flyIn.until) return false;
  return !withinDrive(provider, shift, driveMinutes, opts);
}

export function evaluateEligibility(provider: ProviderFacts, shift: ShiftFacts, pair: PairFacts, opts: EligibilityOptions): EligibilityResult {
  const failures: EligibilityFailure[] = [];
  const fail = (filter: FilterId, code: ErrorCode, message: string) => failures.push({ filter, code, message });
  const cfg = shift.config;

  // F0 — state AND profession-state enabled.
  if (!cfg.stateEnabled || !cfg.enabled) {
    fail("F0", "PROFESSION_NOT_ENABLED", `${shift.professionCode} shifts are not enabled in ${shift.state}`);
  }

  // F1 — licensure by profession + state (INV-1). Home state / proximity / other professions are irrelevant.
  const national = cfg.nationalCredentialAccepted;
  if (!hasQualifyingLicense(provider.licenses, shift.professionCode, shift.state, shift.endsAt, national)) {
    const verified = provider.licenses.filter((l) => l.status === "VERIFIED");
    const samePair = verified.filter((l) => l.professionCode === shift.professionCode && (l.state === shift.state || (national && l.state === NATIONAL_CREDENTIAL)));
    if (samePair.length) {
      fail("F1", "LICENSE_EXPIRES_BEFORE_SHIFT", `${shift.professionCode} license in ${shift.state} expires before the shift ends`);
    } else if (verified.some((l) => l.state === shift.state)) {
      fail("F1", "LICENSE_PROFESSION_MISMATCH", `No verified ${shift.professionCode} license in ${shift.state}`);
    } else {
      fail("F1", "LICENSE_STATE_MISMATCH", `No verified ${shift.professionCode} license in ${shift.state}`);
    }
  }

  // F1b — supervision attestation (INV-8).
  if (cfg.supervisionRequired) {
    const why = supervisionProblem(shift.supervisionAttestation, cfg.supervisingProfessionCodes);
    if (why) fail("F1b", "SUPERVISION_NOT_ATTESTED", why);
  }

  // F2 — malpractice covering the profession and meeting the profession-state minimum (INV-3).
  if (!hasQualifyingMalpractice(provider.malpractice, shift.professionCode, shift.endsAt, cfg, shift.state)) {
    fail("F2", "MALPRACTICE_INVALID", `No verified malpractice policy covering ${shift.professionCode} in ${shift.state} at the required limits through the shift end`);
  }

  if (opts.credentialsOnly) return { eligible: failures.length === 0, failures };

  // F3 — account + profession status.
  const prof = provider.professions.find((p) => p.professionCode === shift.professionCode);
  if (provider.status !== "ACTIVE" || prof?.status !== "ACTIVE" || !provider.payoutsEnabled) {
    fail("F3", "PROVIDER_NOT_ACTIVE", `Provider is not active for ${shift.professionCode} shifts, or payouts are not enabled`);
  }
  if (!provider.agreementCurrent) fail("F3", "AGREEMENT_NOT_SIGNED", "Sign the current Provider Agreement (Profile → Agreement) to be matched to shifts");

  // F13 — the clinic's ownership verification (clinicVerify.ts). Booked shifts are untouched: credential-only checks stop above.
  if (shift.clinicCleared === false) fail("F13", "CLINIC_NOT_VERIFIED", "The clinic hasn't finished verification yet");

  // F9 — blocks, either direction.
  if (pair.blocked) fail("F9", "BLOCKED", "Blocked");

  // F6 — required skills: held, certification verified where needed, and in scope for the state.
  const held = new Map(provider.skills.map((s) => [s.skillId, s]));
  const catalog = new Map(shift.skills.map((s) => [s.id, s]));
  let missing = 0;
  for (const id of shift.requiredSkillIds) {
    const have = held.get(id);
    const meta = catalog.get(id);
    const certOk =
      !meta?.requiresCertification ||
      (have?.certificationStatus === "VERIFIED" && have.certificationExpiresAt !== null && have.certificationExpiresAt > shift.endsAt);
    const scopeOk = !meta?.scopeSensitive || meta.allowedInScope;
    if (!have || !certOk || !scopeOk) missing++;
  }
  if (missing) fail("F6", "MISSING_REQUIRED_SKILL", `Missing ${missing} required skill(s) or certification(s)`);

  const flyIn = isFlyInPair(provider, shift, pair.driveMinutes, opts);
  // A fly-in provider stays at the destination, so no drive time either side.
  const buffer = travelBufferMinutes(flyIn ? null : pair.driveMinutes, opts.travelBufferExtraMinutes);
  const range = bufferedRange(shift.startsAt, shift.endsAt, buffer);

  // F5 — no overlapping active assignment in any profession (INV-2 is also a DB constraint).
  if (provider.busy.some((b) => overlaps(b, range))) fail("F5", "SCHEDULE_CONFLICT", "Overlaps another confirmed shift");

  // F4 — the shift's own hours sit inside availability (weekly hours mean "when I can work";
  // travel time is not counted against them), and the buffered window misses every blackout.
  const onSite = iv(shift.startsAt, shift.endsAt);
  const available = [...expandWeeklyRules(provider.availabilityRules, onSite), ...provider.openDates];
  // Overnight stays (lodging allowed, provider willing) travel the day before, so only the clinic hours meet blackouts.
  const blackoutWindow = (provider.willingOvernight && shift.lodgingAllowed) || flyIn ? onSite : range;
  const brk = provider.onBreak;
  if (brk && +shift.startsAt >= brk.from && (brk.until === null || +shift.startsAt < brk.until)) {
    fail("F4", "OUTSIDE_AVAILABILITY", brk.until === null ? "Taking a break (not accepting new shifts)" : `Taking a break until ${new Date(brk.until).toISOString().slice(0, 10)}`);
  } else if (provider.blackouts.some((b) => overlaps(b, blackoutWindow))) {
    fail("F4", "OUTSIDE_AVAILABILITY", buffer && blackoutWindow === range ? `Overlaps time off the provider blocked (including ${buffer} min travel either side)` : "Overlaps time off the provider blocked");
  } else if (!containedInUnion(onSite, available)) {
    fail("F4", "OUTSIDE_AVAILABILITY", availabilityGap(provider.availabilityRules, onSite));
  }

  // F7 — distance.
  // Lodging lets overnight-willing providers come from beyond their own drive limit, up to the lodging maximum.
  const overnightOk =
    provider.willingOvernight && shift.lodgingAllowed && (opts.lodgingMaxDriveMinutes === undefined || (pair.driveMinutes !== null && pair.driveMinutes <= opts.lodgingMaxDriveMinutes));
  const limit = provider.maxDriveMinutes * Math.max(provider.willingOvernight ? (opts.distanceMultiplier ?? 1) : 1, opts.distanceMultiplierAll ?? 1);
  if (!overnightOk && !flyIn) {
    if (pair.driveMinutes === null) fail("F7", "TOO_FAR", "Drive time unavailable");
    else if (pair.driveMinutes > limit) {
      fail("F7", "TOO_FAR", `Drive of ${Math.round(pair.driveMinutes)} min exceeds the provider's max of ${Math.round(limit)}`);
    }
  }

  // F8 — clinic's travel budget cap.
  if (shift.maxTravelBudgetCents !== null && pair.travelEstimateCents > shift.maxTravelBudgetCents) {
    fail("F8", "OVER_TRAVEL_BUDGET", "Estimated travel exceeds the clinic's travel budget");
  }

  // F11 — clinic's minimum experience (years practicing the shift's profession, as entered by the provider).
  const minYears = shift.minYearsExperience ?? 0;
  if (minYears > 0 && (prof?.yearsInPractice ?? 0) < minYears) {
    fail("F11", "INSUFFICIENT_EXPERIENCE", `The clinic asks for ${minYears}+ years of ${shift.professionCode} experience`);
  }

  // F12 — provider's minimum pay (Addendum 03 §7). Overage never counts; mileage only if they opted in.
  if (shift.pay) {
    const why = payFloorProblem(provider.payFloors, { professionCode: shift.professionCode, ...shift.pay }, pair.mileageCents ?? pair.travelEstimateCents);
    if (why) fail("F12", "BELOW_PAY_FLOOR", why);
  }

  // F10 — declined an offer for this shift already.
  if (pair.previouslyDeclined) fail("F10", "PREVIOUSLY_DECLINED", "Previously declined this shift");

  return { eligible: failures.length === 0, failures, ...(flyIn ? { flyIn: true } : {}) };
}

/** Throws the first failure as a DomainError (F0/F1 failures come first). */
export function assertEligible(result: EligibilityResult): void {
  if (result.eligible) return;
  const first = result.failures[0];
  throw new DomainError(first.code, first.message, { failures: result.failures });
}

/** Multi-day groups with sameProviderRequired: every day must pass (license must outlast the last day). */
export function evaluateGroupEligibility(
  provider: ProviderFacts,
  shifts: ShiftFacts[],
  pairFor: (shift: ShiftFacts) => PairFacts,
  opts: EligibilityOptions,
): EligibilityResult {
  const failures: EligibilityFailure[] = [];
  for (const s of shifts) failures.push(...evaluateEligibility(provider, s, pairFor(s), opts).failures);
  return { eligible: failures.length === 0, failures };
}
