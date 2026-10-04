import Link from "next/link";
import { rewards } from "@cm/services";
import { LevelBadge } from "./rewards-view";

/** One line on the dashboard: level, points, and what's next. */
export async function RewardsChip({ audience, accountId, href }: { audience: "PROVIDER" | "CLINIC"; accountId: string; href: string }) {
  const r = await rewards.rewardsChip(audience, accountId).catch(() => null);
  if (!r) return null;
  return (
    <Link href={href} className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-slate-200 bg-white px-4 py-3 text-sm hover:border-accent-300">
      <LevelBadge level={r.level} />
      <span className="font-semibold tabular-nums">{r.points.toLocaleString("en-US")} points</span>
      <span className="text-slate-500">{r.next ? `${r.pointsToNext.toLocaleString("en-US")} to ${r.next}` : "Top level"}</span>
      <span className="ml-auto font-medium text-brand-700">Rewards →</span>
    </Link>
  );
}
