/**
 * Admin → Providers / Clinics filters (owner request Oct 2026: counts, by state, active / inactive).
 * Each account falls in exactly one group, so the group counts add up to the total.
 */

export type ProviderGroup = "ready" | "break" | "inactive" | "onboarding" | "paused" | "suspended" | "deactivated";
export const PROVIDER_GROUPS: { key: ProviderGroup; label: string }[] = [
  { key: "ready", label: "Ready for shifts" },
  { key: "onboarding", label: "Onboarding" },
  { key: "break", label: "On a break" },
  { key: "inactive", label: "Inactive (paused)" },
  { key: "paused", label: "Paused (missed shifts)" },
  { key: "suspended", label: "Suspended" },
  { key: "deactivated", label: "Deactivated" },
];

export interface ProviderGroupFacts {
  status: string;
  breakStartsAt: Date | null;
  breakEndsAt: Date | null;
  breakReason: string | null;
}

export function providerGroup(p: ProviderGroupFacts, now: Date): ProviderGroup {
  if (p.status === "SUSPENDED") return "suspended";
  if (p.status === "DEACTIVATED") return "deactivated";
  if (p.status === "PAUSED") return "paused";
  if (p.status === "ONBOARDING") return "onboarding";
  const onBreak = !!p.breakStartsAt && +p.breakStartsAt <= +now && (!p.breakEndsAt || +p.breakEndsAt > +now);
  if (onBreak) return p.breakReason === "INACTIVE" ? "inactive" : "break";
  return "ready";
}

/** A provider's states: every license state they hold that wasn't rejected (national "US" left out), else their home state. */
export function providerStates(licenseStates: { state: string; status: string }[], homeState: string | null): string[] {
  const s = [...new Set(licenseStates.filter((l) => l.status !== "REJECTED" && l.state !== "US").map((l) => l.state))];
  if (s.length) return s.sort();
  return homeState ? [homeState] : [];
}

export type ClinicGroup = "active" | "quiet" | "onboarding" | "suspended" | "deactivated";
export const CLINIC_GROUPS: { key: ClinicGroup; label: string }[] = [
  { key: "active", label: "Active (posted in 90 days)" },
  { key: "quiet", label: "Inactive (no posts in 90 days)" },
  { key: "onboarding", label: "Onboarding" },
  { key: "suspended", label: "Suspended" },
  { key: "deactivated", label: "Deactivated" },
];

export function clinicGroup(c: { status: string; lastPostedAt: Date | null }, now: Date, activeDays = 90): ClinicGroup {
  if (c.status === "SUSPENDED") return "suspended";
  if (c.status === "DEACTIVATED") return "deactivated";
  if (c.lastPostedAt && +now - +c.lastPostedAt <= activeDays * 86_400_000) return "active";
  if (c.status === "ONBOARDING") return "onboarding";
  return "quiet";
}

/** Count of each value (e.g. states), largest first, then A–Z. */
export function tally(values: string[][]): { key: string; count: number }[] {
  const m = new Map<string, number>();
  for (const vs of values) for (const v of new Set(vs)) m.set(v, (m.get(v) ?? 0) + 1);
  return [...m].map(([key, count]) => ({ key, count })).sort((a, b) => b.count - a.count || a.key.localeCompare(b.key));
}
