import type { ErrorCode } from "./errors";
import { DomainError } from "./errors";
import { containedInUnion, expandWeeklyRules, iv, MINUTE, overlaps, type Interval, type WeeklyRule } from "./time";

/**
 * INV-1 / INV-3 and the other hard filters (SPEC §7.1), as one pure function.
 *
 * Every eligibility decision in the system goes through `evaluateEligibility`:
 * the single-doctor check (`assertDoctorEligibleForShift` in the web/worker
 * service layer) loads facts for one doctor, and the set-based query
 * (`getEligibleDoctors`) prefilters in SQL and then runs this same function on
 * the survivors. A property test asserts the two always agree.
 */

export type CredentialStatus = "PENDING_VERIFICATION" | "VERIFIED" | "EXPIRED" | "SUSPENDED" | "REVOKED" | "REJECTED";
export type DoctorStatus = "ONBOARDING" | "ACTIVE" | "PAUSED" | "SUSPENDED" | "DEACTIVATED";

export interface LicenseFact {
  state: string;
  status: CredentialStatus;
  expiresAt: Date;
}

export interface MalpracticeFact {
  status: CredentialStatus;
  expiresAt: Date;
  perOccurrenceCents: number;
  aggregateCents: number;
}

export interface DoctorFacts {
  id: string;
  status: DoctorStatus;
  profileComplete: boolean;
  payoutsEnabled: boolean;
  licenses: LicenseFact[];
  malpractice: MalpracticeFact[];
  techniqueIds: string[];
  maxDriveMinutes: number;
  willingOvernight: boolean;
  availabilityRules: WeeklyRule[];
  openDates: Interval[];
  blackouts: Interval[];
  /** Buffered ranges of this doctor's CONFIRMED / IN_PROGRESS assignments (other shifts). */
  busy: Interval[];
}

export interface ShiftFacts {
  id: string;
  /** From the geocoded ClinicLocation — never user free text. */
  state: string;
  startsAt: Date;
  endsAt: Date;
  requiredTechniqueIds: string[];
  lodgingAllowed: boolean;
  maxTravelBudgetCents: number | null;
}

/** Facts about this particular doctor/shift pair. */
export interface PairFacts {
  driveMinutes: number | null;
  /** Estimated mileage + lodging for this doctor, from pricing.travelEstimate. */
  travelEstimateCents: number;
  blocked: boolean;
  previouslyDeclined: boolean;
}

export interface EligibilityOptions {
  minMalpracticePerOccurrenceCents: number;
  minMalpracticeAggregateCents: number;
  travelBufferExtraMinutes: number;
  /** Cascade boost widens distance for overnight-willing doctors (§7.7). Never touches F1. */
  distanceMultiplier?: number;
  /** Credential-only checks (nightly sweep, pre-shift check): skip F3–F10. */
  credentialsOnly?: boolean;
}

export type FilterId = "F1" | "F2" | "F3" | "F4" | "F5" | "F6" | "F7" | "F8" | "F9" | "F10";

export interface EligibilityFailure {
  filter: FilterId;
  code: ErrorCode;
  message: string;
}

export interface EligibilityResult {
  eligible: boolean;
  failures: EligibilityFailure[];
}

/** A license counts only if VERIFIED, in the shift's state, and valid past the shift end. */
export function hasQualifyingLicense(licenses: LicenseFact[], state: string, endsAt: Date): boolean {
  return licenses.some((l) => l.state === state && l.status === "VERIFIED" && l.expiresAt.getTime() > endsAt.getTime());
}

export function hasQualifyingMalpractice(
  policies: MalpracticeFact[],
  endsAt: Date,
  opts: Pick<EligibilityOptions, "minMalpracticePerOccurrenceCents" | "minMalpracticeAggregateCents">,
): boolean {
  return policies.some(
    (p) =>
      p.status === "VERIFIED" &&
      p.expiresAt.getTime() > endsAt.getTime() &&
      p.perOccurrenceCents >= opts.minMalpracticePerOccurrenceCents &&
      p.aggregateCents >= opts.minMalpracticeAggregateCents,
  );
}

/** States a doctor can currently take shifts in ("You can take shifts in: FL, GA"). */
export function licensedStates(licenses: LicenseFact[], at: Date = new Date()): string[] {
  return [...new Set(licenses.filter((l) => l.status === "VERIFIED" && l.expiresAt > at).map((l) => l.state))].sort();
}

export function bufferedRange(startsAt: Date, endsAt: Date, bufferMinutes: number): Interval {
  return iv(startsAt.getTime() - bufferMinutes * MINUTE, endsAt.getTime() + bufferMinutes * MINUTE);
}

export function travelBufferMinutes(driveMinutes: number | null, extra: number): number {
  return Math.max(0, Math.round(driveMinutes ?? 0)) + extra;
}

export function evaluateEligibility(
  doctor: DoctorFacts,
  shift: ShiftFacts,
  pair: PairFacts,
  opts: EligibilityOptions,
): EligibilityResult {
  const failures: EligibilityFailure[] = [];
  const fail = (filter: FilterId, code: ErrorCode, message: string) => failures.push({ filter, code, message });

  // F1 — state licensure (INV-1). Home state / proximity are irrelevant.
  if (!hasQualifyingLicense(doctor.licenses, shift.state, shift.endsAt)) {
    const inState = doctor.licenses.filter((l) => l.state === shift.state && l.status === "VERIFIED");
    if (inState.length > 0) {
      fail("F1", "LICENSE_EXPIRES_BEFORE_SHIFT", `License in ${shift.state} expires before the shift ends`);
    } else {
      fail("F1", "LICENSE_STATE_MISMATCH", `No verified license in ${shift.state}`);
    }
  }

  // F2 — malpractice (INV-3).
  if (!hasQualifyingMalpractice(doctor.malpractice, shift.endsAt, opts)) {
    fail("F2", "MALPRACTICE_INVALID", "No verified malpractice policy meeting the minimum limits through the shift end");
  }

  if (opts.credentialsOnly) return { eligible: failures.length === 0, failures };

  // F3 — account status.
  if (doctor.status !== "ACTIVE" || !doctor.profileComplete || !doctor.payoutsEnabled) {
    fail("F3", "DOCTOR_NOT_ACTIVE", "Doctor account is not active, profile incomplete, or payouts not enabled");
  }

  // F9 — blocks, either direction.
  if (pair.blocked) fail("F9", "BLOCKED", "Blocked");

  // F6 — required techniques.
  const have = new Set(doctor.techniqueIds);
  const missing = shift.requiredTechniqueIds.filter((t) => !have.has(t));
  if (missing.length) fail("F6", "MISSING_REQUIRED_TECHNIQUE", `Missing ${missing.length} required technique(s)`);

  const buffer = travelBufferMinutes(pair.driveMinutes, opts.travelBufferExtraMinutes);
  const range = bufferedRange(shift.startsAt, shift.endsAt, buffer);

  // F5 — no overlapping active assignment (INV-2 is also a DB constraint).
  if (doctor.busy.some((b) => overlaps(b, range))) fail("F5", "SCHEDULE_CONFLICT", "Overlaps another confirmed shift");

  // F4 — availability: the buffered shift window must sit inside availability and outside blackouts.
  const available = [...expandWeeklyRules(doctor.availabilityRules, range), ...doctor.openDates];
  if (!containedInUnion(range, available) || doctor.blackouts.some((b) => overlaps(b, range))) {
    fail("F4", "OUTSIDE_AVAILABILITY", "Outside the doctor's availability");
  }

  // F7 — distance.
  const overnightOk = doctor.willingOvernight && shift.lodgingAllowed;
  const limit = doctor.maxDriveMinutes * (doctor.willingOvernight ? (opts.distanceMultiplier ?? 1) : 1);
  if (!overnightOk) {
    if (pair.driveMinutes === null) fail("F7", "TOO_FAR", "Drive time unavailable");
    else if (pair.driveMinutes > limit) {
      fail("F7", "TOO_FAR", `Drive of ${Math.round(pair.driveMinutes)} min exceeds the doctor's max of ${Math.round(limit)}`);
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

/** Throws the first failure as a DomainError. F1 failures always surface as LICENSE_STATE_MISMATCH-family codes. */
export function assertEligible(result: EligibilityResult): void {
  if (result.eligible) return;
  const first = result.failures[0];
  throw new DomainError(first.code, first.message, { failures: result.failures });
}

/** Multi-day groups with sameDoctorRequired: every day must pass (license must outlast the last day). */
export function evaluateGroupEligibility(
  doctor: DoctorFacts,
  shifts: ShiftFacts[],
  pairFor: (shift: ShiftFacts) => PairFacts,
  opts: EligibilityOptions,
): EligibilityResult {
  const failures: EligibilityFailure[] = [];
  for (const s of shifts) {
    const r = evaluateEligibility(doctor, s, pairFor(s), opts);
    failures.push(...r.failures);
  }
  return { eligible: failures.length === 0, failures };
}
