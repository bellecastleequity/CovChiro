/**
 * Provider acquisition rules (pure). Discovery finds licensed providers in the public
 * NPI registry; contact discovery looks for a professional email that reaches the
 * provider themselves; recruitment emails go only where these rules allow. Supply status
 * and market readiness drive which markets get recruited first. Messaging and planning
 * only — none of this ever decides credential eligibility (INV-1).
 */
import { acceptBusinessEmail } from "./prospecting";

export type ProviderProspectStage = "DISCOVERED" | "CONTACT_FOUND" | "CONTACT_VERIFIED" | "CONTACTED" | "ENGAGED" | "REGISTERED" | "NOT_INTERESTED" | "DO_NOT_CONTACT";

/** The full provider acquisition funnel (prospect stages, then the registered provider's progress). */
export const PROVIDER_FUNNEL = ["DISCOVERED", "CONTACT_FOUND", "CONTACT_VERIFIED", "CONTACTED", "ENGAGED", "REGISTERED", "CREDENTIALING", "COVERAGE_READY", "FIRST_SHIFT", "REPEAT_PROVIDER"] as const;
export type ProviderFunnelStage = (typeof PROVIDER_FUNNEL)[number];

export function providerFunnelStage(f: { prospectStage?: ProviderProspectStage | null; registered?: boolean; coverageReady?: boolean; completedShifts?: number }): ProviderFunnelStage {
  if (f.registered || f.prospectStage === "REGISTERED") {
    const shifts = f.completedShifts ?? 0;
    if (shifts >= 2) return "REPEAT_PROVIDER";
    if (shifts >= 1) return "FIRST_SHIFT";
    if (f.coverageReady) return "COVERAGE_READY";
    return f.registered ? "CREDENTIALING" : "REGISTERED";
  }
  const st = f.prospectStage ?? "DISCOVERED";
  if (st === "NOT_INTERESTED" || st === "DO_NOT_CONTACT") return "CONTACTED";
  return st;
}

const FREE_MAIL = /(^|\.)(gmail|googlemail|yahoo|ymail|hotmail|outlook|live|msn|aol|icloud|me|mac|comcast|bellsouth|att|verizon|protonmail|proton|gmx|mail|zoho)\.(com|net|me)$/;
const NEVER = /^(no-?reply|donotreply|postmaster|webmaster|abuse|privacy|billing|accounts?|marketing|careers|jobs|hr)\d*$/;
const norm = (s: string) => s.toLowerCase().normalize("NFKD").replace(/[^a-z]/g, "");

/**
 * Recruitment email goes to an address that reaches the provider themselves:
 *  - one in their own name (any part of their surname in the mailbox), on a business domain; or
 *  - a solo practice's own business mailbox, when they're its owner.
 * Never a shared inbox at a group practice (that reaches their employer), never personal free-mail.
 */
export function acceptProviderEmail(c: {
  email: string; firstName: string | null; lastName: string | null; website: string | null;
  practiceRole: "OWNER" | "ASSOCIATE" | "UNKNOWN"; providersAtPractice: number;
}): { ok: boolean; reason: string } {
  const e = c.email.trim().toLowerCase();
  const m = /^([a-z0-9._%+-]+)@([a-z0-9.-]+\.[a-z]{2,})$/.exec(e);
  if (!m) return { ok: false, reason: "invalid" };
  const [, local, domain] = m;
  if (NEVER.test(local)) return { ok: false, reason: "role_mailbox" };
  if (FREE_MAIL.test(domain)) return { ok: false, reason: "personal_freemail" };
  const last = norm(c.lastName ?? "");
  if (last.length >= 3 && norm(local).includes(last)) return { ok: true, reason: "attributed" };
  if (c.practiceRole === "OWNER" && c.providersAtPractice <= 1 && acceptBusinessEmail(e, c.website)) return { ok: true, reason: "solo_practice" };
  return { ok: false, reason: "shared_practice_inbox" };
}

// ---------------- supply & demand ----------------

export type SupplyStatus = "CRITICAL" | "LOW" | "BUILDING" | "HEALTHY" | "LIQUID";
const ORDER: SupplyStatus[] = ["CRITICAL", "LOW", "BUILDING", "HEALTHY", "LIQUID"];

/**
 * Coverage-ready providers against the market's target, made worse by shifts that went
 * unfilled (last 30 days) or by upcoming requests far beyond supply.
 */
export function supplyStatus(m: { ready: number; target: number; upcomingRequests: number; filled30: number; unfilled30: number }): SupplyStatus {
  const ratio = m.ready / Math.max(1, m.target);
  const decided = m.filled30 + m.unfilled30;
  const fillRate = decided ? m.filled30 / decided : 1;
  let s: SupplyStatus = ratio < 0.25 ? "CRITICAL" : ratio < 0.6 ? "LOW" : ratio < 1 ? "BUILDING" : ratio >= 1.5 && m.filled30 >= 5 && fillRate >= 0.9 ? "LIQUID" : "HEALTHY";
  if (m.unfilled30 >= 2 && m.unfilled30 >= m.filled30) s = "CRITICAL";
  else if (m.unfilled30 > 0 && fillRate < 0.8 && ORDER.indexOf(s) > 1) s = "LOW";
  if (m.upcomingRequests > Math.max(2, m.ready * 2) && ORDER.indexOf(s) > 0) s = ORDER[ORDER.indexOf(s) - 1];
  return s;
}

export function recruitmentPriority(s: SupplyStatus): "CRITICAL" | "HIGH" | "MEDIUM" | "LOW" {
  return s === "CRITICAL" ? "CRITICAL" : s === "LOW" ? "HIGH" : s === "BUILDING" ? "MEDIUM" : "LOW";
}

export function demandLevel(d: { upcomingRequests: number; clinics: number }): "High" | "Medium" | "Low" {
  if (d.upcomingRequests >= 5) return "High";
  if (d.upcomingRequests >= 1 || d.clinics >= 3) return "Medium";
  return "Low";
}

export type MarketReadiness = "PLANNED" | "BUILDING_SUPPLY" | "READY_FOR_DEMAND" | "ACTIVE" | "LIQUID" | "PAUSED";

/** Where a profession × state × metro market stands, from its growth target and live numbers. */
export function marketReadiness(m: { targetStatus: "OFF" | "PRELAUNCH" | "LIVE"; paused: boolean; ready: number; target: number; supply: SupplyStatus; completed30: number }): MarketReadiness {
  if (m.paused) return "PAUSED";
  if (m.targetStatus === "OFF") return "PLANNED";
  if (m.ready < m.target) return "BUILDING_SUPPLY";
  if (m.targetStatus === "PRELAUNCH") return "READY_FOR_DEMAND";
  if (m.supply === "LIQUID") return "LIQUID";
  return m.completed30 > 0 ? "ACTIVE" : "READY_FOR_DEMAND";
}

/** Cost per outcome (null when there were none). */
export function costPer(totalCents: number, outcomes: number): number | null {
  return outcomes > 0 ? Math.round(totalCents / outcomes) : null;
}
