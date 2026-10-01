import { DAY } from "./time";

/**
 * Pre-licensure (students & new graduates). Pure rules for the opt-in
 * student path: how a credential reads to a person, which lifecycle stage a
 * provider is in, which credential follow-up (if any) to send, and when.
 *
 * NOTHING here decides eligibility. Shift eligibility is INV-1/INV-3 in
 * eligibility.ts + the DB trigger, which never look at the student flag.
 */

/** Spec statuses. The app collects number + expiry with every upload, so "uploaded" and "verification pending" are one state. */
export type CredentialState = "not_provided" | "pending" | "verified" | "rejected" | "expired";

export interface CredentialRow {
  status: "PENDING_VERIFICATION" | "VERIFIED" | "EXPIRED" | "SUSPENDED" | "REVOKED" | "REJECTED";
  expiresAt: Date;
  createdAt: Date;
}

export const CREDENTIAL_STATE_LABELS: Record<CredentialState, string> = {
  not_provided: "Not provided",
  pending: "Verification pending",
  verified: "Verified",
  rejected: "Needs correction",
  expired: "Expired",
};

/**
 * One credential type (all of a provider's licenses, or all their malpractice
 * policies) summarised: any verified unexpired row wins; otherwise the newest
 * row decides.
 */
export function credentialState(rows: readonly CredentialRow[], now: Date): CredentialState {
  if (!rows.length) return "not_provided";
  if (rows.some((r) => r.status === "VERIFIED" && +r.expiresAt > +now)) return "verified";
  const latest = [...rows].sort((a, b) => +b.createdAt - +a.createdAt)[0]!;
  switch (latest.status) {
    case "PENDING_VERIFICATION":
      return "pending";
    case "VERIFIED":
    case "EXPIRED":
      return "expired";
    default:
      return "rejected"; // REJECTED, SUSPENDED, REVOKED: something needs fixing
  }
}

export type ProviderStage = "registered" | "pending_license" | "pending_malpractice" | "verification_pending" | "coverage_ready" | "active";

export const PROVIDER_STAGES: { key: ProviderStage; label: string }[] = [
  { key: "registered", label: "Registered / New Graduate" },
  { key: "pending_license", label: "Pending License" },
  { key: "pending_malpractice", label: "Licensed / Pending Malpractice" },
  { key: "verification_pending", label: "Credential Verification Pending" },
  { key: "coverage_ready", label: "Coverage Ready" },
  { key: "active", label: "Active Provider" },
];

export interface StageInput {
  preLicensure: boolean;
  graduationDate: Date | null;
  license: CredentialState;
  malpractice: CredentialState;
  /** Would pass matching today: provider ACTIVE, payouts on, a profession with verified license + malpractice. */
  coverageReady: boolean;
  /** Has a confirmed, in-progress or completed assignment. */
  hasWorked: boolean;
  now: Date;
}

const submitted = (s: CredentialState) => s === "pending" || s === "verified";

export function providerStage(i: StageInput): ProviderStage {
  if (i.coverageReady) return i.hasWorked ? "active" : "coverage_ready";
  if (!submitted(i.license)) {
    const inSchool = i.preLicensure && i.license === "not_provided" && i.graduationDate !== null && +i.graduationDate > +i.now;
    return inSchool ? "registered" : "pending_license";
  }
  if (!submitted(i.malpractice)) return "pending_malpractice";
  return "verification_pending";
}

export type FollowupKind =
  | "license_missing"
  | "license_rejected"
  | "license_expired"
  | "malpractice_missing"
  | "malpractice_rejected"
  | "malpractice_expired";

/**
 * The reminder a student should get next — or null when nothing is being
 * asked of them (everything submitted and under review, or done). Never asks
 * for something already provided: a pending license gets no license reminder.
 */
export function followupKind(license: CredentialState, malpractice: CredentialState): FollowupKind | null {
  if (license === "not_provided") return "license_missing";
  if (license === "rejected") return "license_rejected";
  if (license === "expired") return "license_expired";
  if (malpractice === "not_provided") return "malpractice_missing";
  if (malpractice === "rejected") return "malpractice_rejected";
  if (malpractice === "expired") return "malpractice_expired";
  return null;
}

/** Day (after the anchor) on which follow-up number `step` (0-based) is due: the listed days, then every repeatDays. */
export function followupDueDay(step: number, followupDays: readonly number[], repeatDays: number): number {
  if (step < followupDays.length) return followupDays[step]!;
  return followupDays[followupDays.length - 1]! + repeatDays * (step - followupDays.length + 1);
}

export interface FollowupScheduleInput {
  step: number;
  /** Graduation date, or signup if that's later (or no graduation date). */
  anchor: Date;
  lastSentAt: Date | null;
  now: Date;
  followupDays: readonly number[];
  repeatDays: number;
  minGapDays: number;
}

/**
 * Whether a follow-up is due now and, if sent, the step to record next. After
 * downtime it sends ONE catch-up email and skips the steps it missed.
 */
export function followupDue(i: FollowupScheduleInput): { due: false } | { due: true; nextStep: number } {
  const daysSince = Math.floor((+i.now - +i.anchor) / DAY);
  if (daysSince < followupDueDay(i.step, i.followupDays, i.repeatDays)) return { due: false };
  if (i.lastSentAt && +i.now - +i.lastSentAt < i.minGapDays * DAY) return { due: false };
  let next = i.step + 1;
  while (followupDueDay(next, i.followupDays, i.repeatDays) <= daysSince) next++;
  return { due: true, nextStep: next };
}

export function followupAnchor(graduationDate: Date | null, signedUpAt: Date): Date {
  return graduationDate && +graduationDate > +signedUpAt ? graduationDate : signedUpAt;
}

export const EXPECTED_LICENSURE: Record<string, string> = {
  "0-1": "Within a month",
  "1-3": "1–3 months",
  "3-6": "3–6 months",
  "6-12": "6–12 months",
  "12+": "More than a year",
  unsure: "Not sure yet",
};

export const ACQUISITION_SOURCES: Record<string, string> = {
  school: "Chiropractic school",
  event: "Graduation / school event",
  facebook: "Facebook",
  instagram: "Instagram",
  google: "Google",
  referral: "Referral (friend or classmate)",
  provider_referral: "Existing provider",
  clinic_referral: "Clinic referral",
  organic: "Organic search",
  direct: "Direct",
  other: "Other",
};

/** Where a signup came from: a recruitment link wins, then a recognised utm_source, then what they told us, else direct. */
export function resolveAcquisitionSource(i: { campaignKind?: string | null; utmSource?: string | null; selected?: string | null }): string {
  if (i.campaignKind) return i.campaignKind === "EVENT" ? "event" : i.campaignKind === "SCHOOL" ? "school" : "other";
  const u = (i.utmSource ?? "").toLowerCase();
  const map: Record<string, string> = { facebook: "facebook", fb: "facebook", meta: "facebook", instagram: "instagram", ig: "instagram", google: "google", adwords: "google", referral: "referral" };
  if (map[u]) return map[u]!;
  if (i.selected && ACQUISITION_SOURCES[i.selected]) return i.selected;
  return "direct";
}
