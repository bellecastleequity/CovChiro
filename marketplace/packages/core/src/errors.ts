/** Consistent error shape for the API: { code, message, details } (SPEC §17). */
export type ErrorCode =
  | "LICENSE_STATE_MISMATCH"
  | "LICENSE_PROFESSION_MISMATCH"
  | "LICENSE_EXPIRES_BEFORE_SHIFT"
  | "SUPERVISION_NOT_ATTESTED"
  | "PROFESSION_NOT_ENABLED"
  | "SKILL_NOT_IN_SCOPE"
  | "MALPRACTICE_INVALID"
  | "PROVIDER_NOT_ACTIVE"
  | "AGREEMENT_NOT_SIGNED"
  | "OUTSIDE_AVAILABILITY"
  | "SCHEDULE_CONFLICT"
  | "MISSING_REQUIRED_SKILL"
  | "INSUFFICIENT_EXPERIENCE"
  | "BELOW_PAY_FLOOR"
  | "CLINIC_NOT_VERIFIED"
  | "TOO_FAR"
  | "OVER_TRAVEL_BUDGET"
  | "BLOCKED"
  | "PREVIOUSLY_DECLINED"
  | "STATE_NOT_ENABLED"
  | "INVALID_TRANSITION"
  | "PROMO_INVALID"
  | "VALIDATION"
  | "NOT_FOUND"
  | "FORBIDDEN"
  | "UNAUTHENTICATED"
  | "CONFLICT"
  | "PAYMENT_FAILED";

export class DomainError extends Error {
  constructor(
    public readonly code: ErrorCode,
    message: string,
    public readonly details?: unknown,
    public readonly status: number = defaultStatus(code),
  ) {
    super(message);
    this.name = "DomainError";
  }
  toJSON() {
    return { code: this.code, message: this.message, details: this.details ?? null };
  }
}

function defaultStatus(code: ErrorCode): number {
  switch (code) {
    case "NOT_FOUND":
      return 404;
    case "UNAUTHENTICATED":
      return 401;
    case "VALIDATION":
    case "PROMO_INVALID":
      return 400;
    case "CONFLICT":
    case "INVALID_TRANSITION":
    case "SCHEDULE_CONFLICT":
      return 409;
    case "PAYMENT_FAILED":
      return 402;
    default:
      return 403;
  }
}
