/**
 * Rewards (points, levels). Pure: callers pass facts, these functions say which point events
 * an account has earned. Every event has a stable refKey, so awarding is idempotent (the
 * ledger stores each refKey once). Points are a loyalty measure, never money: giveaways and
 * bonus-pay promos are decided by people, using levels and points as the yardstick.
 */

export type RewardAudience = "PROVIDER" | "CLINIC";

export interface RewardRule {
  key: string;
  audience: RewardAudience;
  label: string;
  points: number;
  /** Shown under "How to earn" (deductions shown separately). */
  group: "Getting started" | "Every shift" | "Growing the network" | "Deductions";
}

export const REWARD_RULES: RewardRule[] = [
  // Providers: getting started (once each)
  { key: "p.email", audience: "PROVIDER", label: "Confirm your email", points: 10, group: "Getting started" },
  { key: "p.profile", audience: "PROVIDER", label: "Complete your profile and home base", points: 15, group: "Getting started" },
  { key: "p.photo", audience: "PROVIDER", label: "Add a profile photo", points: 10, group: "Getting started" },
  { key: "p.npi", audience: "PROVIDER", label: "Add your NPI", points: 10, group: "Getting started" },
  { key: "p.license", audience: "PROVIDER", label: "License verified", points: 25, group: "Getting started" },
  { key: "p.malpractice", audience: "PROVIDER", label: "Malpractice insurance verified", points: 25, group: "Getting started" },
  { key: "p.payouts", audience: "PROVIDER", label: "Set up payouts", points: 15, group: "Getting started" },
  { key: "p.agreement", audience: "PROVIDER", label: "Sign the Provider Agreement", points: 15, group: "Getting started" },
  { key: "p.availability", audience: "PROVIDER", label: "Set your availability", points: 10, group: "Getting started" },
  { key: "p.ready", audience: "PROVIDER", label: "Bonus: every setup step done", points: 50, group: "Getting started" },
  // Providers: every shift
  { key: "p.shift", audience: "PROVIDER", label: "Complete a shift", points: 50, group: "Every shift" },
  { key: "p.onTime", audience: "PROVIDER", label: "Clock in on time", points: 10, group: "Every shift" },
  { key: "p.punches", audience: "PROVIDER", label: "Clock in and out on the app (no missed punches)", points: 10, group: "Every shift" },
  { key: "p.fiveStar", audience: "PROVIDER", label: "5-star rating from the clinic", points: 15, group: "Every shift" },
  { key: "p.urgent", audience: "PROVIDER", label: "Cover a short-notice or emergency shift", points: 25, group: "Every shift" },
  // Providers: growing the network
  { key: "p.referral", audience: "PROVIDER", label: "A friend you referred completes their first shift", points: 100, group: "Growing the network" },
  { key: "p.trailblazer", audience: "PROVIDER", label: "Earn a Trailblazer badge", points: 100, group: "Growing the network" },
  // Providers: deductions
  { key: "p.lateCancel", audience: "PROVIDER", label: "Late cancellation", points: -50, group: "Deductions" },
  { key: "p.noShow", audience: "PROVIDER", label: "No-show", points: -100, group: "Deductions" },

  // Clinics: getting started
  { key: "c.email", audience: "CLINIC", label: "Confirm your email", points: 10, group: "Getting started" },
  { key: "c.location", audience: "CLINIC", label: "Add your clinic location", points: 15, group: "Getting started" },
  { key: "c.payment", audience: "CLINIC", label: "Add a payment method", points: 15, group: "Getting started" },
  { key: "c.agreement", audience: "CLINIC", label: "Sign the Clinic Agreement", points: 15, group: "Getting started" },
  { key: "c.firstPost", audience: "CLINIC", label: "Post your first shift", points: 50, group: "Getting started" },
  // Clinics: every shift
  { key: "c.shift", audience: "CLINIC", label: "A covered shift is completed", points: 25, group: "Every shift" },
  { key: "c.early", audience: "CLINIC", label: "Post at least 7 days ahead", points: 10, group: "Every shift" },
  { key: "c.signoff", audience: "CLINIC", label: "Sign off the timesheet within 24 hours", points: 10, group: "Every shift" },
  { key: "c.rated", audience: "CLINIC", label: "Rate your provider", points: 5, group: "Every shift" },
  // Clinics: growing the network
  { key: "c.referral", audience: "CLINIC", label: "A clinic or provider you referred completes their first shift", points: 100, group: "Growing the network" },
  // Clinics: deductions
  { key: "c.lateCancel", audience: "CLINIC", label: "Late cancellation of a booked shift", points: -50, group: "Deductions" },
];

export const DEFAULT_REWARD_POINTS: Record<string, number> = Object.fromEntries(REWARD_RULES.map((r) => [r.key, r.points]));

export const REWARD_LEVELS = ["Bronze", "Silver", "Gold", "Platinum"] as const;
export type RewardLevel = (typeof REWARD_LEVELS)[number];
export interface LevelThresholds {
  silver: number;
  gold: number;
  platinum: number;
}
export const DEFAULT_LEVELS: LevelThresholds = { silver: 500, gold: 1500, platinum: 4000 };

/** Level from lifetime points, and how far to the next one. */
export function rewardLevel(points: number, t: LevelThresholds): { level: RewardLevel; next: RewardLevel | null; pointsToNext: number; progress: number } {
  const steps: [RewardLevel, number][] = [["Bronze", 0], ["Silver", t.silver], ["Gold", t.gold], ["Platinum", t.platinum]];
  let i = 0;
  while (i + 1 < steps.length && points >= steps[i + 1][1]) i++;
  if (i === steps.length - 1) return { level: "Platinum", next: null, pointsToNext: 0, progress: 1 };
  const [, from] = steps[i];
  const [next, to] = steps[i + 1];
  return { level: steps[i][0], next, pointsToNext: Math.max(0, to - points), progress: Math.min(1, Math.max(0, (points - from) / (to - from))) };
}

export interface RewardEventDraft {
  refKey: string;
  kind: string;
  points: number;
  note?: string;
}

const H = 3_600_000;

export interface ProviderRewardFacts {
  id: string;
  emailVerified: boolean;
  profile: boolean;
  photo: boolean;
  npi: boolean;
  licenseVerified: boolean;
  malpracticeVerified: boolean;
  payouts: boolean;
  agreement: boolean;
  availability: boolean;
  ready: boolean;
  assignments: {
    id: string;
    status: string;
    startsAt: Date;
    cancelledAt: Date | null;
    cancelledBy: string | null;
    firstInAt: Date | null;
    /** Clocked in and out on the app (no added, admin or automatic punches). */
    cleanPunches: boolean;
    clinicStars: number | null;
    urgent: boolean;
  }[];
  rewardedReferralIds: string[];
  trailblazerStates: string[];
}

export function providerRewardEvents(f: ProviderRewardFacts, points: Record<string, number>, opts: { lateGraceMinutes: number; lateCancelHours: number }): RewardEventDraft[] {
  const out: RewardEventDraft[] = [];
  const add = (kind: string, ref: string, note?: string) => {
    const p = points[kind] ?? DEFAULT_REWARD_POINTS[kind] ?? 0;
    if (p !== 0) out.push({ refKey: `${kind}:${ref}`, kind, points: p, note });
  };
  const once: [string, boolean][] = [
    ["p.email", f.emailVerified], ["p.profile", f.profile], ["p.photo", f.photo], ["p.npi", f.npi], ["p.license", f.licenseVerified],
    ["p.malpractice", f.malpracticeVerified], ["p.payouts", f.payouts], ["p.agreement", f.agreement], ["p.availability", f.availability], ["p.ready", f.ready],
  ];
  for (const [k, done] of once) if (done) add(k, f.id);
  for (const a of f.assignments) {
    if (a.status === "COMPLETED") {
      add("p.shift", a.id);
      if (a.firstInAt && +a.firstInAt <= +a.startsAt + opts.lateGraceMinutes * 60_000) add("p.onTime", a.id);
      if (a.cleanPunches) add("p.punches", a.id);
      if (a.clinicStars === 5) add("p.fiveStar", a.id);
      if (a.urgent) add("p.urgent", a.id);
    }
    if (a.status === "NO_SHOW") add("p.noShow", a.id);
    if (a.status === "CANCELLED" && a.cancelledBy === "PROVIDER" && a.cancelledAt && +a.startsAt - +a.cancelledAt < opts.lateCancelHours * H) add("p.lateCancel", a.id);
  }
  for (const r of f.rewardedReferralIds) add("p.referral", r);
  for (const s of f.trailblazerStates) add("p.trailblazer", `${f.id}:${s}`, s);
  return out;
}

export interface ClinicRewardFacts {
  id: string;
  emailVerified: boolean;
  location: boolean;
  paymentMethod: boolean;
  agreement: boolean;
  posted: boolean;
  assignments: {
    id: string;
    status: string;
    startsAt: Date;
    postedAt: Date | null;
    cancelledAt: Date | null;
    cancelledBy: string | null;
    timesheetSubmittedAt: Date | null;
    timesheetApprovedAt: Date | null;
    /** Signed by the clinic (portal, email link or on site), not automatically. */
    clinicSigned: boolean;
    ratedProvider: boolean;
  }[];
  rewardedReferralIds: string[];
}

export function clinicRewardEvents(f: ClinicRewardFacts, points: Record<string, number>, opts: { lateCancelHours: number }): RewardEventDraft[] {
  const out: RewardEventDraft[] = [];
  const add = (kind: string, ref: string) => {
    const p = points[kind] ?? DEFAULT_REWARD_POINTS[kind] ?? 0;
    if (p !== 0) out.push({ refKey: `${kind}:${ref}`, kind, points: p });
  };
  const once: [string, boolean][] = [["c.email", f.emailVerified], ["c.location", f.location], ["c.payment", f.paymentMethod], ["c.agreement", f.agreement], ["c.firstPost", f.posted]];
  for (const [k, done] of once) if (done) add(k, f.id);
  for (const a of f.assignments) {
    if (a.status === "COMPLETED") {
      add("c.shift", a.id);
      if (a.postedAt && +a.startsAt - +a.postedAt >= 7 * 24 * H) add("c.early", a.id);
      if (a.clinicSigned && a.timesheetSubmittedAt && a.timesheetApprovedAt && +a.timesheetApprovedAt - +a.timesheetSubmittedAt <= 24 * H) add("c.signoff", a.id);
      if (a.ratedProvider) add("c.rated", a.id);
    }
    if (a.status === "CANCELLED" && a.cancelledBy === "CLINIC" && a.cancelledAt && +a.startsAt - +a.cancelledAt < opts.lateCancelHours * H) add("c.lateCancel", a.id);
  }
  for (const r of f.rewardedReferralIds) add("c.referral", r);
  return out;
}
