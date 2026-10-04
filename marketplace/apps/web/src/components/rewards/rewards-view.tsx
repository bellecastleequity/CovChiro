import { Trophy } from "lucide-react";
import type { rewards } from "@cm/services";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { cn } from "@/lib/cn";
import { dateLabel } from "@/lib/format";

type Summary = Awaited<ReturnType<typeof rewards.myProviderRewards>>;

const LEVEL_STYLE: Record<string, string> = {
  Bronze: "bg-amber-100 text-amber-900 ring-amber-300",
  Silver: "bg-slate-100 text-slate-800 ring-slate-300",
  Gold: "bg-yellow-100 text-yellow-900 ring-yellow-400",
  Platinum: "bg-brand-50 text-brand-800 ring-brand-300",
};

const pts = (n: number) => `${n > 0 ? "+" : ""}${n.toLocaleString("en-US")}`;

export function LevelBadge({ level, className }: { level: string; className?: string }) {
  return <span className={cn("inline-flex items-center gap-1 rounded-full px-2.5 py-0.5 text-xs font-semibold ring-1 ring-inset", LEVEL_STYLE[level] ?? LEVEL_STYLE.Bronze, className)}><Trophy className="size-3" />{level}</span>;
}

/** The Rewards page body (providers and clinics). */
export function RewardsView({ r, who }: { r: Summary; who: "provider" | "clinic" }) {
  const groups = [...new Set(r.rules.map((x) => x.group))];
  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="space-y-6 lg:col-span-2">
        <Card>
          <CardBody className="space-y-4">
            <div className="flex flex-wrap items-center justify-between gap-3">
              <div>
                <div className="text-sm text-slate-500">Your level</div>
                <div className="mt-1 flex items-center gap-3"><LevelBadge level={r.level} className="text-sm" /><span className="text-2xl font-semibold tabular-nums">{r.points.toLocaleString("en-US")} points</span></div>
              </div>
              {r.next ? <div className="text-right text-sm text-slate-600"><b className="tabular-nums">{r.pointsToNext.toLocaleString("en-US")}</b> points to {r.next}</div> : <div className="text-sm font-medium text-brand-700">Top level reached. Thank you!</div>}
            </div>
            {r.next ? (
              <div className="h-2.5 overflow-hidden rounded-full bg-slate-100" role="progressbar" aria-valuenow={Math.round(r.progress * 100)} aria-valuemin={0} aria-valuemax={100} aria-label={`Progress to ${r.next}`}>
                <div className="h-full rounded-full bg-accent-500" style={{ width: `${Math.round(r.progress * 100)}%` }} />
              </div>
            ) : null}
            <div className="grid grid-cols-4 gap-2 text-center text-xs text-slate-500">
              {([["Bronze", 0], ["Silver", r.levels.silver], ["Gold", r.levels.gold], ["Platinum", r.levels.platinum]] as const).map(([name, at]) => (
                <div key={name} className={cn("rounded-lg border p-2", r.level === name ? "border-accent-400 bg-accent-50 text-slate-800" : "border-slate-200")}><div className="font-semibold">{name}</div><div className="tabular-nums">{at.toLocaleString("en-US")}+</div></div>
              ))}
            </div>
            <p className="text-xs text-slate-500">
              Points add up as you use {who === "provider" ? "the platform and cover shifts" : "the platform and book coverage"}. We use levels for giveaways, bonus promos and other thank-yous, announced from time to time. Points have no cash value.
            </p>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Points history" />
          {r.history.length ? (
            <div className="divide-y divide-slate-100">
              {r.history.map((h) => (
                <div key={h.id} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm">
                  <div><div className="text-slate-800">{h.label}{h.note ? <span className="text-slate-500"> · {h.note}</span> : null}</div><div className="text-xs text-slate-500">{dateLabel(h.at)}</div></div>
                  <span className={cn("font-semibold tabular-nums", h.points < 0 ? "text-red-700" : "text-emerald-700")}>{pts(h.points)}</span>
                </div>
              ))}
            </div>
          ) : (
            <CardBody className="text-sm text-slate-500">No points yet. Start with the setup steps on the right.</CardBody>
          )}
        </Card>
      </div>
      <Card className="h-fit">
        <CardHeader title="How to earn" />
        <CardBody className="space-y-4 text-sm">
          {groups.map((g) => (
            <div key={g}>
              <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{g}</div>
              <ul className="space-y-1">
                {r.rules.filter((x) => x.group === g).map((x) => (
                  <li key={x.key} className="flex justify-between gap-3"><span className="text-slate-700">{x.label}</span><span className={cn("shrink-0 font-semibold tabular-nums", x.points < 0 ? "text-red-700" : "text-emerald-700")}>{pts(x.points)}</span></li>
                ))}
              </ul>
            </div>
          ))}
        </CardBody>
      </Card>
    </div>
  );
}
