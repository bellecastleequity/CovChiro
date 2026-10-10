import { minPostingLeadOk } from "./deadlines";
import type { FilterId } from "./eligibility";

/**
 * Open states, gated by supply (owner decision Oct 2026): every state is open for posting, but a
 * clinic can only post a shift when at least one doctor can actually take it. Pure rules here;
 * services/supply.ts runs getEligibleProviders on the would-be shift and asks these.
 */

export type SupplyGap = "NONE_NEARBY" | "BOOKED" | "UNAVAILABLE" | "REQUIREMENTS" | "TOO_FEW";

export interface SupplyFacts {
  /** Providers the shift needs (the wizard's "Providers needed"). */
  needed: number;
  /** Providers who passed every filter for the shift. */
  eligible: number;
  /** Failed filters of each provider who passed the licence/insurance/distance prefilter but not the rest. */
  excluded: FilterId[][];
  /** The clinic set its own (lower) rate on this shift. */
  clinicRate?: boolean;
  /** Days in the booking (wording: this shift / these shifts). */
  days?: number;
}

export interface SupplyResult {
  ok: boolean;
  available: number;
  gap: SupplyGap | null;
  headline: string;
  /** What the clinic could change (may be empty). */
  hint: string;
  /** hint + how the clinic is told when a provider is available (wizard, before saving). */
  detail: string;
}

type Bucket = "GONE" | "BOOKED" | "UNAVAILABLE" | "REQUIREMENTS";

/** What stops one provider: not really there (too far, not finished joining) beats booked beats unavailable beats the shift's own requirements. */
function bucketOf(filters: FilterId[]): Bucket {
  if (filters.some((f) => f === "F3" || f === "F7")) return "GONE";
  if (filters.includes("F5")) return "BOOKED";
  if (filters.includes("F4") || filters.includes("F9") || filters.includes("F10")) return "UNAVAILABLE";
  return "REQUIREMENTS";
}

const NOTIFY = "We'll save it and text and email you the moment a provider is available.";

/** Shown once the draft is saved: posted automatically when a provider is available, or one tap from the clinic. */
export function savedForProviderNote(autoPost: boolean, days = 1): string {
  const it = days > 1 ? "them" : "it";
  return autoPost
    ? `We saved ${it} and will post ${it} automatically the moment a provider is available, then text and email you.`
    : `We saved ${it} as ${days > 1 ? "drafts" : "a draft"} and will text and email you the moment a provider is available, so you can post ${it} in one tap.`;
}

function result(available: number, gap: SupplyGap, headline: string, hint: string): SupplyResult {
  return { ok: false, available, gap, headline, hint, detail: hint ? `${hint} Or ${lower(NOTIFY)}` : NOTIFY };
}

export function supplyCheck(f: SupplyFacts): SupplyResult {
  const available = Math.max(0, f.eligible);
  const what = (f.days ?? 1) > 1 ? "these shifts" : "this shift";
  if (available >= f.needed) return { ok: true, available, gap: null, headline: "", hint: "", detail: "" };
  if (available > 0) {
    return result(available, "TOO_FEW", `Only ${available} provider${available === 1 ? " is" : "s are"} currently available for ${what}; you asked for ${f.needed}.`, `Lower "Providers needed" to ${available}.`);
  }
  const none = `No providers are currently available for ${what}.`;
  const counts: Record<Bucket, number> = { GONE: 0, BOOKED: 0, UNAVAILABLE: 0, REQUIREMENTS: 0 };
  for (const x of f.excluded) counts[bucketOf(x)]++;
  const order: Exclude<Bucket, "GONE">[] = ["BOOKED", "UNAVAILABLE", "REQUIREMENTS"];
  const top = order.reduce((a, b) => (counts[b] > counts[a] ? b : a), order[0]);
  // The gap code is for Growth (where to recruit); clinics always hear "not currently available".
  if (counts[top] === 0) return result(available, "NONE_NEARBY", none, "");
  if (top === "BOOKED") return result(available, "BOOKED", none, "Try another day or time.");
  if (top === "UNAVAILABLE") return result(available, "UNAVAILABLE", none, "Try another day or time.");
  const relax = new Set<string>();
  for (const x of f.excluded) {
    if (bucketOf(x) !== "REQUIREMENTS") continue;
    if (x.includes("F6") || x.includes("F1b")) relax.add("required skills");
    if (x.includes("F11")) relax.add("minimum experience");
    if (x.includes("F8")) relax.add("travel budget");
    // Pay floors are never shown to clinics; only a clinic-set rate gets a hint.
    if (x.includes("F12") && f.clinicRate) relax.add("the market price instead of your own rate");
  }
  const list = [...relax];
  return result(available, "REQUIREMENTS", `No available providers currently match the requirements for ${what}.`, list.length ? `Try changing: ${list.join(", ")}.` : "Try another day or time.");
}

const lower = (s: string) => s.charAt(0).toLowerCase() + s.slice(1);

/** Admin switch memory: a state ("GA") or a profession in a state ("DC:GA") the admin turned off stays off. */
export function closedListAfterToggle(closed: string[], key: string, enabled: boolean): string[] {
  const set = new Set(closed);
  if (enabled) set.delete(key);
  else set.add(key);
  return [...set].sort();
}

/** States and profession-state pairs the automatic opening should switch on. */
export function marketsToOpen(m: {
  states: string[];
  closed: string[];
  professions: string[];
  stateRows: { state: string; enabled: boolean }[];
  pairRows: { professionCode: string; state: string; enabled: boolean }[];
}): { states: string[]; pairs: { professionCode: string; state: string }[] } {
  const closed = new Set(m.closed);
  const stateOn = new Map(m.stateRows.map((r) => [r.state, r.enabled]));
  const pairOn = new Map(m.pairRows.map((r) => [`${r.professionCode}:${r.state}`, r.enabled]));
  const open = m.states.filter((s) => !closed.has(s));
  return {
    states: open.filter((s) => !stateOn.get(s)),
    pairs: open.flatMap((state) => m.professions.filter((code) => !closed.has(`${code}:${state}`) && !pairOn.get(`${code}:${state}`)).map((professionCode) => ({ professionCode, state }))),
  };
}

/** A draft saved because no doctor was available: tell the clinic once one is; give up when it can no longer be posted. */
export function waitingDraftAction(d: { now: Date; startsAt: Date; available: number; notifiedAt: Date | null }): "NOTIFY" | "WAIT" | "RESET" | "EXPIRE" {
  if (!minPostingLeadOk(d.now, d.startsAt)) return "EXPIRE";
  if (d.available > 0) return d.notifiedAt ? "WAIT" : "NOTIFY";
  return d.notifiedAt ? "RESET" : "WAIT";
}
