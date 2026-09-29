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
    technique: z.number().min(0).max(1),
    reliability: z.number().min(0).max(1),
    rating: z.number().min(0).max(1),
    relationship: z.number().min(0).max(1),
    newDoctor: z.number().min(0).max(1),
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

const cents = z.number().int().min(0);
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
    default: { drive: 0.25, technique: 0.2, reliability: 0.2, rating: 0.15, relationship: 0.15, newDoctor: 0.05 },
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
  "pricing.overtimeDoctorCentsPerHour": def({ group: "Pricing", label: "Overtime doctor pay per hour beyond 8h", schema: cents, default: 7000, flag: "OWNER_DECISION" }),
  "pricing.mileageRateCentsPerMile": def({ group: "Pricing", label: "Mileage rate (cents per mile)", schema: cents, default: 20, flag: "OWNER_DECISION" }),
  "pricing.mileageRoundTrip": def({ group: "Pricing", label: "Mileage is round-trip (off = one-way)", schema: z.boolean(), default: false, flag: "OWNER_DECISION" }),
  "pricing.lodgingTriggerMinutes": def({ group: "Pricing", label: "Lodging eligible above one-way drive (minutes)", schema: z.number().int().positive(), default: 120, flag: null }),
  "pricing.premiumUrgentPercent": def({ group: "Pricing", label: "Urgent premium (<48h at posting) %", schema: percent, default: 15, flag: "OWNER_DECISION" }),
  "pricing.premiumWeekendPercent": def({ group: "Pricing", label: "Weekend premium %", schema: percent, default: 10, flag: "OWNER_DECISION" }),
  "pricing.premiumHolidayPercent": def({ group: "Pricing", label: "Federal holiday premium %", schema: percent, default: 25, flag: "OWNER_DECISION" }),
  "pricing.boostPercent": def({ group: "Pricing", label: "Clinic urgent boost %", schema: percent, default: 15, flag: "OWNER_DECISION" }),

  // ---------- payments (§9) ----------
  "payments.depositPercent": def({ group: "Payments", label: "Deposit charged at confirmation %", schema: percent, default: 10, flag: null }),
  "payments.autoCompleteHours": def({ group: "Payments", label: "Auto-complete after shift end (hours)", schema: z.number().min(0), default: 2, flag: null }),
  "payments.payoutHoldHours": def({ group: "Payments", label: "Doctor payout hold after completion (hours)", schema: z.number().min(0), default: 48, flag: null }),
  "payments.clinicFreeCancelHours": def({ group: "Payments", label: "Clinic free-cancel cutoff before start (hours)", schema: z.number().min(0), default: 48, flag: null }),
  "payments.lateCancelDoctorSharePercent": def({ group: "Payments", label: "Doctor share of forfeited late-cancel deposit %", schema: percent, default: 50, flag: "OWNER_DECISION" }),
  "payments.doctorLateCancelHours": def({ group: "Payments", label: "Doctor cancel counts as late within (hours)", schema: z.number().min(0), default: 72, flag: null }),
  "payments.paymentFixWindowHours": def({ group: "Payments", label: "Time for clinic to fix a failed deposit (hours)", schema: z.number().positive(), default: 12, flag: null }),
  "payments.paymentFixWindowUrgentHours": def({ group: "Payments", label: "Failed deposit fix window, urgent shifts (hours)", schema: z.number().positive(), default: 1, flag: null }),
  "payments.disputeWindowHours": def({ group: "Payments", label: "Dispute window after shift end (hours)", schema: z.number().positive(), default: 48, flag: null }),
  "payments.conversionFeeCents": def({ group: "Payments", label: "Conversion fee", schema: cents, default: 0, flag: "ATTORNEY_REVIEW" }),
  "payments.conversionWindowMonths": def({ group: "Payments", label: "Conversion fee window (months)", schema: z.number().int().positive(), default: 12, flag: "ATTORNEY_REVIEW" }),

  // ---------- credentials (§4) ----------
  "credentials.minMalpracticePerOccurrenceCents": def({ group: "Credentials", label: "Minimum malpractice per-occurrence limit", schema: cents, default: 100_000_000, flag: "OWNER_DECISION" }),
  "credentials.minMalpracticeAggregateCents": def({ group: "Credentials", label: "Minimum malpractice aggregate limit", schema: cents, default: 300_000_000, flag: "OWNER_DECISION" }),

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

  // ---------- ratings (§12) ----------
  "ratings.windowDays": def({ group: "Ratings", label: "Rating window (days)", schema: z.number().int().positive(), default: 14, flag: null }),

  // ---------- feature flags (ATTORNEY REVIEW items ship OFF) ----------
  "features.conversionFeeEnabled": def({ group: "Features", label: "Allow charging conversion fees", schema: z.boolean(), default: false, flag: "ATTORNEY_REVIEW" }),
} as const;

export type SettingKey = keyof typeof SETTINGS;
export type SettingValue<K extends SettingKey> = z.infer<(typeof SETTINGS)[K]["schema"]>;
export type SettingsMap = { [K in SettingKey]: SettingValue<K> };
export type MatchingWeights = SettingValue<"matching.weights">;
export type DeadlineTier = SettingValue<"matching.deadlineTiers">[number];

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
