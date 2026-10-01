import { z } from "zod";

/**
 * Admin-editable settings (SPEC §0: every OWNER DECISION is a setting, never
 * hard-coded). Each entry has a schema, a seed default and a flag saying why
 * it exists, so the admin Settings screen can list the open decisions.
 *
 * Money is always integer cents. Percentages are whole-number percents.
 */

const weightsSchema = z
  .object({
    drive: z.number().min(0).max(1),
    skills: z.number().min(0).max(1),
    reliability: z.number().min(0).max(1),
    rating: z.number().min(0).max(1),
    relationship: z.number().min(0).max(1),
    newProvider: z.number().min(0).max(1),
  })
  .refine((w) => Math.abs(Object.values(w).reduce((a, b) => a + b, 0) - 1) < 1e-9, {
    message: "Weights must sum to 1.0",
  });

const deadlineTierSchema = z.object({
  minLeadHours: z.number().min(0),
  selectionWindowHours: z.number().positive(),
  offerWindowMinutes: z.number().int().positive(),
  parallelOffers: z.number().int().min(1),
});

const tierConfigSchema = z.object({
  wave1: z.number().int().min(1),
  growth: z.number().int().min(0),
  max: z.number().int().min(1),
  windowMin: z.number().positive(),
  wavesBeforeBroadcast: z.number().int().min(1),
  broadcastWindowMin: z.number().positive(),
  broadcastHoldMin: z.number().positive(),
  beta: z.number().min(0).max(1),
});
export type TierConfig = z.infer<typeof tierConfigSchema>;

const cents = z.number().int().min(0);
/** "HH:MM", 24-hour. */
const localTime = z.string().regex(/^([01]\d|2[0-3]):[0-5]\d$/, "Use 24-hour HH:MM, e.g. 05:30");
const percent = z.number().min(0).max(100);

type Flag = "OWNER_DECISION" | "ATTORNEY_REVIEW" | null;

interface SettingDef<S extends z.ZodTypeAny> {
  group: string;
  label: string;
  help?: string;
  schema: S;
  default: z.infer<S>;
  flag: Flag;
}

function def<S extends z.ZodTypeAny>(d: SettingDef<S>): SettingDef<S> {
  return d;
}

export const SETTINGS = {
  // ---------- matching (§7) ----------
  "matching.weights": def({
    group: "Matching",
    label: "Score weights",
    help: "Must sum to 1.0.",
    schema: weightsSchema,
    default: { drive: 0.25, skills: 0.2, reliability: 0.2, rating: 0.15, relationship: 0.15, newProvider: 0.05 },
    flag: null,
  }),
  "matching.weightsByProfession": def({
    group: "Matching",
    label: "Per-profession score weights",
    help: "Optional overrides keyed by profession code, e.g. {\"LMT\": {...}}. Each must sum to 1.0; missing professions use the default weights.",
    schema: z.record(z.string(), weightsSchema),
    default: {},
    flag: null,
  }),
  "matching.maxDriveMinutes": def({ group: "Matching", label: "Platform max one-way drive (minutes)", schema: z.number().int().positive(), default: 180, flag: null }),
  "matching.travelBufferExtraMinutes": def({ group: "Matching", label: "Travel buffer added to drive time (minutes)", schema: z.number().int().min(0), default: 30, flag: null }),
  "matching.favoritesWindowHours": def({ group: "Matching", label: "Favorites-only window (hours)", schema: z.number().positive(), default: 2, flag: null }),
  "matching.instantBookMinScore": def({ group: "Matching", label: "Instant-book minimum score", schema: z.number().min(0).max(1), default: 0.55, flag: null }),
  "matching.autoSelectMinScore": def({ group: "Matching", label: "Auto-select minimum score", schema: z.number().min(0).max(1), default: 0.45, flag: null }),
  "matching.notifyTopN": def({ group: "Matching", label: "Top candidates notified on posting", schema: z.number().int().min(0), default: 15, flag: null }),
  "matching.deadlineTiers": def({
    group: "Matching",
    label: "Selection deadline tiers",
    help: "Ordered from longest lead time to shortest.",
    schema: z.array(deadlineTierSchema).min(1),
    default: [
      { minLeadHours: 168, selectionWindowHours: 24, offerWindowMinutes: 240, parallelOffers: 1 },
      { minLeadHours: 48, selectionWindowHours: 6, offerWindowMinutes: 120, parallelOffers: 1 },
      { minLeadHours: 0, selectionWindowHours: 1, offerWindowMinutes: 30, parallelOffers: 3 },
    ],
    flag: null,
  }),

  // ---------- pricing (§8) ----------
  "pricing.overtimeClinicCentsPerHour": def({ group: "Pricing", label: "Overtime clinic price per hour beyond 8h", schema: cents, default: 10000, flag: null }),
  "pricing.overtimeProviderCentsPerHour": def({ group: "Pricing", label: "Overtime provider pay per hour beyond 8h", schema: cents, default: 7000, flag: "OWNER_DECISION" }),
  "pricing.mileageRateCentsPerMile": def({ group: "Pricing", label: "Mileage rate (cents per mile)", schema: cents, default: 20, flag: "OWNER_DECISION" }),
  "pricing.mileageRoundTrip": def({ group: "Pricing", label: "Mileage is round-trip (off = one-way)", schema: z.boolean(), default: false, flag: "OWNER_DECISION" }),
  "pricing.hourlyMinHours": def({ group: "Pricing", label: "Minimum billable hours for hourly professions", schema: z.number().positive(), default: 2, flag: "OWNER_DECISION" }),
  "pricing.premiumOverridesByProfession": def({
    group: "Pricing",
    label: "Per-profession premium % overrides",
    help: "e.g. {\"LMT\": {\"weekend\": 5}}. Keys: urgent, weekend, holiday, boost.",
    schema: z.record(z.string(), z.object({ urgent: percent.optional(), weekend: percent.optional(), holiday: percent.optional(), boost: percent.optional() })),
    default: {},
    flag: "OWNER_DECISION",
  }),
  "pricing.lodgingTriggerMinutes": def({ group: "Pricing", label: "Lodging eligible above one-way drive (minutes)", schema: z.number().int().positive(), default: 120, flag: null }),
  "pricing.premiumUrgentPercent": def({ group: "Pricing", label: "Urgent premium (<48h at posting) %", schema: percent, default: 15, flag: "OWNER_DECISION" }),
  "pricing.premiumWeekendPercent": def({ group: "Pricing", label: "Weekend premium %", schema: percent, default: 10, flag: "OWNER_DECISION" }),
  "pricing.premiumHolidayPercent": def({ group: "Pricing", label: "Federal holiday premium %", schema: percent, default: 25, flag: "OWNER_DECISION" }),
  "pricing.boostPercent": def({ group: "Pricing", label: "Clinic urgent boost %", schema: percent, default: 15, flag: "OWNER_DECISION" }),

  // ---------- payments (§9) ----------
  "payments.depositPercent": def({ group: "Payments", label: "Deposit charged at confirmation %", schema: percent, default: 10, flag: null }),
  "payments.autoCompleteHours": def({ group: "Payments", label: "Auto-complete after shift end (hours)", schema: z.number().min(0), default: 2, flag: null }),
  "payments.payoutHoldHours": def({ group: "Payments", label: "Provider payout hold after completion (hours)", schema: z.number().min(0), default: 48, flag: null }),
  "payments.clinicFreeCancelHours": def({ group: "Payments", label: "Clinic free-cancel cutoff before start (hours)", schema: z.number().min(0), default: 48, flag: null }),
  "payments.lateCancelProviderSharePercent": def({ group: "Payments", label: "Provider share of forfeited late-cancel deposit %", schema: percent, default: 50, flag: "OWNER_DECISION" }),
  "payments.providerLateCancelHours": def({ group: "Payments", label: "Provider cancel counts as late within (hours)", schema: z.number().min(0), default: 72, flag: null }),
  "payments.paymentFixWindowHours": def({ group: "Payments", label: "Time for clinic to fix a failed deposit (hours)", schema: z.number().positive(), default: 12, flag: null }),
  "payments.paymentFixWindowUrgentHours": def({ group: "Payments", label: "Failed deposit fix window, urgent shifts (hours)", schema: z.number().positive(), default: 1, flag: null }),
  "payments.disputeWindowHours": def({ group: "Payments", label: "Dispute window after shift end (hours)", schema: z.number().positive(), default: 48, flag: null }),
  "payments.conversionFeeCents": def({ group: "Payments", label: "Conversion fee", schema: cents, default: 0, flag: "ATTORNEY_REVIEW" }),
  "payments.conversionWindowMonths": def({ group: "Payments", label: "Conversion fee window (months)", schema: z.number().int().positive(), default: 12, flag: "ATTORNEY_REVIEW" }),

  // ---------- states (§14) ----------
  "states.minVerifiedDoctorsWarning": def({ group: "States", label: "Warn when enabling a state with fewer verified doctors than", schema: z.number().int().min(0), default: 10, flag: null }),

  // ---------- promo codes ----------
  "promo.maxShareOfMarginPercent": def({
    group: "Promo codes",
    label: "Max discount as % of platform margin",
    help: "Promo discounts come out of the platform margin and never reduce doctor pay or pass-through travel.",
    schema: percent,
    default: 100,
    flag: "OWNER_DECISION",
  }),
  "promo.welcomeOfferPercent": def({ group: "Promo codes", label: "Clinic welcome offer % off first shift", schema: percent, default: 10, flag: "OWNER_DECISION" }),
  "promo.welcomeOfferDays": def({ group: "Promo codes", label: "Welcome / campaign code lifetime (days)", schema: z.number().int().positive(), default: 90, flag: null }),

  // ---------- leads ----------
  "leads.dripScheduleDays": def({
    group: "Leads",
    label: "Follow-up email schedule (days after signup)",
    help: "One entry per email in the sequence; the first is sent immediately.",
    schema: z.array(z.number().int().min(0)).min(1).max(10),
    default: [0, 3, 10, 30, 75],
    flag: null,
  }),

  // ---------- provider booking emails ----------
  "digests.daily": def({
    group: "Provider emails",
    label: "Daily bookings email (provider's local time)",
    help: "Sent only on days with bookings, with directions to each one.",
    schema: z.object({ enabled: z.boolean(), time: localTime }),
    default: { enabled: true, time: "05:30" },
    flag: null,
  }),
  "digests.weekly": def({
    group: "Provider emails",
    label: "Weekly bookings email for the coming Monday–Sunday",
    help: "weekday: 1 = Monday … 7 = Sunday. Sent only when the coming week has bookings.",
    schema: z.object({ enabled: z.boolean(), weekday: z.number().int().min(1).max(7), time: localTime }),
    default: { enabled: true, weekday: 7, time: "19:00" },
    flag: null,
  }),

  // ---------- shift reconfirmation + day-of check-in ----------
  "reconfirm.enabled": def({ group: "Shift reconfirmation", label: "Ask providers to reconfirm upcoming shifts", schema: z.boolean(), default: true, flag: null }),
  "reconfirm.askBeforeHours": def({ group: "Shift reconfirmation", label: "Ask the provider to reconfirm this long before the start", schema: z.number().int().min(2).max(336), default: 48, flag: null }),
  "reconfirm.reminderAfterHours": def({ group: "Shift reconfirmation", label: "Send one reminder this long after the ask", schema: z.number().int().min(1).max(72), default: 6, flag: null }),
  "reconfirm.deadlineBeforeHours": def({
    group: "Shift reconfirmation",
    label: "Deadline to reconfirm, before the start",
    help: "Unconfirmed at the deadline → released (counts as a late cancel), shift reopened as urgent, clinic told.",
    schema: z.number().int().min(1).max(168),
    default: 24,
    flag: null,
  }),
  "reconfirm.skipIfBookedWithinHours": def({ group: "Shift reconfirmation", label: "Skip reconfirmation when booked this close to the start", schema: z.number().int().min(0).max(336), default: 72, flag: null }),
  "reconfirm.missesBeforePause": def({ group: "Shift reconfirmation", label: "Missed reconfirmations that pause a provider", schema: z.number().int().min(1).max(10), default: 2, flag: null }),
  "reconfirm.missWindowDays": def({ group: "Shift reconfirmation", label: "…counted over this many days", schema: z.number().int().min(7).max(365), default: 90, flag: null }),
  "checkin.promptBeforeHours": def({ group: "Shift reconfirmation", label: "Day-of 'On my way' prompt, before the start", schema: z.number().min(0.5).max(12), default: 2, flag: null }),
  "checkin.alertBeforeMinutes": def({ group: "Shift reconfirmation", label: "Alert you and the clinic if not 'On my way' by this long before the start", schema: z.number().int().min(0).max(240), default: 30, flag: null }),

  // ---------- emergency cover ----------
  "emergency.triggerWithinHours": def({ group: "Emergency cover", label: "A provider cancelling this close to the start triggers emergency cover", schema: z.number().int().min(0).max(168), default: 24, flag: null }),
  "emergency.bonusStepsPercent": def({
    group: "Emergency cover",
    label: "Rescue bonus steps (% of provider pay, from your margin)",
    help: "The first step is offered right away; each later step when nobody has accepted.",
    schema: z.array(z.number().int().min(0).max(100)).min(1).max(6),
    default: [10, 15, 20],
    flag: "OWNER_DECISION",
  }),
  "emergency.stepMinutes": def({ group: "Emergency cover", label: "Minutes before raising the bonus and re-texting everyone", schema: z.number().int().min(3).max(120), default: 10, flag: null }),
  "emergency.driveMultiplier": def({ group: "Emergency cover", label: "Drive radius in an emergency (× each provider's usual max)", schema: z.number().min(1).max(3), default: 1.5, flag: null }),
  "emergency.replacementLeadMinutes": def({ group: "Emergency cover", label: "After a no-show, the replacement starts this long from now", schema: z.number().int().min(15).max(240), default: 60, flag: null }),
  "emergency.minRemainingMinutes": def({ group: "Emergency cover", label: "Don't send a replacement if less than this much of the shift is left", schema: z.number().int().min(30).max(480), default: 90, flag: null }),

  // ---------- Smart Dispatch (Addendum 02 §11) ----------
  "dispatch.tiers.SAME_DAY": def({ group: "Dispatch", label: "Same-day (<12h) waves", schema: tierConfigSchema, default: { wave1: 5, growth: 3, max: 15, windowMin: 5, wavesBeforeBroadcast: 3, broadcastWindowMin: 15, broadcastHoldMin: 3, beta: 0.6 }, flag: "OWNER_DECISION" }),
  "dispatch.tiers.SHORT": def({ group: "Dispatch", label: "Short notice (12–48h) waves", schema: tierConfigSchema, default: { wave1: 3, growth: 2, max: 10, windowMin: 15, wavesBeforeBroadcast: 3, broadcastWindowMin: 30, broadcastHoldMin: 10, beta: 0.4 }, flag: null }),
  "dispatch.tiers.NEAR": def({ group: "Dispatch", label: "Near (2–7 days) waves", schema: tierConfigSchema, default: { wave1: 3, growth: 2, max: 8, windowMin: 90, wavesBeforeBroadcast: 4, broadcastWindowMin: 240, broadcastHoldMin: 30, beta: 0.2 }, flag: null }),
  "dispatch.tiers.PLANNED": def({ group: "Dispatch", label: "Planned (7+ days) waves", schema: tierConfigSchema, default: { wave1: 3, growth: 2, max: 8, windowMin: 120, wavesBeforeBroadcast: 4, broadcastWindowMin: 360, broadcastHoldMin: 60, beta: 0.2 }, flag: null }),
  "dispatch.tierOverridesByProfession": def({
    group: "Dispatch",
    label: "Per-profession wave overrides",
    help: 'e.g. {"LMT": {"SAME_DAY": {"windowMin": 10}}}',
    schema: z.record(z.string(), z.record(z.string(), tierConfigSchema.partial())),
    default: {},
    flag: null,
  }),
  "dispatch.arrivalBufferMinutes": def({ group: "Dispatch", label: "Arrival buffer before shift start (minutes)", schema: z.number().int().min(0), default: 15, flag: null }),
  "dispatch.minWindowMinutes": def({ group: "Dispatch", label: "Shortest allowed accept window (minutes)", schema: z.number().positive(), default: 3, flag: null }),
  "dispatch.maxOffersPerProviderPerDay": def({ group: "Dispatch", label: "Max offers per provider per day", schema: z.number().int().min(1), default: 8, flag: "OWNER_DECISION" }),
  "dispatch.maxConcurrentPendingOffers": def({ group: "Dispatch", label: "Max concurrent pending offers per provider", schema: z.number().int().min(1), default: 3, flag: null }),
  "dispatch.autoSnoozeAfterIgnored": def({ group: "Dispatch", label: "Auto-snooze after this many ignored offers in a row", schema: z.number().int().min(1), default: 5, flag: null }),
  "dispatch.standbyCourtesyBoost": def({ group: "Dispatch", label: "Standby courtesy boost to dispatch score", schema: z.number().min(0).max(0.5), default: 0.02, flag: "OWNER_DECISION" }),
  "dispatch.standbyCourtesyDays": def({ group: "Dispatch", label: "Standby courtesy boost lasts (days)", schema: z.number().int().min(0), default: 7, flag: null }),
  "dispatch.standbyWindowMin": def({ group: "Dispatch", label: "Standby offer window (minutes)", schema: z.object({ SAME_DAY: z.number().positive(), other: z.number().positive() }), default: { SAME_DAY: 5, other: 15 }, flag: null }),
  "oncall.graceMinutes": def({ group: "On Call", label: "No-penalty cancel grace after auto-accept (minutes)", schema: z.number().int().min(0), default: 10, flag: "OWNER_DECISION" }),
  "oncall.maxGraceCancels30d": def({ group: "On Call", label: "Grace cancels in 30 days before On Call auto-pauses", schema: z.number().int().min(0), default: 2, flag: null }),
  "oncall.minReliability": def({ group: "On Call", label: "Minimum reliability to use On Call", schema: z.number().min(0).max(1), default: 0.85, flag: null }),
  "oncall.minCompletedShifts": def({ group: "On Call", label: "Minimum completed shifts to use On Call", schema: z.number().int().min(0), default: 1, flag: "OWNER_DECISION" }),
  "responsiveness.lookbackDays": def({ group: "Dispatch", label: "Responsiveness lookback (days)", schema: z.number().int().positive(), default: 90, flag: null }),
  "responsiveness.prior": def({ group: "Dispatch", label: "Responsiveness Beta prior", schema: z.object({ a: z.number().positive(), b: z.number().positive() }), default: { a: 2, b: 2 }, flag: null }),

  // ---------- profiles ----------
  "profiles.linkedinVisibility": def({
    group: "Profiles",
    label: "When clinics can see a provider's LinkedIn link",
    help: "after_confirmation keeps profiles anonymized to name + city/state until a shift is confirmed (SPEC §10.1); always shows it on every profile.",
    schema: z.enum(["after_confirmation", "always"]),
    default: "after_confirmation",
    flag: "OWNER_DECISION",
  }),

  // ---------- ratings (§12) ----------
  "ratings.windowDays": def({ group: "Ratings", label: "Rating window (days)", schema: z.number().int().positive(), default: 14, flag: null }),

  // ---------- standing bookings ----------
  "standing.horizonWeeks": def({ group: "Standing bookings", label: "Book standing shifts this many weeks ahead", schema: z.number().int().min(1).max(12), default: 4, flag: null }),
  "standing.endNoticeDays": def({
    group: "Standing bookings",
    label: "Notice when either side ends a standing booking (days)",
    help: "Shifts inside the notice period stay booked; later ones are cancelled at no charge.",
    schema: z.number().int().min(0).max(60),
    default: 14,
    flag: "OWNER_DECISION",
  }),

  // ---------- direct hire (placement) ----------
  "placement.defaultFeeCents": def({
    group: "Direct hire",
    label: "Suggested placement fee when a clinic hires a provider directly",
    help: "Pre-filled on each quote; you can change it per request before sending the payment link.",
    schema: cents,
    default: 500_000,
    flag: "OWNER_DECISION",
  }),

  // ---------- agreements (in-house e-signature) ----------
  "agreements.companyLegalName": def({ group: "Agreements", label: "Company legal name shown in the agreements", schema: z.string().min(2).max(200), default: "CoverageOnCall LLC", flag: "ATTORNEY_REVIEW" }),
  "agreements.companyAddress": def({ group: "Agreements", label: "Company mailing address for legal notices", schema: z.string().max(300), default: "", flag: "ATTORNEY_REVIEW" }),
  "agreements.governingState": def({ group: "Agreements", label: "Governing law (state)", schema: z.string().min(2).max(60), default: "Florida", flag: "ATTORNEY_REVIEW" }),
  "agreements.nonCircumventionMonths": def({
    group: "Agreements",
    label: "Non-circumvention lasts this long after the last shift together",
    help: "Clinics and providers introduced on the platform may only work together through the platform (including standing bookings) during this period.",
    schema: z.number().int().min(0).max(36),
    default: 12,
    flag: "ATTORNEY_REVIEW",
  }),
  "agreements.liquidatedDamagesCents": def({
    group: "Agreements",
    label: "Liquidated damages per circumvention breach",
    help: "The pre-agreed amount owed when a clinic engages a platform provider directly (or a provider a platform clinic) during the non-circumvention period.",
    schema: cents,
    default: 1_000_000,
    flag: "ATTORNEY_REVIEW",
  }),

  // ---------- feature flags (ATTORNEY REVIEW items ship OFF) ----------
  "features.onCallEnabled": def({ group: "Features", label: "On Call auto-accept (requires On Call Terms in the Provider Agreement)", schema: z.boolean(), default: false, flag: "ATTORNEY_REVIEW" }),
  "features.conversionFeeEnabled": def({ group: "Features", label: "Allow charging conversion fees", schema: z.boolean(), default: false, flag: "ATTORNEY_REVIEW" }),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]["schema"]>;
export type SettingsMap = { [K in SettingKey]: SettingValue<K> };
export type MatchingWeights = SettingValue<"matching.weights">;
export type DeadlineTier = SettingValue<"matching.deadlineTiers">[number];

export function weightsFor(s: SettingsMap, professionCode: string): MatchingWeights {
  return s["matching.weightsByProfession"][professionCode] ?? s["matching.weights"];
}

export type UrgencyTierKey = "SAME_DAY" | "SHORT" | "NEAR" | "PLANNED";

/** Tier config with any per-profession override applied (Addendum 02 §11). */
export function tierConfigFor(s: SettingsMap, tier: UrgencyTierKey, professionCode?: string): TierConfig {
  const base = s[`dispatch.tiers.${tier}` as const];
  const o = professionCode ? s["dispatch.tierOverridesByProfession"][professionCode]?.[tier] : undefined;
  return { ...base, ...(o ?? {}) };
}

export function defaultSettings(): SettingsMap {
  const out = {} as Record<string, unknown>;
  for (const [k, d] of Object.entries(SETTINGS)) out[k] = structuredClone(d.default);
  return out as SettingsMap;
}

/** Merge stored rows over defaults; invalid stored values fall back to the default. */
export function resolveSettings(stored: Record<string, unknown>): SettingsMap {
  const out = defaultSettings() as Record<string, unknown>;
  for (const [k, v] of Object.entries(stored)) {
    const d = (SETTINGS as Record<string, SettingDef<z.ZodTypeAny>>)[k];
    if (!d) continue;
    const parsed = d.schema.safeParse(v);
    if (parsed.success) out[k] = parsed.data;
  }
  return out as SettingsMap;
}

export function validateSetting(key: string, value: unknown): { ok: true; value: unknown } | { ok: false; error: string } {
  const d = (SETTINGS as Record<string, SettingDef<z.ZodTypeAny>>)[key];
  if (!d) return { ok: false, error: `Unknown setting ${key}` };
  const parsed = d.schema.safeParse(value);
  if (!parsed.success) return { ok: false, error: parsed.error.issues.map((i) => i.message).join("; ") };
  return { ok: true, value: parsed.data };
}
