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
    help: "e.g. {\"LMT\": {\"weekend\": 5}}. Keys: urgent, rush, weekend, holiday, boost.",
    schema: z.record(z.string(), z.object({ urgent: percent.optional(), rush: percent.optional(), weekend: percent.optional(), holiday: percent.optional(), boost: percent.optional() })),
    default: {},
    flag: "OWNER_DECISION",
  }),
  "pricing.lodgingNightlyCents": def({ group: "Pricing", label: "Lodging allowance per night", help: "Flat amount per night, no receipts. Added to the clinic's total and the provider's pay when a provider needs to stay over. Each shift keeps the amount in force when it was posted.", schema: cents, default: 11500, flag: "OWNER_DECISION" }),
  "pricing.lodgingMaxDriveMinutes": def({ group: "Pricing", label: "Furthest one-way drive for providers taking lodging (minutes)", help: "With lodging on, providers who'll stay overnight can be offered shifts beyond their own drive limit, up to this.", schema: z.number().int().min(30).max(720), default: 240, flag: "OWNER_DECISION" }),
  "pricing.lodgingTriggerMinutes": def({ group: "Pricing", label: "Lodging eligible above one-way drive (minutes)", schema: z.number().int().positive(), default: 120, flag: null }),
  "pricing.premiumUrgentPercent": def({ group: "Pricing", label: "Urgent premium (<48h at posting) %", schema: percent, default: 15, flag: "OWNER_DECISION" }),
  "pricing.premiumRushPercent": def({ group: "Pricing", label: "Rush premium % (posted within the rush window)", help: "Replaces the urgent premium for the shortest notice; like every premium it raises the clinic price and the provider's pay by the same percent, so short-notice shifts fill. 0 = off.", schema: percent, default: 25, flag: "OWNER_DECISION" }),
  "pricing.rushWithinHours": def({ group: "Pricing", label: "Rush window (hours between posting and the shift start)", schema: z.number().int().min(1).max(47), default: 24, flag: "OWNER_DECISION" }),
  "pricing.premiumWeekendPercent": def({ group: "Pricing", label: "Weekend premium %", schema: percent, default: 10, flag: "OWNER_DECISION" }),
  "pricing.premiumHolidayPercent": def({ group: "Pricing", label: "Federal holiday premium %", schema: percent, default: 25, flag: "OWNER_DECISION" }),
  "pricing.boostPercent": def({ group: "Pricing", label: "Clinic urgent boost %", schema: percent, default: 15, flag: "OWNER_DECISION" }),
  // Volume pricing (Addendum 03): the clinic's expected visits pick Light or Busy; visits past the
  // booked tier's limit + grace are billed per visit. Each shift keeps the terms in force when posted.
  "pricing.volumeLightVisitsFullDay": def({ group: "Pricing", label: "Light day: visits included (full day)", help: "Expected visits up to this number are priced as a Light day; more = Busy.", schema: z.number().int().min(1).max(200), default: 12, flag: "OWNER_DECISION" }),
  "pricing.volumeBusyVisitsFullDay": def({ group: "Pricing", label: "Busy day: visits included (full day)", help: "Must be higher than the Light limit. Visits past the booked tier's limit (plus grace) are billed per visit.", schema: z.number().int().min(2).max(300), default: 30, flag: "OWNER_DECISION" }),
  "pricing.volumeLightVisitsHalfDay": def({ group: "Pricing", label: "Light day: visits included (half day)", schema: z.number().int().min(1).max(200), default: 6, flag: "OWNER_DECISION" }),
  "pricing.volumeBusyVisitsHalfDay": def({ group: "Pricing", label: "Busy day: visits included (half day)", schema: z.number().int().min(2).max(300), default: 15, flag: "OWNER_DECISION" }),
  "pricing.volumeGraceVisits": def({ group: "Pricing", label: "Grace visits before extra visits are billed", help: "Free buffer past the booked tier's limit. 0 = bill from the first visit over.", schema: z.number().int().min(0).max(50), default: 5, flag: "OWNER_DECISION" }),
  "pricing.volumeOverageClinicCents": def({ group: "Pricing", label: "Extra visit: clinic price per visit", schema: cents, default: 1000, flag: "OWNER_DECISION" }),
  "pricing.volumeOverageProviderCents": def({ group: "Pricing", label: "Extra visit: provider pay per visit", help: "Never more than the clinic's per-visit price. Premiums never apply to extra visits.", schema: cents, default: 800, flag: "OWNER_DECISION" }),
  "pricing.countTolerance": def({ group: "Pricing", label: "Visit counts: difference split automatically", help: "If the clinic's count and the provider's differ by this many visits or fewer, the average (rounded down) is used. More = admin review (the lower count is billed meanwhile).", schema: z.number().int().min(0).max(20), default: 2, flag: "OWNER_DECISION" }),
  "pricing.volumeDisputeHours": def({ group: "Pricing", label: "Hours the clinic has to dispute extra visits before the card is charged", help: "Counted from when the booking completes or the provider's count arrives, whichever is later.", schema: z.number().min(0).max(72), default: 2, flag: "OWNER_DECISION" }),
  "pricing.volumeLateClaimHours": def({ group: "Pricing", label: "Hours after the shift a provider can still enter the visit count", schema: z.number().int().min(1).max(336), default: 72, flag: null }),
  "pricing.underDeclareWarningShifts": def({ group: "Pricing", label: "Posting hint: recent days compared with the expected visits", help: "Warn (never block) when this many recent days at the location all beat the tier being booked.", schema: z.number().int().min(1).max(10), default: 3, flag: null }),

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

  // ---------- backups ----------
  "backups.enabled": def({ group: "Backups", label: "Nightly database backup (export + Neon restore point)", schema: z.boolean(), default: true, flag: null }),
  "backups.keepDaily": def({ group: "Backups", label: "Daily exports to keep", schema: z.number().int().min(1).max(60), default: 14, flag: null }),
  "backups.keepWeekly": def({ group: "Backups", label: "Weekly (Sunday) exports to keep", schema: z.number().int().min(0).max(52), default: 8, flag: null }),
  "backups.keepMonthly": def({ group: "Backups", label: "Monthly (1st of the month) exports to keep", schema: z.number().int().min(0).max(60), default: 12, flag: null }),
  "backups.keepManual": def({ group: "Backups", label: "\"Back up now\" exports to keep", schema: z.number().int().min(1).max(60), default: 10, flag: null }),
  "backups.keepRestorePoints": def({ group: "Backups", label: "Neon restore points to keep", help: "Each is a Neon branch; free Neon plans allow about 10 branches in total.", schema: z.number().int().min(1).max(30), default: 5, flag: null }),

  // ---------- time clock ----------
  "timeclock.enabled": def({ group: "Time clock", label: "Providers punch in / lunch / out and clinics sign off the timesheet", schema: z.boolean(), default: true, flag: null }),
  "timeclock.earliestInMinutes": def({ group: "Time clock", label: "Earliest punch-in (minutes before the shift starts)", schema: z.number().int().min(0).max(240), default: 60, flag: null }),
  "timeclock.latestHoursAfterEnd": def({ group: "Time clock", label: "Clock stays open this many hours after the scheduled end", help: "After that, missed times are added by hand with a note.", schema: z.number().int().min(1).max(48), default: 6, flag: null }),
  "timeclock.lateGraceMinutes": def({ group: "Time clock", label: "Minutes late / early before a punch is flagged to the clinic", schema: z.number().int().min(0).max(120), default: 10, flag: null }),
  "timeclock.farMiles": def({ group: "Time clock", label: "Flag punches made farther than this from the clinic (miles)", help: "Only when the phone shares its location; punching never needs it.", schema: z.number().min(0.1).max(50), default: 0.5, flag: null }),
  "timeclock.autoCloseHours": def({ group: "Time clock", label: "Hours after the scheduled end to close a timesheet with no punch-out", help: "It's closed at the scheduled end, flagged, and sent to the clinic.", schema: z.number().int().min(1).max(48), default: 3, flag: null }),
  "timeclock.clinicReminderHours": def({ group: "Time clock", label: "Remind the clinic to sign off after this many hours", schema: z.number().int().min(1).max(72), default: 24, flag: null }),
  "timeclock.autoApproveHours": def({ group: "Time clock", label: "Approve automatically if the clinic doesn't respond within (hours)", help: "Matches the dispute window by default, so pay isn't held longer than it is today.", schema: z.number().int().min(1).max(336), default: 48, flag: "OWNER_DECISION" }),
  "timeclock.allowOnsiteSignature": def({ group: "Time clock", label: "Let a manager sign the timesheet on the provider's phone", help: "The clinic still gets an emailed copy and can report a problem.", schema: z.boolean(), default: true, flag: null }),

  // ---------- referrals ----------
  "referrals.enabled": def({ group: "Referrals", label: "Referral program on", help: "Off hides the Refer & earn pages and stops new rewards; earned rewards still pay.", schema: z.boolean(), default: true, flag: null }),
  "referrals.referrerRewardCents": def({ group: "Referrals", label: "Reward to the person who refers (cents)", help: "Providers get it as pay through Stripe; clinics as a credit toward their next shift.", schema: cents, default: 2000, flag: "OWNER_DECISION" }),
  "referrals.refereeRewardCents": def({ group: "Referrals", label: "Bonus to the invited friend (cents)", help: "Paid the same way once their first shift is done. 0 = referrer only.", schema: cents, default: 1000, flag: "OWNER_DECISION" }),
  "referrals.holdDays": def({ group: "Referrals", label: "Days after the first shift before rewards go out", help: "Gives time for disputes and refunds.", schema: z.number().int().min(0).max(60), default: 3, flag: null }),
  "referrals.autoPayClean": def({ group: "Referrals", label: "Pay clean referrals automatically", help: "Off = every reward waits for your approval in Admin → Referrals. Flagged ones always wait.", schema: z.boolean(), default: true, flag: "OWNER_DECISION" }),
  "referrals.expiryMonths": def({ group: "Referrals", label: "Months an invitation stays open for its first shift", help: "Long enough for students to graduate and get licensed.", schema: z.number().int().min(1).max(60), default: 18, flag: null }),
  "referrals.creditExpiryDays": def({ group: "Referrals", label: "Days a clinic's referral credit stays usable", schema: z.number().int().min(30).max(1095), default: 365, flag: null }),

  // ---------- spam (public forms) ----------
  "spam.enabled": def({ group: "Spam", label: "Spam filter on public forms", help: "Ask a question, contact / offer / waitlist forms and signups. Off = everything goes through as before (the human check still runs when Turnstile keys are set).", schema: z.boolean(), default: true, flag: null }),
  "spam.threshold": def({ group: "Spam", label: "Spam score that files a message as spam (0-100)", help: "Lower catches more; raise it if real people land in Spam. Signups are only flagged in your new-signup email, never blocked.", schema: z.number().int().min(10).max(100), default: 50, flag: null }),
  "spam.aiCheck": def({ group: "Spam", label: "Let the question-answering AI also flag sales pitches and spam", help: "Uses the call that already answers website questions, so it costs nothing extra.", schema: z.boolean(), default: true, flag: null }),
  "spam.checkEmailDomain": def({ group: "Spam", label: "Treat addresses whose domain can't receive email as spam", schema: z.boolean(), default: true, flag: null }),
  "spam.minSubmitSeconds": def({ group: "Spam", label: "Fastest a person can fill in a form (seconds)", help: "Faster submissions are treated as bots and quietly dropped. 0 turns this off.", schema: z.number().int().min(0).max(30), default: 3, flag: null }),
  "spam.retentionDays": def({ group: "Spam", label: "Days to keep spam before it's deleted", schema: z.number().int().min(1).max(365), default: 30, flag: "OWNER_DECISION" }),

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

  // ---------- credential expiry ----------
  "credentials.expiryReminderDays": def({
    group: "Credentials",
    label: "Renewal reminders (days before a license or malpractice policy expires)",
    help: "One reminder at each of these points. The last one also goes by SMS.",
    schema: z.array(z.number().int().min(1).max(365)).min(1).max(8),
    default: [60, 30, 14, 7],
    flag: null,
  }),

  // ---------- pre-licensure (students & new graduates) ----------
  "prelicensure.followupsEnabled": def({ group: "Students & new graduates", label: "Send credential follow-up emails to students", schema: z.boolean(), default: true, flag: null }),
  "prelicensure.followupDays": def({
    group: "Students & new graduates",
    label: "Follow-ups: days after graduation (or signup, if later)",
    help: "Each email asks only for what is still missing (license, malpractice, or a correction). Nothing is sent while everything is under review.",
    schema: z.array(z.number().int().min(1).max(730)).min(1).max(10),
    default: [30, 60, 90],
    flag: null,
  }),
  "prelicensure.repeatDays": def({ group: "Students & new graduates", label: "Then repeat every (days) while still incomplete", schema: z.number().int().min(7).max(365), default: 60, flag: null }),
  "prelicensure.minGapDays": def({ group: "Students & new graduates", label: "Never send two follow-ups closer than (days)", schema: z.number().int().min(1).max(90), default: 14, flag: null }),
  // ---------- growth: AI marketing & marketplace activation (services/src/growth) ----------
  "growth.pausedOutbound": def({ group: "Growth", label: "PAUSE OUTBOUND AUTOMATION (no automated growth email/SMS is sent while on)", schema: z.boolean(), default: false, flag: null }),
  "growth.providerMarketing": def({
    group: "Growth",
    label: "Provider marketing on (welcome, credential follow-ups, activation)",
    help: "Independent of clinic marketing, so you can build provider supply before inviting clinics.",
    schema: z.boolean(),
    default: true,
    flag: "OWNER_DECISION",
  }),
  "growth.clinicMarketing": def({
    group: "Growth",
    label: "Clinic marketing on (prospect outreach, onboarding nudges, request recovery)",
    help: "Off until you have enough coverage-ready providers. Prospect discovery and research still build the list while this is off.",
    schema: z.boolean(),
    default: false,
    flag: "OWNER_DECISION",
  }),
  "growth.agents": def({
    group: "Growth",
    label: "Growth agents switched on",
    help: "Clinic Outreach and Provider Recruitment Outreach are the launch switches: off until you approve the first sends.",
    schema: z.record(z.string(), z.boolean()),
    default: {
      clinicProspecting: true, clinicOutreach: false, clinicConversation: true, clinicOnboarding: true, providerRecruitment: true,
      providerCredentialing: true, providerActivation: true, signupRecovery: true, matching: true, leadScoring: true, escalation: true, analytics: true,
      providerDiscovery: true, contactDiscovery: true, providerOutreach: false, providerReactivation: true, content: true,
    },
    flag: "OWNER_DECISION",
  }),
  "growth.outreachMode": def({ group: "Growth", label: "Clinic outreach: review (AI drafts wait for approval) or auto", schema: z.enum(["review", "auto"]), default: "review", flag: "OWNER_DECISION" }),
  "growth.providerOutreachMode": def({ group: "Growth", label: "Provider recruitment outreach: review (drafts wait for approval) or auto", schema: z.enum(["review", "auto"]), default: "review", flag: "OWNER_DECISION" }),
  "growth.instagram.autoApprovePerDay": def({ group: "Growth", label: "Instagram: auto-approve this many found handles a day (0 = you approve each one)", help: "Auto-approved handles go straight into the follow queue. Following is always done by a person in Instagram.", schema: z.number().int().min(0).max(100), default: 0, flag: null }),
  "growth.instagram.followsPerDay": def({ group: "Growth", label: "Instagram: follows per day", help: "The follow queue stops offering clinics after this many follows in a day.", schema: z.number().int().min(1).max(100), default: 30, flag: null }),
  "growth.instagram.followsPerWindow": def({ group: "Growth", label: "Instagram: follows at a time", help: "No more than this many follows in each pacing window.", schema: z.number().int().min(1).max(10), default: 2, flag: null }),
  "growth.instagram.windowMinutes": def({ group: "Growth", label: "Instagram: pacing window (minutes)", schema: z.number().int().min(1).max(120), default: 5, flag: null }),
  "growth.instagram.startTime": def({ group: "Growth", label: "Instagram: follow from (local time)", schema: localTime, default: "09:00", flag: null }),
  "growth.instagram.endTime": def({ group: "Growth", label: "Instagram: follow until (local time)", schema: localTime, default: "20:00", flag: null }),
  "growth.instagram.timeZone": def({ group: "Growth", label: "Instagram: time zone for the daily limit and hours", schema: z.string().min(3), default: "America/New_York", flag: null }),
  "growth.providerOutreachGapDays": def({ group: "Growth", label: "Provider recruitment sequence: days before each step", schema: z.array(z.number().int().min(0)).max(6), default: [0, 7], flag: "OWNER_DECISION" }),
  "growth.contactResearchPerRun": def({ group: "Growth", label: "Contact discovery: providers researched on the web per run (shares the research budget)", schema: z.number().int().min(0).max(100), default: 6, flag: null }),
  "growth.postalAddress": def({ group: "Growth", label: "Physical postal address shown in marketing email", help: "Required in commercial email; marketing sends are blocked while blank.", schema: z.string().max(300), default: "", flag: "ATTORNEY_REVIEW" }),
  "growth.aiProvider": def({ group: "Growth", label: "AI provider for growth agents (falls back to templates when its key is missing)", schema: z.enum(["anthropic", "gemini", "openai", "none"]), default: "anthropic", flag: "OWNER_DECISION" }),
  "growth.aiModels": def({
    group: "Growth",
    label: "AI model per task",
    help: "classify = cheap tasks (segments, reply intent); write = personalized emails; converse = website chat; summarize = briefings; research = clinic web research when the research provider's key is missing (see Prospecting: research provider).",
    schema: z.object({ classify: z.string().min(1), write: z.string().min(1), converse: z.string().min(1), summarize: z.string().min(1), research: z.string().min(1).default("claude-opus-5-5") }),
    default: { classify: "claude-haiku-4-5", write: "claude-opus-5-5", converse: "claude-opus-5-5", summarize: "claude-haiku-4-5", research: "claude-opus-5-5" },
    flag: "OWNER_DECISION",
  }),
  "growth.researchProvider": def({ group: "Growth", label: "Prospecting: AI provider for clinic web research", help: "Uses OPENAI_API_KEY, ANTHROPIC_API_KEY or GEMINI_API_KEY. If that key is missing, research uses the growth AI provider above with its research model.", schema: z.enum(["openai", "anthropic", "gemini"]), default: "openai", flag: "OWNER_DECISION" }),
  "growth.researchModel": def({ group: "Growth", label: "Prospecting: research model", help: "The model ID for the research provider, e.g. gpt-6-luna (OpenAI), claude-opus-5-5 (Anthropic), gemini-2.5-flash (Gemini).", schema: z.string().min(1).max(80), default: "gpt-6-luna", flag: "OWNER_DECISION" }),
  "growth.aiEffort": def({ group: "Growth", label: "AI effort for larger models (lower = cheaper)", schema: z.enum(["low", "medium", "high"]), default: "low", flag: null }),
  "growth.aiDailyBudgetCents": def({ group: "Growth", label: "AI daily spend cap", schema: cents, default: 300, flag: "OWNER_DECISION" }),
  "growth.aiMonthlyBudgetCents": def({ group: "Growth", label: "AI monthly spend cap", schema: cents, default: 4000, flag: "OWNER_DECISION" }),
  "growth.aiPricing": def({
    group: "Growth",
    label: "AI price per million tokens, in cents [input, output]",
    schema: z.record(z.string(), z.tuple([z.number().min(0), z.number().min(0)])),
    default: { "claude-opus-5-5": [400, 2000], "claude-sonnet-5-5": [200, 1000], "claude-haiku-4-5": [100, 500], "gpt-6-luna": [10, 50], gemini: [0, 0] },
    flag: null,
  }),
  "growth.discoveryAreasPerRun": def({ group: "Growth", label: "Prospecting: cities searched per agent run (across all prelaunch/live markets in Growth → Expansion)", schema: z.number().int().min(0).max(50), default: 3, flag: null }),
  "growth.rediscoverDays": def({ group: "Growth", label: "Prospecting: re-search each city every N days", schema: z.number().int().min(1), default: 30, flag: null }),
  "growth.researchPerRun": def({ group: "Growth", label: "Prospecting: clinics researched on the web per agent run", schema: z.number().int().min(0).max(100), default: 8, flag: null }),
  "growth.researchConcurrency": def({ group: "Growth", label: "Prospecting: research calls at the same time (1 suits low API tiers)", schema: z.number().int().min(1).max(5), default: 1, flag: null }),
  "growth.researchDailyRequestCap": def({ group: "Growth", label: "Prospecting: max web-research requests per day (0 = no cap; e.g. 45 on a 50-requests/day API tier)", schema: z.number().int().min(0).max(100000), default: 0, flag: null }),
  "growth.researchMaxSearches": def({ group: "Growth", label: "Prospecting: max web searches per clinic", schema: z.number().int().min(1).max(20), default: 5, flag: null }),
  "growth.researchDailyBudgetCents": def({ group: "Growth", label: "Prospecting: daily web-research spend cap (separate from the AI cap above)", schema: cents, default: 500, flag: "OWNER_DECISION" }),
  "growth.webSearchCentsPer1000": def({ group: "Growth", label: "Web search price per 1,000 searches", schema: cents, default: 1000, flag: null }),
  "growth.nurtureOffsetDays": def({ group: "Growth", label: "Provider credential follow-ups: days after graduation", schema: z.array(z.number().int().min(0)).max(10), default: [30, 60, 90], flag: "OWNER_DECISION" }),
  "growth.nurtureRepeatDays": def({ group: "Growth", label: "…then every N days", schema: z.number().int().positive(), default: 60, flag: "OWNER_DECISION" }),
  "growth.nurtureMax": def({ group: "Growth", label: "Max credential follow-ups per provider", schema: z.number().int().min(0), default: 10, flag: null }),
  "growth.activationRepeatDays": def({ group: "Growth", label: "Provider activation nudge repeat (days)", schema: z.number().int().positive(), default: 30, flag: null }),
  "growth.activationMax": def({ group: "Growth", label: "Max activation nudges per provider", schema: z.number().int().min(0), default: 4, flag: null }),
  "growth.outreachGapDays": def({ group: "Growth", label: "Clinic outreach sequence: days before each step", schema: z.array(z.number().int().min(0)).max(10), default: [0, 5, 12], flag: "OWNER_DECISION" }),
  "growth.recoveryWaitHours": def({ group: "Growth", label: "Unfinished coverage request: wait before follow-up", schema: z.number().positive(), default: 4, flag: null }),
  "growth.recoveryRepeatHours": def({ group: "Growth", label: "Unfinished coverage request: repeat after", schema: z.number().positive(), default: 72, flag: null }),
  "growth.recoveryMax": def({ group: "Growth", label: "Max follow-ups per unfinished request", schema: z.number().int().min(0), default: 2, flag: null }),
  "growth.onboardingWaitHours": def({ group: "Growth", label: "Clinic onboarding: first nudge after signup", schema: z.number().positive(), default: 24, flag: null }),
  "growth.onboardingRepeatDays": def({ group: "Growth", label: "Clinic onboarding: repeat nudge (days)", schema: z.number().int().positive(), default: 4, flag: null }),
  "growth.onboardingMax": def({ group: "Growth", label: "Max onboarding nudges per clinic", schema: z.number().int().min(0), default: 3, flag: null }),
  "growth.minHoursBetweenAutomated": def({ group: "Growth", label: "Min gap between automated messages to one person", schema: z.number().min(0), default: 20, flag: null }),
  "growth.maxCommercialPerWeek": def({ group: "Growth", label: "Max marketing emails to one person per 7 days", schema: z.number().int().min(0), default: 2, flag: "OWNER_DECISION" }),
  "growth.dailyOutreachCap": def({ group: "Growth", label: "Max new marketing emails per day (all prospects)", schema: z.number().int().min(0), default: 40, flag: "OWNER_DECISION" }),
  "growth.smsQuietStart": def({ group: "Growth", label: "No automated texts after (local)", schema: localTime, default: "20:00", flag: null }),
  "growth.smsQuietEnd": def({ group: "Growth", label: "No automated texts before (local)", schema: localTime, default: "09:00", flag: null }),
  "growth.highValueDays": def({ group: "Growth", label: "Unfinished request this many days or longer goes to the sales queue", schema: z.number().int().min(1), default: 2, flag: null }),
  "growth.escalationEmail": def({ group: "Growth", label: "Email admins for each escalation", schema: z.boolean(), default: true, flag: null }),

  // ---------- blog ----------
  "blog.aiProvider": def({ group: "Blog", label: "AI provider for blog drafts (separate from Growth)", schema: z.enum(["anthropic", "gemini", "openai", "none"]), default: "openai", flag: null }),
  "blog.aiModel": def({ group: "Blog", label: "AI model for blog drafts", help: "A model from the provider above: an OpenAI model (e.g. gpt-4.1-mini), a Gemini model (e.g. gemini-2.5-flash) or a Claude model ID. Add its price under Growth → AI price per million tokens so the spend caps count it correctly.", schema: z.string().min(1).max(80), default: "gpt-4.1-mini", flag: null }),
  "blog.autoDraftsPerWeek": def({
    group: "Blog",
    label: "Drafts the AI writes on its own each week (0 = only when you ask)",
    help: "Drafts wait for your review; nothing is published automatically. Topics come from the list below, then from AI suggestions.",
    schema: z.number().int().min(0).max(7),
    default: 1,
    flag: "OWNER_DECISION",
  }),
  "blog.authorName": def({ group: "Blog", label: "Byline on posts (blank = “The <brand> team”)", schema: z.string().max(80), default: "", flag: null }),
  "blog.topicQueue": def({
    group: "Blog",
    label: "Topic queue for automatic drafts",
    help: 'Each item: {"topic": "...", "audience": "CLINIC" | "PROVIDER" | "ALL"}. Used in order; a topic is skipped once a post has been written from it.',
    schema: z.array(z.object({ topic: z.string().min(5).max(200), audience: z.enum(["CLINIC", "PROVIDER", "ALL"]) })).max(100),
    default: [
      { topic: "What to do when the only doctor at a chiropractic clinic is out sick", audience: "CLINIC" },
      { topic: "Locum agencies vs. a coverage marketplace: how chiropractic clinics can compare their options", audience: "CLINIC" },
      { topic: "Planning coverage for a continuing-education weekend: a checklist for clinic owners", audience: "CLINIC" },
      { topic: "What a covering chiropractor needs on day one: an onboarding checklist for your front desk", audience: "CLINIC" },
      { topic: "Why license verification matters when you bring in a fill-in doctor", audience: "CLINIC" },
      { topic: "Taking a real vacation as a solo chiropractor: how to keep the practice open", audience: "CLINIC" },
      { topic: "Per diem chiropractic work: what to know before your first coverage shift", audience: "PROVIDER" },
      { topic: "New chiropractic graduates: building real-world experience with coverage shifts", audience: "PROVIDER" },
      { topic: "How to be the covering doctor clinics ask for again", audience: "PROVIDER" },
      { topic: "Malpractice coverage for fill-in chiropractors: questions to ask your carrier", audience: "PROVIDER" },
    ],
    flag: null,
  }),

  // ---------- training (academy) ----------
  "academy.videos": def({
    group: "Training",
    label: "Training videos (lesson → YouTube video ID or link)",
    help: 'Unlisted YouTube walkthroughs shown at the top of each lesson, e.g. {"clinic/posting": "dQw4w9WgXcQ"}. Keys are <course>/<lesson>; a lesson without one shows no video.',
    schema: z.record(z.string(), z.string().max(200)),
    default: {},
    flag: null,
  }),

  // ---------- feature flags (ATTORNEY REVIEW items ship OFF) ----------
  "features.preLicensureEnabled": def({ group: "Features", label: "Student / not-yet-licensed signup path and /join recruitment pages", schema: z.boolean(), default: true, flag: null }),
  "features.onCallEnabled": def({ group: "Features", label: "On Call auto-accept (requires On Call Terms in the Provider Agreement)", schema: z.boolean(), default: false, flag: "ATTORNEY_REVIEW" }),
  "site.instagramUrl": def({ group: "Help & support", label: "Instagram link (website footer)", help: "Leave blank to hide the icon.", schema: z.union([z.literal(""), z.string().url()]), default: "https://www.instagram.com/coverageoncall", flag: null }),
  "site.youtubeUrl": def({ group: "Help & support", label: "YouTube link (website footer)", help: "Leave blank to hide the icon.", schema: z.union([z.literal(""), z.string().url()]), default: "https://www.youtube.com/@coverageoncall", flag: null }),
  "seo.gaMeasurementId": def({ group: "Search & reviews", label: "Google Analytics 4 measurement ID (blank = off)", help: "Looks like G-XXXXXXXXXX (Google Analytics → Admin → Data streams → your web stream). Loads on the public website only, never inside clinic, provider or admin accounts.", schema: z.union([z.literal(""), z.string().regex(/^G-[A-Z0-9]{4,15}$/, "Use the G-XXXXXXXXXX measurement ID")]), default: "G-JX87E075SG", flag: null }),
  "seo.googleSiteVerification": def({ group: "Search & reviews", label: "Google Search Console verification code", help: "Search Console → Add property → URL prefix → HTML tag: paste only the content=\"…\" value. Not needed if you verified by DNS.", schema: z.string().max(100), default: "", flag: null }),
  "seo.bingSiteVerification": def({ group: "Search & reviews", label: "Bing Webmaster Tools verification code", help: "Bing Webmaster → Add site → HTML meta tag: paste only the content value. Or import from Search Console instead.", schema: z.string().max(100), default: "", flag: null }),
  "seo.indexNow": def({ group: "Search & reviews", label: "Notify Bing / AI search engines (IndexNow) when pages change", help: "New blog posts right away, and every public page once a day. Bing also feeds ChatGPT and Copilot search.", schema: z.boolean(), default: true, flag: null }),
  "reviews.googleReviewUrl": def({ group: "Search & reviews", label: "Google review link (blank = don't ask for reviews)", help: "From your Google Business Profile → Ask for reviews → copy link (looks like https://g.page/r/…/review). Every clinic is asked the same way after its first completed shift, never only the happy ones (Google forbids that).", schema: z.union([z.literal(""), z.string().url()]), default: "", flag: null }),
  "reviews.askAfterDays": def({ group: "Search & reviews", label: "Ask for a review this many days after a completed shift", schema: z.number().int().min(0).max(30), default: 1, flag: null }),
  "reviews.repeatDays": def({ group: "Search & reviews", label: "Don't ask the same clinic again for (days)", schema: z.number().int().min(30).max(730), default: 180, flag: null }),
  "health.enabled": def({ group: "System health", label: "Email me when something stops working", help: "Checks every 5 minutes: background jobs (cron), email and text sending, AI credits and keys, Stripe errors, backups and database updates.", schema: z.boolean(), default: true, flag: null }),
  "health.alertEmails": def({ group: "System health", label: "Extra alert email addresses", help: "Alerts are emailed to the admin inbox (Settings → Email addresses) and shown to every admin in the app. Add other addresses here, e.g. a personal inbox in case the business email itself is the problem.", schema: z.array(z.string().email()).max(10), default: [], flag: null }),
  "health.textCritical": def({ group: "System health", label: "Also text admins for critical problems", help: "Uses each admin's verified mobile number (needs texting set up).", schema: z.boolean(), default: true, flag: null }),
  "health.repeatHours": def({ group: "System health", label: "Remind me again after (hours) while a problem continues", schema: z.number().int().min(1).max(168), default: 12, flag: null }),
  "health.cronStaleMinutes": def({ group: "System health", label: "Alert when background jobs haven't run for (minutes)", schema: z.number().int().min(3).max(240), default: 10, flag: null }),
  "health.failStreak": def({ group: "System health", label: "Alert after this many failures in a row (jobs, emails, texts)", schema: z.number().int().min(1).max(50), default: 3, flag: null }),
  "health.backupMaxAgeHours": def({ group: "System health", label: "Alert when the last good backup is older than (hours)", schema: z.number().int().min(6).max(240), default: 30, flag: null }),
  "email.adminInbox": def({ group: "Email addresses", label: "Admin & system alerts go to", help: "System health, backups, emergencies, no-shows, hire requests and other operations alerts. Admins still see every alert in the app.", schema: z.string().email(), default: "admin@coverageoncall.com", flag: null }),
  "email.billingInbox": def({ group: "Email addresses", label: "Billing alerts go to", help: "Failed payouts and charges, disputes, reversed transfers, visit-count disputes, placement fees.", schema: z.string().email(), default: "billing@coverageoncall.com", flag: null }),
  "email.infoInbox": def({ group: "Email addresses", label: "New sign-ups, inquiries and website questions go to", schema: z.string().email(), default: "info@coverageoncall.com", flag: null }),
  "email.privacyInbox": def({ group: "Email addresses", label: "Account deletions and privacy matters go to", schema: z.string().email(), default: "privacy@coverageoncall.com", flag: null }),
  "email.replyTo": def({ group: "Email addresses", label: "Reply-to address on emails the site sends", help: "When someone hits Reply on any email from the site, it goes here.", schema: z.union([z.literal(""), z.string().email()]), default: "support@coverageoncall.com", flag: null }),
  "support.email": def({ group: "Help & support", label: "Support inbox email", help: "Every \"Need help now?\" escalation is emailed here (and new support requests are copied here).", schema: z.string().email(), default: "support@coverageoncall.com", flag: null }),
  "support.urgentPromise": def({ group: "Help & support", label: "Urgent help promise shown to clinics and providers", schema: z.string().min(3).max(160), default: "Someone from our team will contact you within minutes.", flag: null }),
  "support.replyTime": def({ group: "Help & support", label: "Reply time shown on Contact support", help: "Shown to clinics and providers when they send a request.", schema: z.string().min(3).max(120), default: "We usually reply within one business day.", flag: null }),
  "support.topics": def({ group: "Help & support", label: "Contact support topics", help: "The choices on the Contact support form.", schema: z.array(z.string().min(2).max(60)).min(1).max(20), default: ["A shift or booking", "Payments and billing", "Pay and payouts", "Credentials and verification", "My account and login", "Something isn't working", "Other"], flag: null }),
  "features.comparisonClaim": def({ group: "Features", label: "Show \"We charge our clinics less and get our doctors paid more\" on the public site", help: "A comparison with competitors: keep proof on file (competitor offers to doctors and their clinic prices). Turn off if you can't back it up.", schema: z.boolean(), default: true, flag: "OWNER_DECISION" }),
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
