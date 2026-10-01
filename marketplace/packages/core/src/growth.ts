import { hasQualifyingLicense, hasQualifyingMalpractice, type LicenseFact, type MalpracticeFact, type ProfessionStateFacts } from "./eligibility";
import { DAY } from "./time";

/**
 * Growth system rules (AI growth, marketing & marketplace activation). Pure
 * and deterministic: which follow-up is due, whether a message may be sent,
 * what stage a prospect or provider is in. Agents in services/src/growth only
 * act on these decisions; AI never overrides them.
 *
 * Provider "coverage-ready" here drives messaging only. Shift eligibility is
 * still decided exclusively by getEligibleProviders / assertProviderEligibleForShift.
 */

// ---------------- providers ----------------

export type ProviderGrowthStage =
  | "STUDENT" | "REGISTERED" | "PENDING_LICENSE" | "PENDING_MALPRACTICE" | "CREDENTIAL_REVIEW" | "COVERAGE_READY" | "FIRST_SHIFT" | "REPEAT_PROVIDER";
/** Which credential message applies now (spec §24). */
export type CredentialMessage = "license" | "malpractice" | "under_review" | "none";

export interface ProviderGrowthInput {
  licenses: LicenseFact[];
  malpractice: MalpracticeFact[];
  professionCode: string;
  state: string;
  mins: Pick<ProfessionStateFacts, "malpracticeMinOccurrenceCents" | "malpracticeMinAggregateCents">;
  nationalCredentialAccepted?: boolean;
  graduationDate: Date | null;
  isStudent: boolean;
  shiftsCompleted: number;
  now: Date;
}

export function providerGrowthState(p: ProviderGrowthInput): { stage: ProviderGrowthStage; message: CredentialMessage; coverageReady: boolean } {
  const licOk = hasQualifyingLicense(p.licenses, p.professionCode, p.state, p.now, p.nationalCredentialAccepted ?? false);
  const malOk = hasQualifyingMalpractice(p.malpractice, p.professionCode, p.now, p.mins);
  if (licOk && malOk) {
    const stage = p.shiftsCompleted >= 2 ? "REPEAT_PROVIDER" : p.shiftsCompleted >= 1 ? "FIRST_SHIFT" : "COVERAGE_READY";
    return { stage, message: "none", coverageReady: true };
  }
  const forHere = (l: LicenseFact) => l.professionCode === p.professionCode && (l.state === p.state || (p.nationalCredentialAccepted && l.state === "US"));
  const licPending = p.licenses.some((l) => forHere(l) && l.status === "PENDING_VERIFICATION");
  const malPending = p.malpractice.some((m) => m.status === "PENDING_VERIFICATION" && m.coveredProfessionCodes.includes(p.professionCode));
  if ((!licOk && licPending) || (licOk && malPending)) return { stage: "CREDENTIAL_REVIEW", message: "under_review", coverageReady: false };
  if (licOk) return { stage: "PENDING_MALPRACTICE", message: "malpractice", coverageReady: false };
  // No usable license yet. Students aren't chased until after graduation.
  const grad = p.graduationDate;
  if ((grad && grad > p.now) || (p.isStudent && !grad)) return { stage: "STUDENT", message: "none", coverageReady: false };
  return { stage: grad ? "PENDING_LICENSE" : "REGISTERED", message: "license", coverageReady: false };
}

export interface GrowthCadence {
  nurtureOffsetDays: number[];
  nurtureRepeatDays: number;
  nurtureMax: number;
  activationRepeatDays: number;
  activationMax: number;
}

/**
 * Credential follow-ups (spec §23): offsets after graduation (or registration
 * when there's no graduation date), then every repeatDays, up to a cap. Never
 * two closer than half the repeat interval, even when catching up.
 */
export function nurtureDue(
  p: { graduationDate: Date | null; createdAt: Date; nurtureCount: number; lastNurtureAt: Date | null },
  message: CredentialMessage,
  c: GrowthCadence,
  now: Date,
): boolean {
  if (message !== "license" && message !== "malpractice") return false;
  if (p.nurtureCount >= c.nurtureMax) return false;
  const anchor = +(p.graduationDate ?? p.createdAt);
  const offsets = c.nurtureOffsetDays;
  const lastOffset = offsets.length ? offsets[offsets.length - 1] : 0;
  const dueDays = p.nurtureCount < offsets.length ? offsets[p.nurtureCount] : lastOffset + (p.nurtureCount - offsets.length + 1) * c.nurtureRepeatDays;
  if (p.lastNurtureAt && +now - +p.lastNurtureAt < (c.nurtureRepeatDays / 2) * DAY) return false;
  return +now >= anchor + dueDays * DAY;
}

/** "ready" = first nudge after becoming coverage-ready; "reactivate" = no/stale availability and idle. */
export function activationDue(
  p: { coverageReady: boolean; activationCount: number; lastActivationAt: Date | null; hasAvailability: boolean; availabilityUpdatedAt: Date | null; lastShiftAt: Date | null },
  c: GrowthCadence,
  now: Date,
): "ready" | "reactivate" | null {
  if (!p.coverageReady) return null;
  if (p.activationCount === 0) return "ready";
  if (p.activationCount >= c.activationMax) return null;
  if (p.lastActivationAt && +now - +p.lastActivationAt < c.activationRepeatDays * DAY) return null;
  const stale = !p.availabilityUpdatedAt || +now - +p.availabilityUpdatedAt > 120 * DAY;
  const idle = !p.lastShiftAt || +now - +p.lastShiftAt > 90 * DAY;
  return !p.hasAvailability || (stale && idle) ? "reactivate" : null;
}

// ---------------- clinics ----------------

export type ProspectStage =
  | "PROSPECT" | "CONTACTABLE" | "OUTREACH_STARTED" | "ENGAGED" | "INTERESTED" | "ACCOUNT_STARTED" | "ACCOUNT_CREATED" | "COVERAGE_REQUESTED"
  | "FIRST_SHIFT_BOOKED" | "FIRST_SHIFT_COMPLETED" | "REPEAT_CLINIC" | "DORMANT" | "NOT_INTERESTED" | "DO_NOT_CONTACT";

export interface ProspectFacts {
  hasAccount: boolean;
  /** A DRAFT shift (started, not posted). */
  hasDraft: boolean;
  posted: number;
  booked: number;
  completed: number;
  lastBookingAt: Date | null;
  hasEmail: boolean;
  emailBounced: boolean;
  doNotContact: boolean;
}

/** Pre-account stages are set by outreach and replies; once there's an account, bookings decide. Opt-outs stick. */
export function prospectStageFromAccount(current: ProspectStage, f: ProspectFacts, now: Date): ProspectStage {
  if (f.doNotContact) return "DO_NOT_CONTACT";
  if (!f.hasAccount) {
    if (current === "PROSPECT" && f.hasEmail && !f.emailBounced) return "CONTACTABLE";
    return current;
  }
  let stage: ProspectStage;
  if (f.completed >= 2 || f.booked >= 2) stage = "REPEAT_CLINIC";
  else if (f.completed >= 1) stage = "FIRST_SHIFT_COMPLETED";
  else if (f.booked >= 1) stage = "FIRST_SHIFT_BOOKED";
  else if (f.hasDraft || f.posted >= 1) stage = "COVERAGE_REQUESTED";
  else stage = "ACCOUNT_CREATED";
  if (f.lastBookingAt && +now - +f.lastBookingAt > 365 * DAY) stage = "DORMANT";
  if (current === "NOT_INTERESTED" && stage === "ACCOUNT_CREATED") return "NOT_INTERESTED";
  return stage;
}

/** Points per signal. Opens are deliberately absent (vanity metric, spec §16). */
export const SIGNAL_POINTS: Record<string, number> = {
  email_reply: 15, site_visit: 3, calculator_used: 12, pricing_viewed: 6, signup_started: 10, account_created: 20, coverage_dates_entered: 20,
  coverage_request_abandoned: 5, recurring_inquiry: 15, contact_requested: 30, chat_question: 6, booking_created: 40, repeat_booking: 25,
  interested_reply: 25, not_interested_reply: -40,
};

export type IntentCategory = "COLD" | "WARM" | "ENGAGED" | "HIGH_INTENT" | "ACTIVE_CUSTOMER" | "REPEAT_CUSTOMER";

/** Full weight for 30 days, half to 90, then nothing. */
export function leadScore(
  signals: { kind: string; at: Date }[],
  p: { locationsCount: number | null; providerCount: number | null },
  customer: { booked: number },
  now: Date,
): { score: number; category: IntentCategory } {
  let score = 0;
  for (const s of signals) {
    const age = +now - +s.at;
    if (age > 90 * DAY) continue;
    const pts = SIGNAL_POINTS[s.kind] ?? 0;
    score += age <= 30 * DAY ? pts : pts / 2;
  }
  if ((p.locationsCount ?? 0) > 1) score += 10;
  if ((p.providerCount ?? 0) > 2) score += 5;
  score = Math.round(Math.max(0, Math.min(100, score)));
  let category: IntentCategory = score >= 50 ? "HIGH_INTENT" : score >= 25 ? "ENGAGED" : score >= 10 ? "WARM" : "COLD";
  if (customer.booked >= 2) category = "REPEAT_CUSTOMER";
  else if (customer.booked >= 1) category = "ACTIVE_CUSTOMER";
  return { score, category };
}

/** A segment the listed facts already prove; null = unknown (AI may suggest one, labelled as a guess). */
export function ruleSegment(p: { ownership?: string | null; locationsCount?: number | null; providerCount?: number | null; multidisciplinary?: boolean | null }): string | null {
  if (p.ownership === "franchise") return "franchise";
  if ((p.locationsCount ?? 0) > 1) return "multi_location";
  if (p.multidisciplinary) return "multidisciplinary";
  if ((p.providerCount ?? 0) > 1) return "multi_dc";
  if (p.providerCount === 1) return "solo";
  return null;
}

/** Step N of the outreach sequence is due gaps[N] days after the last contact (step 0: now). */
export function outreachStepDue(step: number, lastContactedAt: Date | null, gapDays: number[], now: Date): boolean {
  if (step >= gapDays.length) return false;
  if (step === 0 || !lastContactedAt) return true;
  return +now >= +lastContactedAt + gapDays[step] * DAY;
}

// ---------------- compliance (spec §11) ----------------

export type Channel = "EMAIL" | "SMS";
export type Purpose = "COMMERCIAL" | "RELATIONSHIP" | "TRANSACTIONAL";

export interface ContactContext {
  channel: Channel;
  purpose: Purpose;
  /** false only for a message a person wrote or approved just now. */
  automated: boolean;
  pausedOutbound: boolean;
  doNotContact: boolean;
  address: string;
  /** UNKNOWN | VALID | BOUNCED | COMPLAINED | UNSUBSCRIBED */
  emailStatus: string;
  /** CommSuppression.reason for this address/channel, if any. */
  suppression: string | null;
  smsConsent: boolean;
  postalAddress: string;
  lastAutomatedAt: Date | null;
  commercialLast7Days: number;
  commercialToday: number;
  /** Recipient's local time, minutes after midnight. */
  localMinutes: number;
  limits: { minHoursBetweenAutomated: number; maxCommercialPerWeek: number; dailyOutreachCap: number; smsQuietStartMin: number; smsQuietEndMin: number };
  now: Date;
}

/** Reasons that clear on their own; the send waits rather than being dropped. */
export const TRANSIENT_BLOCKS = new Set(["automation_paused", "postal_address_missing", "frequency_min_interval", "frequency_weekly_cap", "daily_outreach_cap", "sms_quiet_hours"]);

export function contactDecision(c: ContactContext): { ok: boolean; reason: string | null; transient: boolean } {
  const no = (reason: string) => ({ ok: false, reason, transient: TRANSIENT_BLOCKS.has(reason) });
  if (c.automated && c.pausedOutbound) return no("automation_paused");
  if (c.doNotContact) return no("do_not_contact");
  if (!c.address.trim()) return no("no_address");
  const hardSuppression = c.suppression && ["BOUNCE", "COMPLAINT", "DO_NOT_CONTACT", "SMS_STOP"].includes(c.suppression);
  if (c.channel === "EMAIL") {
    if (c.emailStatus === "BOUNCED" || c.emailStatus === "COMPLAINED") return no(`email_${c.emailStatus.toLowerCase()}`);
    if (c.emailStatus === "UNSUBSCRIBED" && c.purpose !== "TRANSACTIONAL") return no("unsubscribed");
    if (c.suppression && (c.purpose !== "TRANSACTIONAL" || hardSuppression)) return no(`suppressed_${c.suppression.toLowerCase()}`);
    if (c.purpose === "COMMERCIAL" && !c.postalAddress.trim()) return no("postal_address_missing");
  } else {
    // SMS only ever goes to people who opted in, whatever the purpose.
    if (!c.smsConsent) return no("no_sms_consent");
    if (c.suppression) return no(`suppressed_${c.suppression.toLowerCase()}`);
    if (c.purpose === "COMMERCIAL") return no("sms_commercial_disabled");
    const { smsQuietStartMin: qs, smsQuietEndMin: qe } = c.limits;
    const quiet = qs > qe ? c.localMinutes >= qs || c.localMinutes < qe : c.localMinutes >= qs && c.localMinutes < qe;
    if (c.automated && quiet) return no("sms_quiet_hours");
  }
  if (c.automated && c.purpose !== "TRANSACTIONAL") {
    if (c.lastAutomatedAt && +c.now - +c.lastAutomatedAt < c.limits.minHoursBetweenAutomated * 3_600_000) return no("frequency_min_interval");
    if (c.purpose === "COMMERCIAL") {
      if (c.commercialLast7Days >= c.limits.maxCommercialPerWeek) return no("frequency_weekly_cap");
      if (c.commercialToday >= c.limits.dailyOutreachCap) return no("daily_outreach_cap");
    }
  }
  return { ok: true, reason: null, transient: false };
}

// ---------------- prompts & AI output guardrails (spec §34, §42) ----------------

/** {{var}} for allowed variables only; anything else is removed so nothing unintended reaches a message. */
export function renderTemplate(tpl: string, vars: Record<string, string | null | undefined>, allowed: string[]): string {
  return tpl.replace(/\{\{\s*([a-zA-Z0-9_]+)\s*\}\}/g, (_, k: string) => (allowed.includes(k) ? (vars[k] ?? "") : ""));
}

export function urlsIn(text: string): string[] {
  return [...new Set((text.match(/https?:\/\/[^\s<>"')]+/gi) ?? []).map((u) => u.replace(/[.,;:]+$/, "")))];
}

const PHONE = /\(?\b\d{3}\)?[\s.-]\d{3}[\s.-]\d{4}\b/;
const EMAIL = /[\w.+-]+@[\w-]+\.[\w.]+/;
const PROHIBITED = /\b(guarantee[ds]?|risk[- ]free|double your|increase (your )?(revenue|collections|income)|\d+\s?% (more|increase|boost))\b/i;

/**
 * Checks an AI rewrite of an approved message. Same links, nothing new to
 * contact, no new dollar figures, no guarantee/ROI language, sane length.
 * Returns the problem, or null when it may be sent.
 */
export function validateAiCopy(approved: string, body: string, subject: string): string | null {
  const before = urlsIn(approved), after = urlsIn(body);
  if (before.some((u) => !after.includes(u))) return "dropped_link";
  if (after.some((u) => !before.includes(u))) return "added_link";
  if (EMAIL.test(body) && !EMAIL.test(approved)) return "added_email";
  if (PHONE.test(body) && !PHONE.test(approved)) return "added_phone";
  const money = (t: string) => t.match(/\$\s?\d[\d,]*/g) ?? [];
  const known = money(approved);
  if (money(body).some((m) => !known.includes(m))) return "added_dollar_amount";
  if (PROHIBITED.test(body) || PROHIBITED.test(subject)) return "prohibited_claim";
  if (!subject.trim() || subject.length > 120) return "bad_subject";
  if (body.length < 0.4 * approved.length || body.length > 2.2 * approved.length + 200) return "length_out_of_range";
  return null;
}

// ---------------- reply handling (spec §15) ----------------

/** Explicit opt-out words always suppress, whatever any model says. */
export function wantsOptOut(text: string): boolean {
  return /\b(unsubscribe|remove me|opt[- ]?out|stop (emailing|contacting|texting)|do not (email|contact))\b/i.test(text);
}

/** Topics a person must handle (legal, payment disputes, safety, clinical scope). */
export function escalationTopic(text: string): "legal" | "payment_dispute" | "safety" | "clinical_scope" | null {
  if (/\b(lawyer|attorney|legal|lawsuit|sue|liabilit|contract dispute|breach)\w*/i.test(text)) return "legal";
  if (/\b(refund|chargeback|dispute|overcharged|charged twice)\b/i.test(text)) return "payment_dispute";
  if (/\b(harass|discriminat|unsafe|injur|assault|abuse)\w*/i.test(text)) return "safety";
  if (/\b(scope of practice|diagnos|prescrib|medical advice)\w*/i.test(text)) return "clinical_scope";
  return null;
}
