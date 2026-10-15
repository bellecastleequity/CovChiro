import type { SettingsMap } from "@cm/config";
import { depositCents } from "./pricing";
import { HOUR } from "./time";

/**
 * Lodging paid up front (owner decision Oct 2026). The clinic pays 100% of a
 * booking's lodging with the deposit; the provider gets it as a separate
 * lodging advance when they reconfirm (from 48 h before the start), so the
 * money is in their account before the hotel puts a hold on their card.
 *
 * When the provider drops out, the lodging money is HELD on the shift (never
 * refunded at once) so the clinic isn't charged again for the replacement:
 * a replacement who needs lodging uses the hold, one who doesn't gets the
 * clinic the hold back, and an unfilled shift refunds it.
 */

type LodgingSettings = Pick<SettingsMap, "reconfirm.enabled" | "reconfirm.askBeforeHours" | "reconfirm.skipIfBookedWithinHours" | "lodging.clinicCancelKeepHours" | "lodging.clinicCancelKeepNights">;

/**
 * Deposit = the usual percent of the coverage and mileage, plus all of the airfare (fly-in) and all of
 * the lodging, minus lodging already held on this shift from an earlier provider (the clinic paid it).
 */
export function depositWithTravel(input: { clinicTotalCents: number; airfareCents: number; lodgingCents: number; lodgingCreditCents: number; depositPercent: number }): number {
  const rest = input.clinicTotalCents - input.airfareCents - input.lodgingCents;
  return depositCents(rest, input.depositPercent) + input.airfareCents + Math.max(0, input.lodgingCents - input.lodgingCreditCents);
}

/** Lodging the clinic still owes at completion: never charged twice (the deposit took it, or a hold paid it). */
export function balanceDueCents(input: { clinicTotalCents: number; collectedCents: number; lodgingCreditCents: number }): number {
  return Math.max(0, input.clinicTotalCents - input.collectedCents - input.lodgingCreditCents);
}

/** Earliest time a lodging advance is sent: the start of the reconfirmation window (48 h before by default). */
export function lodgingReleaseFloor(startsAt: Date, s: LodgingSettings): Date {
  return new Date(+startsAt - s["reconfirm.askBeforeHours"] * HOUR);
}

/**
 * At confirmation: does the advance wait for the provider's reconfirmation? Bookings made too close to
 * the start to be asked (reconfirm.skipIfBookedWithinHours) are their own confirmation, so they are
 * released at the window's start (or at once, inside it).
 */
export function lodgingAdvancePlan(input: { startsAt: Date; confirmedAt: Date; now: Date }, s: LodgingSettings): { waitForReconfirm: boolean; releaseAt: Date } {
  const waitForReconfirm = s["reconfirm.enabled"] && +input.startsAt - +input.confirmedAt > s["reconfirm.skipIfBookedWithinHours"] * HOUR;
  return { waitForReconfirm, releaseAt: new Date(Math.max(+input.now, +lodgingReleaseFloor(input.startsAt, s))) };
}

export interface LodgingCancelInput {
  /** CLINIC = the clinic cancelled. PROVIDER = the provider dropped out (or declined the clinic's change). PLATFORM = removed by us (credential, ID check, failed deposit, admin). */
  by: "CLINIC" | "PROVIDER" | "PLATFORM";
  /** The shift goes back to matching (false for a no-show, a past start or a cancelled shift). */
  reopen: boolean;
  now: Date;
  startsAt: Date;
  /** This booking's lodging (nights × nightly rate). */
  lodgingCents: number;
  nightlyCents: number;
  /** Lodging money we hold for this booking: the part of its deposit that was lodging plus any hold it used. */
  collectedCents: number;
  /** Lodging advance already sent to the provider. */
  paidOutCents: number;
}

export interface LodgingCancelOutcome {
  /** Kept on the shift for the replacement provider. */
  holdCents: number;
  /** Back to the clinic now. */
  refundCents: number;
  /** The provider keeps (or is paid) this much of the lodging. */
  providerKeepsCents: number;
  /** Taken back from the advance already sent. */
  reverseCents: number;
}

export function lodgingOnCancel(i: LodgingCancelInput, s: LodgingSettings): LodgingCancelOutcome {
  const collected = Math.max(0, i.collectedCents);
  const paidOut = Math.max(0, i.paidOutCents);
  if (i.by === "CLINIC") {
    // A hotel usually charges a night when the stay is cancelled within about a day of check-in.
    const late = +i.startsAt - +i.now < s["lodging.clinicCancelKeepHours"] * HOUR;
    const keep = late ? Math.min(i.lodgingCents, s["lodging.clinicCancelKeepNights"] * i.nightlyCents, collected) : 0;
    return { holdCents: 0, refundCents: collected - keep, providerKeepsCents: keep, reverseCents: Math.max(0, paidOut - keep) };
  }
  // The provider (or we) ended it: the advance comes back; the money waits for the replacement.
  if (i.reopen) return { holdCents: collected, refundCents: 0, providerKeepsCents: 0, reverseCents: paidOut };
  return { holdCents: 0, refundCents: collected, providerKeepsCents: 0, reverseCents: paidOut };
}

/** A replacement is confirmed: the hold pays their lodging; whatever it doesn't need goes back to the clinic. */
export function lodgingOnReplacement(heldCents: number, newLodgingCents: number): { creditCents: number; refundCents: number } {
  const held = Math.max(0, heldCents);
  const creditCents = Math.min(held, Math.max(0, newLodgingCents));
  return { creditCents, refundCents: held - creditCents };
}

/** Clinic-booked stays (Shift.lodgingStayKind). */
export const STAY_KINDS = ["HOTEL", "RENTAL", "OTHER"] as const;
export type StayKind = (typeof STAY_KINDS)[number];

/** Provider-facing words for a clinic-booked stay, e.g. "a hotel". */
export function stayLabel(kind: string | null | undefined): string {
  return kind === "HOTEL" ? "a hotel" : kind === "RENTAL" ? "an Airbnb, apartment or rental" : "a place to stay";
}

/** One line telling the provider the clinic books (and pays for) their stay. */
export function stayByClinicLine(kind: string | null | undefined): string {
  return `The clinic books and pays for your stay (${stayLabel(kind)}) if you'd need to stay over. No lodging allowance; you don't pay for it.`;
}

// ---------------- clinic-booked stay details ----------------

export interface StayFacts {
  place: string | null;
  address: string | null;
  checkInAt: Date | null;
  bookedUnder: string | null;
  /** The booking the stay was last saved for (null = saved before anyone was confirmed). */
  forAssignmentId: string | null;
}

export type StayMissing = "place" | "address" | "checkIn" | "bookedUnder" | "newProvider";

export const STAY_MISSING_WORDS: Record<StayMissing, string> = {
  place: "the place's name",
  address: "the address",
  checkIn: "the check-in date and time",
  bookedUnder: "the name it's booked under",
  newProvider: "the reservation moved to your new provider's name",
};

/** What the clinic still has to add before the booked provider has everything they need. */
export function stayMissing(f: StayFacts, liveAssignmentId: string): StayMissing[] {
  const out: StayMissing[] = [];
  if (f.forAssignmentId && f.forAssignmentId !== liveAssignmentId) out.push("newProvider");
  if (!f.place?.trim()) out.push("place");
  if (!f.address?.trim()) out.push("address");
  if (!f.checkInAt) out.push("checkIn");
  if (!f.bookedUnder?.trim()) out.push("bookedUnder");
  return out;
}

/** The provider sees the details only once they were saved for them (or before anyone was booked). */
export function staySharedWith(f: Pick<StayFacts, "forAssignmentId">, assignmentId: string): boolean {
  return !f.forAssignmentId || f.forAssignmentId === assignmentId;
}

/** Door codes and access instructions are shown from this many hours before the start. */
export function stayAccessVisible(startsAt: Date, now: Date, accessFromHours: number): boolean {
  return +startsAt - +now <= accessFromHours * HOUR;
}

/** The reminder mark (hours before the start) that is due now, latest first; null when none. */
export function stayReminderDue(startsAt: Date, now: Date, marks: number[]): number | null {
  const left = (+startsAt - +now) / HOUR;
  if (left <= 0) return null;
  const due = [...marks].sort((a, b) => a - b).find((m) => left <= m);
  return due ?? null;
}

export type StayDateIssue = "CHECKIN_AFTER_START" | "CHECKIN_TOO_EARLY" | "CHECKOUT_BEFORE_START" | "CHECKOUT_TOO_LATE";

/**
 * Stay dates vs the shift (or the whole multi-day booking): check-in should be within `windowHours`
 * before the start, check-out between the start and `windowHours` after the end. Advice only.
 */
export function stayDateIssues(stay: { checkIn: Date | null; checkOut: Date | null }, work: { startsAt: Date; endsAt: Date }, windowHours = 24): StayDateIssue[] {
  const out: StayDateIssue[] = [];
  const w = windowHours * HOUR;
  if (stay.checkIn) {
    if (+stay.checkIn > +work.startsAt) out.push("CHECKIN_AFTER_START");
    else if (+stay.checkIn < +work.startsAt - w) out.push("CHECKIN_TOO_EARLY");
  }
  if (stay.checkOut) {
    if (+stay.checkOut < +work.startsAt) out.push("CHECKOUT_BEFORE_START");
    else if (+stay.checkOut > +work.endsAt + w) out.push("CHECKOUT_TOO_LATE");
  }
  return out;
}
