import type { ErrorCode } from "./errors";
import { DomainError } from "./errors";
import { supervisionProblem, type SupervisionAttestation } from "./supervision";
import { NATIONAL_CREDENTIAL } from "./credentials";
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
  professions: { professionCode: string; status: ProviderProfessionStatus }[];
  payoutsEnabled: boolean;
  licenses: LicenseFact[];
  malpractice: MalpracticeFact[];
  skills: ProviderSkillFact[];
  maxDriveMinutes: number;
  willingOvernight: boolean;
  availabilityRules: WeeklyRule[];
  openDates: Interval[];
  blackouts: Interval[];
  /** Buffered ranges of this provider's CONFIRMED / IN_PROGRESS assignments on other shifts, any profession (INV-2). */
  busy: Interval[];
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
  lodgingAllowed: boolean;
  maxTravelBudgetCents: number | null;
  supervisionAttestation: SupervisionAttestation | null;
  config: ProfessionStateFacts;
  /** Catalog facts for every skill the shift requires. */
  skills: SkillFact[];
}

/** Facts about this particular provider/shift pair. */
export interface PairFacts {
  driveMinutes: number | null;
  /** Estimated mileage + lodging for this provider, from pricing.travelEstimate. */
  travelEstimateCents: number;
  blocked: boolean;
  previouslyDeclined: boolean;
}

export interface EligibilityOptions {
  travelBufferExtraMinutes: number;
  /** Cascade boost widens distance for overnight-willing providers (§7.7). Never touches F0–F2. */
  distanceMultiplier?: number;
  /** Emergency cover widens every provider's drive limit (only offered; they can say no). Never touches F0–F2. */
  distanceMultiplierAll?: number;
  /** Credential-only checks (nightly sweep, pre-shift check): F0, F1, F1b, F2 only. */
  credentialsOnly?: boolean;
}

export type FilterId = "F0" | "F1" | "F1b" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "F10";

export interface EligibilityFailure {
  filter: FilterId;
  code: ErrorCode;
  message: string;
}

export interface EligibilityResult {
  eligible: boolean;
  failures: EligibilityFailure[];
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
): boolean {
  return policies.some(
    (p) =>
      p.status === "VERIFIED" &&
      p.coveredProfessionCodes.includes(professionCode) &&
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
  if (!hasQualifyingMalpractice(provider.malpractice, shift.professionCode, shift.endsAt, cfg)) {
    fail("F2", "MALPRACTICE_INVALID", `No verified malpractice policy covering ${shift.professionCode} at the required limits through the shift end`);
  }

  if (opts.credentialsOnly) return { eligible: failures.length === 0, failures };

  // F3 — account + profession status.
  const prof = provider.professions.find((p) => p.professionCode === shift.professionCode);
  if (provider.status !== "ACTIVE" || prof?.status !== "ACTIVE" || !provider.payoutsEnabled) {
    fail("F3", "PROVIDER_NOT_ACTIVE", `Provider is not active for ${shift.professionCode} shifts, or payouts are not enabled`);
  }

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

  const buffer = travelBufferMinutes(pair.driveMinutes, opts.travelBufferExtraMinutes);
  const range = bufferedRange(shift.startsAt, shift.endsAt, buffer);

  // F5 — no overlapping active assignment in any profession (INV-2 is also a DB constraint).
  if (provider.busy.some((b) => overlaps(b, range))) fail("F5", "SCHEDULE_CONFLICT", "Overlaps another confirmed shift");

  // F4 — the buffered shift window sits inside availability and outside blackouts.
  const available = [...expandWeeklyRules(provider.availabilityRules, range), ...provider.openDates];
  if (!containedInUnion(range, available) || provider.blackouts.some((b) => overlaps(b, range))) {
    fail("F4", "OUTSIDE_AVAILABILITY", "Outside the provider's availability");
  }

  // F7 — distance.
  const overnightOk = provider.willingOvernight && shift.lodgingAllowed;
  const limit = provider.maxDriveMinutes * Math.max(provider.willingOvernight ? (opts.distanceMultiplier ?? 1) : 1, opts.distanceMultiplierAll ?? 1);
  if (!overnightOk) {
    if (pair.driveMinutes === null) fail("F7", "TOO_FAR", "Drive time unavailable");
    else if (pair.driveMinutes > limit) {
      fail("F7", "TOO_FAR", `Drive of ${Math.round(pair.driveMinutes)} min exceeds the provider's max of ${Math.round(limit)}`);
    }
  }

  // F8 — clinic's travel budget cap.
  if (shift.maxTravelBudgetCents !== null && pair.travelEstimateCents > shift.maxTravelBudgetCents) {
    fail("F8", "OVER_TRAVEL_BUDGET", "Estimated travel exceeds the clinic's travel budget");
  }

  // F10 — declined an offer for this shift already.
  if (pair.previouslyDeclined) fail("F10", "PREVIOUSLY_DECLINED", "Previously declined this shift");

  return { eligible: failures.length === 0, failures };
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
