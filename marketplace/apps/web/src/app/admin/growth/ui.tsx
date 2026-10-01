import Link from "next/link";
import { cn } from "@/lib/cn";

const TABS = [
  ["/admin/growth", "Overview"],
  ["/admin/growth/sales", "Sales queue"],
  ["/admin/growth/approvals", "Approvals"],
  ["/admin/growth/escalations", "Escalations"],
  ["/admin/growth/prospects", "Clinic prospects"],
  ["/admin/growth/providers", "Provider pipeline"],
  ["/admin/growth/expansion", "Expansion"],
  ["/admin/growth/markets", "Markets"],
  ["/admin/growth/campaigns", "Campaigns"],
  ["/admin/growth/prompts", "Prompts"],
  ["/admin/growth/knowledge", "Knowledge base"],
  ["/admin/growth/suppression", "Suppression"],
  ["/admin/growth/activity", "Activity"],
] as const;

export function GrowthTabs({ current, badges = {} }: { current: string; badges?: Record<string, number> }) {
  return (
    <nav className="-mx-1 mb-6 flex flex-wrap gap-1.5" aria-label="Growth sections">
      {TABS.map(([href, label]) => (
        <Link key={href} href={href} className={cn("rounded-full px-3 py-1.5 text-xs font-medium ring-1", href === current ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200 hover:text-slate-900")}>
          {label}
          {badges[href] ? <span className={cn("ml-1.5 rounded-full px-1.5", href === current ? "bg-white/20" : "bg-accent-100 text-accent-800")}>{badges[href]}</span> : null}
        </Link>
      ))}
      <Link href="/admin/settings" className="rounded-full px-3 py-1.5 text-xs font-medium text-slate-500 hover:text-slate-900">Growth settings →</Link>
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
