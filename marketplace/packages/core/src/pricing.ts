import type { SettingsMap } from "@cm/config";
import { isFederalHoliday } from "./holidays";
import { hoursBetween, localParts } from "./time";

/**
 * Rate engine (SPEC §8 as revised by Addendum 01 §8, INV-7). Clinics and
 * providers never set prices; every number shown or charged comes out of
 * these functions. Rate cards are keyed on profession × region × tier.
 */

export type PricingModel = "TIERED" | "HOURLY";
export type DurationTier = "HALF_DAY" | "FULL_DAY" | "HOURLY";
export type PremiumKind = "URGENT" | "RUSH" | "WEEKEND" | "HOLIDAY" | "BOOST";

/** TIERED: flat price per tier. HOURLY: per-hour rates with a billable minimum. */
export interface RateCardFacts {
  clinicPriceCents: number;
  providerPayCents: number;
  minHours?: number | null;
}

export interface AppliedPremium {
  kind: PremiumKind;
  percent: number;
}

export interface BaseQuote {
  pricingModel: PricingModel;
  tier: DurationTier;
  hours: number;
  /** TIERED: hours beyond 8. HOURLY: always 0. */
  overtimeHours: number;
  /** HOURLY: max(hours, minHours). TIERED: equals hours. */
  billableHours: number;
  premiums: AppliedPremium[];
  clinicPriceCents: number;
  providerPayCents: number;
  marginCents: number;
}

export function durationTier(hours: number): { tier: Exclude<DurationTier, "HOURLY">; overtimeHours: number } {
  if (hours <= 0) throw new Error("Shift must have positive length");
  if (hours < 4) return { tier: "HALF_DAY", overtimeHours: 0 };
  return { tier: "FULL_DAY", overtimeHours: Math.max(0, round2(hours - 8)) };
}

/** Which rate card tier a shift needs under a pricing model. */
export function tierFor(model: PricingModel, hours: number): DurationTier {
  return model === "HOURLY" ? "HOURLY" : durationTier(hours).tier;
}

export interface PremiumInput {
  startsAt: Date;
  /** When the price was set (posting time). Drives the urgent premium. */
  pricedAt: Date;
  timeZone: string;
  boosted: boolean;
  professionCode?: string;
}

type PricingSettings = Pick<
  SettingsMap,
  | "pricing.overtimeClinicCentsPerHour"
  | "pricing.overtimeProviderCentsPerHour"
  | "pricing.premiumUrgentPercent"
  | "pricing.premiumRushPercent"
  | "pricing.rushWithinHours"
  | "pricing.premiumWeekendPercent"
  | "pricing.premiumHolidayPercent"
  | "pricing.boostPercent"
  | "pricing.hourlyMinHours"
  | "pricing.premiumOverridesByProfession"
>;

export function applicablePremiums(input: PremiumInput, s: PricingSettings): AppliedPremium[] {
  const o = (input.professionCode && s["pricing.premiumOverridesByProfession"][input.professionCode]) || {};
  const out: AppliedPremium[] = [];
  // Short notice: RUSH (posted within pricing.rushWithinHours) replaces URGENT (< 48h); they never stack.
  const notice = hoursBetween(input.pricedAt, input.startsAt);
  const rush = o.rush ?? s["pricing.premiumRushPercent"];
  if (notice < s["pricing.rushWithinHours"] && rush > 0) out.push({ kind: "RUSH", percent: rush });
  else if (notice < 48) out.push({ kind: "URGENT", percent: o.urgent ?? s["pricing.premiumUrgentPercent"] });
  const local = localParts(input.startsAt, input.timeZone);
  if (local.weekday === 0 || local.weekday === 6) out.push({ kind: "WEEKEND", percent: o.weekend ?? s["pricing.premiumWeekendPercent"] });
  if (isFederalHoliday(local.isoDate)) out.push({ kind: "HOLIDAY", percent: o.holiday ?? s["pricing.premiumHolidayPercent"] });
  if (input.boosted) out.push({ kind: "BOOST", percent: o.boost ?? s["pricing.boostPercent"] });
  return out.filter((p) => p.percent > 0);
}

export function premiumMultiplier(premiums: AppliedPremium[]): number {
  return premiums.reduce((m, p) => m * (1 + p.percent / 100), 1);
}

export function quoteBase(
  shift: { startsAt: Date; endsAt: Date },
  pricingModel: PricingModel,
  card: RateCardFacts,
  premiumInput: Omit<PremiumInput, "startsAt">,
  s: PricingSettings,
): BaseQuote {
  const hours = round2(hoursBetween(shift.startsAt, shift.endsAt));
  let tier: DurationTier;
  let overtimeHours = 0;
  let billableHours = hours;
  let baseClinic: number;
  let baseProvider: number;
  if (pricingModel === "HOURLY") {
    if (hours <= 0) throw new Error("Shift must have positive length");
    tier = "HOURLY";
    billableHours = Math.max(hours, card.minHours ?? s["pricing.hourlyMinHours"]);
    baseClinic = Math.round(billableHours * card.clinicPriceCents);
    baseProvider = Math.round(billableHours * card.providerPayCents);
  } else {
    ({ tier, overtimeHours } = durationTier(hours));
    baseClinic = card.clinicPriceCents + Math.round(overtimeHours * s["pricing.overtimeClinicCentsPerHour"]);
    baseProvider = card.providerPayCents + Math.round(overtimeHours * s["pricing.overtimeProviderCentsPerHour"]);
  }
  const premiums = applicablePremiums({ ...premiumInput, startsAt: shift.startsAt }, s);
  const mult = premiumMultiplier(premiums);
  const clinicPriceCents = Math.round(baseClinic * mult);
  const providerPayCents = Math.round(baseProvider * mult);
  return { pricingModel, tier, hours, overtimeHours, billableHours, premiums, clinicPriceCents, providerPayCents, marginCents: clinicPriceCents - providerPayCents };
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
  providerPayCents: number;
  promoDiscountCents: number;
  mileageCents: number;
  lodgingCents: number;
}

export function clinicTotalCents(b: PriceBreakdown): number {
  return b.clinicPriceCents - b.promoDiscountCents + b.mileageCents + b.lodgingCents;
}

export function providerTotalCents(b: PriceBreakdown): number {
  return b.providerPayCents + b.mileageCents + b.lodgingCents;
}

export function platformMarginCents(b: PriceBreakdown): number {
  return b.clinicPriceCents - b.promoDiscountCents - b.providerPayCents;
}

/** What a clinic may see: never provider pay. */
export function clinicView(b: PriceBreakdown) {
  return {
    coverageCents: b.clinicPriceCents,
    discountCents: b.promoDiscountCents,
    mileageCents: b.mileageCents,
    lodgingCents: b.lodgingCents,
    totalCents: clinicTotalCents(b),
  };
}

/** What a provider may see: never the clinic price, discount or margin. */
export function providerView(b: PriceBreakdown) {
  return {
    payCents: b.providerPayCents,
    mileageCents: b.mileageCents,
    lodgingCents: b.lodgingCents,
    totalCents: providerTotalCents(b),
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
