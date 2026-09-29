import type { SettingsMap } from "@cm/config";
import { isFederalHoliday } from "./holidays";
import { hoursBetween, localParts } from "./time";

/**
 * Rate engine (SPEC §8, INV-7). Clinics and doctors never set prices; every
 * number shown or charged comes out of these functions.
 */

export type DurationTier = "HALF_DAY" | "FULL_DAY";
export type PremiumKind = "URGENT" | "WEEKEND" | "HOLIDAY" | "BOOST";

export interface RateCardFacts {
  clinicPriceCents: number;
  doctorPayCents: number;
}

export interface AppliedPremium {
  kind: PremiumKind;
  percent: number;
}

export interface BaseQuote {
  tier: DurationTier;
  hours: number;
  overtimeHours: number;
  premiums: AppliedPremium[];
  clinicPriceCents: number;
  doctorPayCents: number;
  marginCents: number;
}

export function durationTier(hours: number): { tier: DurationTier; overtimeHours: number } {
  if (hours <= 0) throw new Error("Shift must have positive length");
  if (hours < 4) return { tier: "HALF_DAY", overtimeHours: 0 };
  return { tier: "FULL_DAY", overtimeHours: Math.max(0, round2(hours - 8)) };
}

export interface PremiumInput {
  startsAt: Date;
  /** When the price was set (posting time). Drives the urgent premium. */
  pricedAt: Date;
  timeZone: string;
  boosted: boolean;
}

type PricingSettings = Pick<
  SettingsMap,
  | "pricing.overtimeClinicCentsPerHour"
  | "pricing.overtimeDoctorCentsPerHour"
  | "pricing.premiumUrgentPercent"
  | "pricing.premiumWeekendPercent"
  | "pricing.premiumHolidayPercent"
  | "pricing.boostPercent"
>;

export function applicablePremiums(input: PremiumInput, s: PricingSettings): AppliedPremium[] {
  const out: AppliedPremium[] = [];
  if (hoursBetween(input.pricedAt, input.startsAt) < 48) out.push({ kind: "URGENT", percent: s["pricing.premiumUrgentPercent"] });
  const local = localParts(input.startsAt, input.timeZone);
  if (local.weekday === 0 || local.weekday === 6) out.push({ kind: "WEEKEND", percent: s["pricing.premiumWeekendPercent"] });
  if (isFederalHoliday(local.isoDate)) out.push({ kind: "HOLIDAY", percent: s["pricing.premiumHolidayPercent"] });
  if (input.boosted) out.push({ kind: "BOOST", percent: s["pricing.boostPercent"] });
  return out.filter((p) => p.percent > 0);
}

export function premiumMultiplier(premiums: AppliedPremium[]): number {
  return premiums.reduce((m, p) => m * (1 + p.percent / 100), 1);
}

export function quoteBase(
  shift: { startsAt: Date; endsAt: Date },
  card: RateCardFacts,
  premiumInput: Omit<PremiumInput, "startsAt">,
  s: PricingSettings,
): BaseQuote {
  const hours = round2(hoursBetween(shift.startsAt, shift.endsAt));
  const { tier, overtimeHours } = durationTier(hours);
  const baseClinic = card.clinicPriceCents + Math.round(overtimeHours * s["pricing.overtimeClinicCentsPerHour"]);
  const baseDoctor = card.doctorPayCents + Math.round(overtimeHours * s["pricing.overtimeDoctorCentsPerHour"]);
  const premiums = applicablePremiums({ ...premiumInput, startsAt: shift.startsAt }, s);
  const mult = premiumMultiplier(premiums);
  const clinicPriceCents = Math.round(baseClinic * mult);
  const doctorPayCents = Math.round(baseDoctor * mult);
  return { tier, hours, overtimeHours, premiums, clinicPriceCents, doctorPayCents, marginCents: clinicPriceCents - doctorPayCents };
}

// ---------- travel (§8.5): 100% pass-through, no margin ----------

type TravelSettings = Pick<SettingsMap, "pricing.mileageRateCentsPerMile" | "pricing.mileageRoundTrip" | "pricing.lodgingTriggerMinutes">;

export function mileageCents(oneWayMiles: number, s: TravelSettings): number {
  const miles = s["pricing.mileageRoundTrip"] ? oneWayMiles * 2 : oneWayMiles;
  return Math.round(miles * s["pricing.mileageRateCentsPerMile"]);
}

export function lodgingNightsEstimate(
  driveMinutes: number,
  shift: { lodgingAllowed: boolean; lodgingCapCentsPerNight: number | null; consecutiveDays?: number },
  s: TravelSettings,
): number {
  if (!shift.lodgingAllowed || !shift.lodgingCapCentsPerNight) return 0;
  const days = shift.consecutiveDays ?? 1;
  if (driveMinutes > s["pricing.lodgingTriggerMinutes"]) return days; // night before each day
  if (days > 1) return days - 1;
  return 0;
}

export function travelEstimate(
  drive: { minutes: number; miles: number },
  shift: { lodgingAllowed: boolean; lodgingCapCentsPerNight: number | null; consecutiveDays?: number },
  s: TravelSettings,
): { mileageCents: number; lodgingEstimateCents: number; totalCents: number; nights: number } {
  const m = mileageCents(drive.miles, s);
  const nights = lodgingNightsEstimate(drive.minutes, shift, s);
  const lodging = nights * (shift.lodgingCapCentsPerNight ?? 0);
  return { mileageCents: m, lodgingEstimateCents: lodging, totalCents: m + lodging, nights };
}

/** Clinic-facing travel range for the posting screen (nearest to farthest likely candidate). */
export function travelRange(estimates: number[]): { minCents: number; maxCents: number } | null {
  if (!estimates.length) return null;
  return { minCents: Math.min(...estimates), maxCents: Math.max(...estimates) };
}

// ---------- totals and display separation (§8.7) ----------

export interface PriceBreakdown {
  clinicPriceCents: number;
  doctorPayCents: number;
  promoDiscountCents: number;
  mileageCents: number;
  lodgingCents: number;
}

export function clinicTotalCents(b: PriceBreakdown): number {
  return b.clinicPriceCents - b.promoDiscountCents + b.mileageCents + b.lodgingCents;
}

export function doctorTotalCents(b: PriceBreakdown): number {
  return b.doctorPayCents + b.mileageCents + b.lodgingCents;
}

export function platformMarginCents(b: PriceBreakdown): number {
  return b.clinicPriceCents - b.promoDiscountCents - b.doctorPayCents;
}

/** What a clinic may see: never doctor pay. */
export function clinicView(b: PriceBreakdown) {
  return {
    coverageCents: b.clinicPriceCents,
    discountCents: b.promoDiscountCents,
    mileageCents: b.mileageCents,
    lodgingCents: b.lodgingCents,
    totalCents: clinicTotalCents(b),
  };
}

/** What a doctor may see: never the clinic price, discount or margin. */
export function doctorView(b: PriceBreakdown) {
  return {
    payCents: b.doctorPayCents,
    mileageCents: b.mileageCents,
    lodgingCents: b.lodgingCents,
    totalCents: doctorTotalCents(b),
  };
}

export function depositCents(clinicTotal: number, depositPercent: number): number {
  return Math.round((clinicTotal * depositPercent) / 100);
}

export function round2(n: number): number {
  return Math.round(n * 100) / 100;
}

export function formatCents(cents: number): string {
  const sign = cents < 0 ? "-" : "";
  const abs = Math.abs(cents);
  return `${sign}$${(abs / 100).toLocaleString("en-US", { minimumFractionDigits: abs % 100 === 0 ? 0 : 2, maximumFractionDigits: 2 })}`;
}
