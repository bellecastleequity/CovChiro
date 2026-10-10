import { CA_PROVINCES } from "./credentials";

/**
 * Geographic acquisition priorities (owner decision Oct 2026). Every market grows both sides of the
 * marketplace; its priority only decides which side gets most of the effort. Defaults: Florida =
 * DEMAND (clinics) first, every other U.S. state, Puerto Rico, the USVI and Canada = SUPPLY
 * (providers) first. Admins override per country ("country:CA"), state/province/territory ("GA",
 * "ON") or market (GrowthMarket.acquisitionPriority). Region codes: core US_STATES + CA_PROVINCES
 * (they never collide; "CA" alone is California, Canada is "country:CA").
 */
export type Side = "SUPPLY" | "DEMAND";
export const SIDES: Side[] = ["SUPPLY", "DEMAND"];
export type Country = "US" | "CA";
export type Jurisdiction = "US_STATE" | "US_TERRITORY" | "CANADA";

export function countryOf(region: string): Country {
  return CA_PROVINCES[region.toUpperCase()] ? "CA" : "US";
}

export function jurisdictionOf(region: string): Jurisdiction {
  const r = region.toUpperCase();
  if (CA_PROVINCES[r]) return "CANADA";
  return r === "PR" || r === "VI" ? "US_TERRITORY" : "US_STATE";
}

export type PriorityOverrides = Record<string, Side>;
export type PrioritySource = "market" | "recommendation" | "state" | "country" | "default";

/** The side a market works first, and where that came from. Admin choices always win over a recommendation. */
export function resolvePriority(p: {
  state: string;
  marketOverride?: Side | null;
  overrides: PriorityOverrides;
  recommendation?: { side: Side; kind: "IMBALANCE" | "PRIORITY" } | null;
  followRecommendations?: boolean;
}): { primary: Side; source: PrioritySource } {
  if (p.marketOverride) return { primary: p.marketOverride, source: "market" };
  if (p.followRecommendations && p.recommendation?.kind === "IMBALANCE") return { primary: p.recommendation.side, source: "recommendation" };
  const st = p.state.toUpperCase();
  if (p.overrides[st]) return { primary: p.overrides[st], source: "state" };
  const c = p.overrides[`country:${countryOf(st)}`];
  if (c) return { primary: c, source: "country" };
  return { primary: "SUPPLY", source: "default" };
}

/** Split n units of effort (searches, credits, emails) between the sides: the primary gets primaryShare %, the other at least 1 when n ≥ 2. */
export function sideSplit(n: number, primary: Side, primaryShare: number): Record<Side, number> {
  const other: Side = primary === "SUPPLY" ? "DEMAND" : "SUPPLY";
  if (n <= 0) return { [primary]: 0, [other]: 0 } as Record<Side, number>;
  let first = Math.round((n * Math.min(100, Math.max(0, primaryShare))) / 100);
  if (n >= 2) first = Math.min(n - 1, Math.max(1, first));
  else first = n;
  return { [primary]: first, [other]: n - first } as Record<Side, number>;
}

/** Sort key: the side a market prioritizes comes first (0), the other side second (1). */
export function priorityRank(primary: Side, side: Side): number {
  return primary === side ? 0 : 1;
}

/**
 * Two-sided health of one market from real marketplace numbers. Unmet demand (unfilled shifts, or
 * more open requests than ready providers) → recruit providers; ready providers with almost no
 * clinic demand → recruit clinics; otherwise follow the configured priority. Advisory: it never
 * changes the priority unless the admin lets agents follow recommendations.
 */
export function marketRecommendation(f: {
  primary: Side;
  readyProviders: number;
  targetProviders: number;
  activeClinics: number;
  upcomingRequests: number;
  upcomingOpen: number;
  unfilled30: number;
}): { side: Side; kind: "IMBALANCE" | "PRIORITY"; reason: string; differsFromPriority: boolean } {
  const out = (side: Side, kind: "IMBALANCE" | "PRIORITY", reason: string) => ({ side, kind, reason, differsFromPriority: side !== f.primary });
  if (f.unfilled30 > 0 || f.upcomingOpen > f.readyProviders) {
    return out("SUPPLY", "IMBALANCE", f.unfilled30 > 0 ? `${f.unfilled30} shift${f.unfilled30 === 1 ? "" : "s"} went unfilled in the last 30 days; recruit more eligible providers here.` : `${f.upcomingOpen} open request${f.upcomingOpen === 1 ? "" : "s"} and only ${f.readyProviders} coverage-ready provider${f.readyProviders === 1 ? "" : "s"}; recruit more eligible providers here.`);
  }
  const plenty = f.readyProviders >= Math.max(1, f.targetProviders);
  if (plenty && (f.activeClinics === 0 || f.upcomingRequests * 2 < f.readyProviders)) {
    return out("DEMAND", "IMBALANCE", `${f.readyProviders} coverage-ready provider${f.readyProviders === 1 ? "" : "s"} but ${f.activeClinics ? `only ${f.upcomingRequests} upcoming request${f.upcomingRequests === 1 ? "" : "s"}` : "no clinics booking yet"}; expand clinic outreach here.`);
  }
  return out(f.primary, "PRIORITY", f.primary === "SUPPLY" ? "Building provider supply first (configured priority)." : "Building clinic demand first (configured priority).");
}

/** CASL consent bases we accept for commercial email to Canada (recorded on the prospect by a person). */
export const CASL_CONSENT_BASES = ["EXPRESS", "CONSPICUOUS_PUBLICATION", "EXISTING_BUSINESS"] as const;

/**
 * Canada's anti-spam law: a commercial email needs consent. Outreach to Canadian prospects stays
 * blocked until an admin switches Canada outreach on AND records the consent basis on the prospect
 * (express consent, or an address conspicuously published by them for business without a
 * "no unsolicited messages" note, relevant to their role, or an existing business relationship).
 * Returns the block reason, or null.
 */
export function caslBlock(p: { state: string | null; purpose: string; consentBasis: string | null; canadaOutreach: boolean }): string | null {
  if (!p.state || countryOf(p.state) !== "CA" || p.purpose !== "COMMERCIAL") return null;
  if (!p.canadaOutreach) return "canada_outreach_off";
  if (!p.consentBasis || !(CASL_CONSENT_BASES as readonly string[]).includes(p.consentBasis)) return "casl_consent_missing";
  return null;
}
