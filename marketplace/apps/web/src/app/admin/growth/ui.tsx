import Link from "next/link";
import { cn } from "@/lib/cn";

const TABS = [
  ["/admin/growth", "Overview"],
  ["/admin/growth/providers", "Providers"],
  ["/admin/growth/clinics", "Clinics"],
  ["/admin/growth/prospects", "Prospecting"],
  ["/admin/growth/campaigns", "Campaigns"],
  ["/admin/growth/agents", "AI Agents"],
  ["/admin/growth/markets", "Supply & Demand"],
  ["/admin/growth/content", "Content"],
  ["/admin/growth/escalations", "Leads / Conversations"],
  ["/admin/growth/analytics", "Analytics"],
  ["/admin/growth/settings", "Settings"],
] as const;

/** Working pages that sit under the main sections (kept at their original URLs). */
const MORE = [
  ["/admin/growth/approvals", "Approvals"],
  ["/admin/growth/sales", "Sales queue"],
  ["/admin/growth/activity", "Activity"],
  ["/admin/growth/expansion", "Expansion"],
  ["/admin/growth/prompts", "Prompts"],
  ["/admin/growth/knowledge", "Knowledge base"],
  ["/admin/growth/suppression", "Suppression"],
] as const;

export function GrowthTabs({ current, badges = {} }: { current: string; badges?: Record<string, number> }) {
  const active = (href: string) => href === current || (href !== "/admin/growth" && current.startsWith(`${href}/`));
  return (
    <nav className="-mx-1 mb-6 space-y-2" aria-label="Growth sections">
      <div className="flex flex-wrap gap-1.5">
        {TABS.map(([href, label]) => (
          <Link key={href} href={href} className={cn("rounded-full px-3 py-1.5 text-xs font-medium ring-1", active(href) ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200 hover:text-slate-900")}>
            {label}
            {badges[href] ? <span className={cn("ml-1.5 rounded-full px-1.5", active(href) ? "bg-white/20" : "bg-accent-100 text-accent-800")}>{badges[href]}</span> : null}
          </Link>
        ))}
      </div>
      <div className="flex flex-wrap items-center gap-x-3 gap-y-1 px-1 text-xs">
        {MORE.map(([href, label]) => (
          <Link key={href} href={href} className={cn("hover:text-brand-700", active(href) ? "font-semibold text-brand-700" : "text-slate-500")}>
            {label}{badges[href] ? <span className="ml-1 rounded-full bg-accent-100 px-1.5 text-accent-800">{badges[href]}</span> : null}
          </Link>
        ))}
      </div>
    </nav>
  );
}

/** One-hue horizontal bars for a funnel: values in ink, a native tooltip per bar. */
export function FunnelBars({ steps }: { steps: { label: string; count: number }[] }) {
  const max = Math.max(1, ...steps.map((s) => s.count));
  return (
    <div className="space-y-2">
      {steps.map((s, i) => {
        const prev = i ? steps[i - 1].count : null;
        const conv = prev ? Math.round((100 * s.count) / prev) : null;
        return (
          <div key={s.label} className="grid grid-cols-[minmax(0,11rem)_1fr_3.5rem] items-center gap-3 text-sm" title={`${s.label}: ${s.count}${conv !== null ? ` (${conv}% of previous step)` : ""}`}>
            <div className="truncate text-slate-600">{s.label}</div>
            <div className="h-2.5 rounded-r-full bg-slate-100">
              <div className="h-2.5 rounded-r-full bg-brand-600" style={{ width: `${Math.max(s.count ? 1.5 : 0, (100 * s.count) / max)}%` }} />
            </div>
            <div className="text-right font-medium tabular-nums text-slate-900">{s.count}</div>
          </div>
        );
      })}
    </div>
  );
}

export const usd = (cents: number | null | undefined) => (cents == null ? "—" : `$${(cents / 100).toLocaleString("en-US", { minimumFractionDigits: cents % 100 ? 2 : 0, maximumFractionDigits: 2 })}`);
export const pctLabel = (n: number | null | undefined) => (n == null ? "—" : `${n}%`);

export const STAGES = ["PROSPECT", "CONTACTABLE", "OUTREACH_STARTED", "ENGAGED", "INTERESTED", "ACCOUNT_STARTED", "ACCOUNT_CREATED", "COVERAGE_REQUESTED", "FIRST_SHIFT_BOOKED", "FIRST_SHIFT_COMPLETED", "REPEAT_CLINIC", "DORMANT", "NOT_INTERESTED", "DO_NOT_CONTACT"];
export const SEGMENTS = ["solo", "multi_dc", "multi_location", "franchise", "multidisciplinary", "high_volume", "specialty", "unknown"];

/** Small status badge tone for supply status / readiness. */
export const supplyTone = (s: string | null | undefined) =>
  (s === "CRITICAL" ? "red" : s === "LOW" ? "amber" : s === "BUILDING" || s === "BUILDING_SUPPLY" || s === "PLANNED" ? "blue" : s === "HEALTHY" || s === "ACTIVE" || s === "READY_FOR_DEMAND" ? "green" : s === "LIQUID" ? "brand" : "gray") as "red" | "amber" | "blue" | "green" | "brand" | "gray";
