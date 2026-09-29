import { DomainError } from "./errors";

/**
 * Allowed transitions per entity (SPEC §6). Every status write in the app
 * goes through `assertTransition`, and the service layer writes an AuditLog
 * row alongside it.
 */

export type ShiftStatus =
  | "DRAFT"
  | "OPEN"
  | "FAVORITES_ONLY"
  | "SELECTING"
  | "CASCADING"
  | "CONFIRMED"
  | "IN_PROGRESS"
  | "COMPLETED"
  | "UNFILLED"
  | "CANCELLED";

export type ApplicationStatus = "ACTIVE" | "WITHDRAWN" | "SELECTED" | "NOT_SELECTED" | "AUTO_WITHDRAWN_CONFLICT" | "INELIGIBLE";
export type OfferStatus = "PENDING" | "ACCEPTED" | "DECLINED" | "EXPIRED" | "WITHDRAWN";
export type AssignmentStatus = "CONFIRMED" | "IN_PROGRESS" | "COMPLETED" | "CANCELLED" | "LICENSE_LAPSED" | "DISPUTED" | "NO_SHOW";
export type PayoutStatus = "PENDING" | "SCHEDULED" | "ON_HOLD" | "PROCESSING" | "PAID" | "FAILED" | "CANCELLED";

const PRE_START: ShiftStatus[] = ["DRAFT", "OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING", "CONFIRMED"];

export const SHIFT_TRANSITIONS: Record<ShiftStatus, ShiftStatus[]> = {
  DRAFT: ["FAVORITES_ONLY", "OPEN", "CANCELLED"],
  FAVORITES_ONLY: ["OPEN", "CONFIRMED", "CANCELLED"],
  OPEN: ["SELECTING", "CASCADING", "CONFIRMED", "UNFILLED", "CANCELLED"],
  SELECTING: ["CONFIRMED", "CASCADING", "UNFILLED", "CANCELLED"],
  CASCADING: ["CONFIRMED", "UNFILLED", "CANCELLED", "CASCADING"],
  // Backfill: a provider cancellation or license lapse sends the shift back to OPEN (§7.9).
  CONFIRMED: ["IN_PROGRESS", "OPEN", "CANCELLED"],
  IN_PROGRESS: ["COMPLETED"],
  COMPLETED: [],
  UNFILLED: [],
  CANCELLED: [],
};

export const APPLICATION_TRANSITIONS: Record<ApplicationStatus, ApplicationStatus[]> = {
  ACTIVE: ["SELECTED", "NOT_SELECTED", "WITHDRAWN", "AUTO_WITHDRAWN_CONFLICT", "INELIGIBLE"],
  SELECTED: [],
  NOT_SELECTED: [],
  WITHDRAWN: [],
  AUTO_WITHDRAWN_CONFLICT: [],
  INELIGIBLE: [],
};

export const OFFER_TRANSITIONS: Record<OfferStatus, OfferStatus[]> = {
  PENDING: ["ACCEPTED", "DECLINED", "EXPIRED", "WITHDRAWN"],
  ACCEPTED: [],
  DECLINED: [],
  EXPIRED: [],
  WITHDRAWN: [],
};

export const ASSIGNMENT_TRANSITIONS: Record<AssignmentStatus, AssignmentStatus[]> = {
  CONFIRMED: ["IN_PROGRESS", "CANCELLED", "LICENSE_LAPSED", "NO_SHOW"],
  IN_PROGRESS: ["COMPLETED", "DISPUTED", "NO_SHOW"],
  COMPLETED: ["DISPUTED"],
  DISPUTED: ["COMPLETED", "CANCELLED"],
  CANCELLED: [],
  LICENSE_LAPSED: [],
  NO_SHOW: [],
};

export const PAYOUT_TRANSITIONS: Record<PayoutStatus, PayoutStatus[]> = {
  PENDING: ["SCHEDULED", "ON_HOLD", "CANCELLED"],
  SCHEDULED: ["PROCESSING", "ON_HOLD", "CANCELLED"],
  ON_HOLD: ["SCHEDULED", "CANCELLED"],
  PROCESSING: ["PAID", "FAILED"],
  FAILED: ["SCHEDULED", "PROCESSING", "CANCELLED"],
  PAID: [],
  CANCELLED: [],
};

type Machine = "Shift" | "Application" | "Offer" | "Assignment" | "Payout";
const TABLES: Record<Machine, Record<string, string[]>> = {
  Shift: SHIFT_TRANSITIONS,
  Application: APPLICATION_TRANSITIONS,
  Offer: OFFER_TRANSITIONS,
  Assignment: ASSIGNMENT_TRANSITIONS,
  Payout: PAYOUT_TRANSITIONS,
};

export function canTransition(machine: Machine, from: string, to: string): boolean {
  return (TABLES[machine][from] ?? []).includes(to);
}

export function assertTransition(machine: Machine, from: string, to: string): void {
  if (!canTransition(machine, from, to)) {
    throw new DomainError("INVALID_TRANSITION", `${machine} cannot move from ${from} to ${to}`, { machine, from, to });
  }
}

export function shiftIsCancellable(status: ShiftStatus): boolean {
  return PRE_START.includes(status);
}

/** Shift statuses where a provider could still be selected. */
export const SELECTABLE_SHIFT_STATUSES: ShiftStatus[] = ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"];
export const ACTIVE_ASSIGNMENT_STATUSES: AssignmentStatus[] = ["CONFIRMED", "IN_PROGRESS"];
