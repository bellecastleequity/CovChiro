/**
 * Photo ID check (owner decision Oct 2026). The provider photographs a driver's license and
 * takes a selfie in Stripe Identity's own screen; Stripe holds the images. We keep only the
 * outcome (and whether the name on the ID matches the account's legal name).
 *
 * When it's needed (cheapest timing that still protects clinics):
 *  - a shift starting within `acceptWithinHours` (default 48): verify before applying or
 *    accepting (eligibility F17), so a same-day booking never depends on a check;
 *  - any later shift: book first, verify by `deadlineHours` (default 24) before the start, or
 *    the booking is released like an unconfirmed one and emergency cover takes over.
 * One check per person; a capped number of tries (Stripe bills each completed check).
 */
import { namesMatch } from "./clinicVerify";

export type IdStatus = "NONE" | "PENDING" | "PROCESSING" | "VERIFIED" | "NEEDS_REVIEW" | "FAILED";
export const ID_STATUSES: IdStatus[] = ["NONE", "PENDING", "PROCESSING", "VERIFIED", "NEEDS_REVIEW", "FAILED"];

export interface IdCheckRules {
  enabled: boolean;
  acceptWithinHours: number;
  deadlineHours: number;
  maxAttempts: number;
}

const HOUR = 3_600_000;

/** F17: an unverified provider can't apply for or accept a shift starting this soon. */
export function idNeededBeforeAccepting(rules: IdCheckRules, status: IdStatus, startsAt: Date, now: Date): boolean {
  if (!rules.enabled || status === "VERIFIED") return false;
  return +startsAt - +now <= rules.acceptWithinHours * HOUR;
}

/**
 * When a booking confirmed now must be ID-verified by; null = nothing to enforce (check off,
 * already verified, or the deadline has already passed, e.g. an admin booked them late).
 */
export function idDueAt(rules: IdCheckRules, status: IdStatus, startsAt: Date, now: Date): Date | null {
  if (!rules.enabled || status === "VERIFIED") return null;
  const due = new Date(+startsAt - rules.deadlineHours * HOUR);
  return +due > +now ? due : null;
}

/** Plain words for Stripe Identity's last_error codes (shown to the provider and admins). */
export function idErrorWords(code: string | null | undefined): string {
  switch (code) {
    case "document_expired":
      return "The ID has expired. Use a current driver's license or passport.";
    case "document_type_not_supported":
      return "That kind of ID isn't accepted. Use a driver's license, state ID or passport.";
    case "document_unverified_other":
    case "document_manipulated":
      return "We couldn't read or confirm the ID. Retake the photos in good light, with all four corners showing.";
    case "selfie_face_mismatch":
      return "The selfie didn't match the photo on the ID.";
    case "selfie_document_missing_photo":
      return "The ID photo didn't show a face clearly.";
    case "selfie_unverified_other":
    case "selfie_manipulated":
      return "The selfie couldn't be confirmed. Retake it facing the camera in good light.";
    case "consent_declined":
      return "The check was stopped before it finished.";
    case "under_supported_age":
      return "The ID check couldn't be completed for this person.";
    default:
      return "The ID check didn't go through.";
  }
}

export interface IdSessionFacts {
  /** Stripe VerificationSession.status. */
  sessionStatus: "requires_input" | "processing" | "verified" | "canceled";
  /** last_error.code when a try failed. */
  errorCode?: string | null;
  /** Name read from the ID (verified_outputs). */
  idFirstName?: string | null;
  idLastName?: string | null;
  /** The account's legal name. */
  legalName: string;
  /** Tries started so far, this one included. */
  attempts: number;
  maxAttempts: number;
}

/** Our status for a Stripe session, and a note for admins (never the ID's details). */
export function idOutcome(f: IdSessionFacts): { status: IdStatus; note: string | null } {
  if (f.sessionStatus === "verified") {
    const idName = `${f.idFirstName ?? ""} ${f.idLastName ?? ""}`.trim();
    if (idName && namesMatch(idName, f.legalName)) return { status: "VERIFIED", note: null };
    return { status: "NEEDS_REVIEW", note: "The ID checked out, but the name on it doesn't match the account's legal name. Compare them in Stripe." };
  }
  if (f.sessionStatus === "processing") return { status: "PROCESSING", note: null };
  const failed = f.sessionStatus === "requires_input" && !!f.errorCode;
  if (!failed) return f.attempts >= f.maxAttempts && f.sessionStatus === "canceled" ? { status: "NEEDS_REVIEW", note: `No ID check finished after ${f.attempts} tries.` } : { status: f.sessionStatus === "canceled" ? "NONE" : "PENDING", note: null };
  const why = idErrorWords(f.errorCode);
  if (f.attempts >= f.maxAttempts) return { status: "NEEDS_REVIEW", note: `Didn't pass after ${f.attempts} tries. Last reason: ${why}` };
  return { status: "FAILED", note: why };
}

/** Can the provider start a (new) try? VERIFIED / PROCESSING / NEEDS_REVIEW wait on Stripe or an admin. */
export function canStartIdCheck(status: IdStatus, attempts: number, maxAttempts: number): boolean {
  if (status === "VERIFIED" || status === "PROCESSING" || status === "NEEDS_REVIEW") return false;
  return attempts < maxAttempts;
}
