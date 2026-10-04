/**
 * Provider badges and status labels shown on the public profile and on
 * candidate cards. Status labels reflect verification; earned badges come
 * from activity on the platform. Pure: the caller supplies the numbers.
 * Responsiveness data only ever produces a positive badge — it is never
 * shown as a raw number to clinics (Addendum 02 §6.3).
 */

export interface BadgeInput {
  completedShifts: number;
  lateCancels12m: number;
  noShows12m: number;
  ratingAvg: number | null;
  ratingCount: number;
  punctualityAvg: number | null;
  punctualityCount: number;
  offersReceived: number;
  offersResponded: number;
  medianResponseMinutes: number | null;
  maxYearsInPractice: number | null;
  favoritedByClinics: number;
  verifiedProfessions: number;
  verifiedStates: number;
  licenseVerified: boolean;
  malpracticeVerified: boolean;
  npiVerified: boolean;
  onCallActive: boolean;
  /** States where they earned the Trailblazer badge (state names). */
  trailblazerStates?: string[];
  /** How many places the badge has per state. */
  trailblazerSpots?: number;
}

export type BadgeKind = "status" | "earned";
export type BadgeTone = "green" | "brand" | "blue" | "amber" | "gray";

export interface Badge {
  key: string;
  label: string;
  description: string;
  kind: BadgeKind;
  tone: BadgeTone;
}

export const BADGE_THRESHOLDS = {
  topRated: { minRatings: 5, minAvg: 4.8 },
  punctual: { minRatings: 3, minAvg: 4.7 },
  responsive: { minOffers: 5, minRate: 0.9, fastMinutes: 15 },
  reliable: { minCompleted: 5 },
  experienced: 10,
  veteran: 50,
  seasoned: 10, // years in practice
  clinicFavorite: 3,
  newToPlatform: 3,
};

export function providerBadges(i: BadgeInput): Badge[] {
  const t = BADGE_THRESHOLDS;
  const out: Badge[] = [];
  const add = (key: string, label: string, description: string, kind: BadgeKind, tone: BadgeTone) => out.push({ key, label, description, kind, tone });

  // Status labels (verification).
  if (i.licenseVerified) add("license", "License verified", "State license verified with the board for each profession and state shown.", "status", "green");
  if (i.malpracticeVerified) add("malpractice", "Insured", "Malpractice coverage verified.", "status", "green");
  if (i.npiVerified) add("npi", "NPI verified", "NPI confirmed against the national registry.", "status", "green");
  if (i.onCallActive) add("oncall", "On Call", "Can be confirmed instantly for matching shifts.", "status", "brand");
  if (i.completedShifts < t.newToPlatform) add("new", "New to platform", "Fewer than 3 completed shifts so far.", "status", "blue");

  // Earned badges (activity).
  if (i.ratingCount >= t.topRated.minRatings && (i.ratingAvg ?? 0) >= t.topRated.minAvg) {
    add("top_rated", "Top rated", `Averages ${i.ratingAvg!.toFixed(1)}★ across ${i.ratingCount} clinic ratings.`, "earned", "amber");
  }
  if (i.punctualityCount >= t.punctual.minRatings && (i.punctualityAvg ?? 0) >= t.punctual.minAvg) {
    add("punctual", "Punctual", "Consistently rated on time by clinics.", "earned", "brand");
  }
  if (i.offersReceived >= t.responsive.minOffers && i.offersResponded / i.offersReceived >= t.responsive.minRate) {
    const fast = i.medianResponseMinutes !== null && i.medianResponseMinutes <= t.responsive.fastMinutes;
    add("responsive", fast ? "Responds quickly" : "Responsive", fast ? "Answers shift offers within minutes." : "Answers nearly every shift offer.", "earned", "brand");
  }
  if (i.completedShifts >= t.reliable.minCompleted && i.lateCancels12m === 0 && i.noShows12m === 0) {
    add("reliable", "Reliable", "No late cancellations or no-shows in the last 12 months.", "earned", "green");
  }
  if (i.completedShifts >= t.veteran) add("veteran", `${t.veteran}+ shifts`, "Completed 50 or more coverage shifts.", "earned", "amber");
  else if (i.completedShifts >= t.experienced) add("experienced", `${t.experienced}+ shifts`, "Completed 10 or more coverage shifts.", "earned", "brand");
  if ((i.maxYearsInPractice ?? 0) >= t.seasoned) add("seasoned", `${i.maxYearsInPractice}+ years in practice`, "Experienced clinician.", "earned", "gray");
  if (i.favoritedByClinics >= t.clinicFavorite) add("clinic_favorite", "Clinic favorite", `Favorited by ${i.favoritedByClinics} clinics.`, "earned", "amber");
  if (i.verifiedProfessions >= 2) add("multi_profession", "Dual-licensed", "Verified in more than one profession.", "earned", "gray");
  if (i.trailblazerStates?.length) {
    const where = i.trailblazerStates.join(" and ");
    add("trailblazer", "Trailblazer", `One of the first ${i.trailblazerSpots ?? 25} providers to join in ${where}, before it opened.`, "earned", "amber");
  }
  if (i.verifiedStates >= 2) add("multi_state", "Multi-state", `Licensed in ${i.verifiedStates} states.`, "earned", "gray");
  return out;
}

/** Only LinkedIn profile URLs are accepted (https://www.linkedin.com/in/…). */
export function normalizeLinkedIn(raw: string | null | undefined): string | null {
  const v = (raw ?? "").trim();
  if (!v) return null;
  let u: URL;
  try {
    u = new URL(v.startsWith("http") ? v : `https://${v}`);
  } catch {
    return null;
  }
  if (!/(^|\.)linkedin\.com$/i.test(u.hostname) || !/^\/(in|pub)\/[A-Za-z0-9\-_%]+\/?$/.test(u.pathname)) return null;
  return `https://www.linkedin.com${u.pathname.replace(/\/$/, "")}`;
}
