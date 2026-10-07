import type { SettingsMap } from "@cm/config";
import { HOUR } from "./time";

/**
 * Fly-in coverage (owner decision Oct 2026). A provider licensed and insured in a state or
 * territory too far to drive (e.g. lives in FL, licensed in VI) lists it under "Willing to fly
 * to"; a clinic there allows fly-in when posting (enough consecutive days and notice). Such a
 * provider skips the drive limit (F7) for that shift; every credential check still applies.
 * Money: a flat airfare allowance per trip by destination (no receipts) + lodging every night
 * (night before each day) at the destination's nightly allowance, both on the clinic's total and
 * the provider's pay; travel days are unpaid. Settings flyIn.*.
 */

export interface FlyInFacts {
  /** Airfare allowance for the trip (snapshotted at posting). */
  airfareCents: number;
  /** Lodging per night for fly-in stays (snapshotted at posting). */
  nightlyCents: number;
  /** Last moment a fly-in provider can be added (first day − flyIn.minLeadDays). */
  until: Date;
}

type FlyInSettings = Pick<
  SettingsMap,
  "flyIn.airfareDollars" | "flyIn.defaultAirfareDollars" | "flyIn.lodgingNightlyDollars" | "pricing.lodgingNightlyCents" | "flyIn.minDays" | "flyIn.minLeadDays" | "flyIn.airfareRefundHours"
>;

export function flyInAirfareCents(state: string, s: Pick<FlyInSettings, "flyIn.airfareDollars" | "flyIn.defaultAirfareDollars">): number {
  return (s["flyIn.airfareDollars"][state] ?? s["flyIn.defaultAirfareDollars"]) * 100;
}

export function flyInNightlyCents(state: string, s: Pick<FlyInSettings, "flyIn.lodgingNightlyDollars" | "pricing.lodgingNightlyCents">): number {
  const d = s["flyIn.lodgingNightlyDollars"][state];
  return d === undefined ? s["pricing.lodgingNightlyCents"] : d * 100;
}

/** Days of a booking that can allow fly-in: at least flyIn.minDays consecutive days, starting flyIn.minLeadDays out. Null = OK. */
export function flyInPostingProblem(days: { startsAt: Date; endsAt: Date }[], now: Date, s: Pick<FlyInSettings, "flyIn.minDays" | "flyIn.minLeadDays">): string | null {
  const sorted = [...days].sort((a, b) => +a.startsAt - +b.startsAt);
  const min = s["flyIn.minDays"];
  if (sorted.length < min) return `Fly-in needs at least ${min} consecutive days, so the provider's trip is worth the flight.`;
  for (let i = 1; i < sorted.length; i++) {
    // Next day starts within 36 h of the previous start (no gap days).
    if (+sorted[i].startsAt - +sorted[i - 1].startsAt > 36 * HOUR) return "Fly-in days must be consecutive (no days off in between).";
  }
  if (+sorted[0].startsAt - +now < s["flyIn.minLeadDays"] * 24 * HOUR) return `Fly-in needs at least ${s["flyIn.minLeadDays"]} days' notice so the provider can book flights.`;
  return null;
}

/** When fly-in providers can no longer be added to a booking whose first day starts at `firstStart`. */
export function flyInUntil(firstStart: Date, s: Pick<FlyInSettings, "flyIn.minLeadDays">): Date {
  return new Date(+firstStart - s["flyIn.minLeadDays"] * 24 * HOUR);
}

/**
 * Cancelling a fly-in day that carries the airfare: the airfare stays payable to the provider when
 * they still fly for other days of the booking, or when the clinic cancels after the refund window
 * (flyIn.airfareRefundHours after confirmation: the provider has booked flights). Otherwise refunded.
 */
export function flyInAirfareKept(
  input: { by: "CLINIC" | "PROVIDER" | "PLATFORM"; confirmedAt: Date; now: Date; otherDaysRemain: boolean },
  s: Pick<FlyInSettings, "flyIn.airfareRefundHours">,
): boolean {
  if (input.otherDaysRemain) return true;
  return input.by === "CLINIC" && +input.now - +input.confirmedAt >= s["flyIn.airfareRefundHours"] * HOUR;
}
