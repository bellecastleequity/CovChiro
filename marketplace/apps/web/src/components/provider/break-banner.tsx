import Link from "next/link";
import { PauseCircle } from "lucide-react";
import { breaks } from "@cm/services";

/** On the dashboard while a break is on (or coming up): what it means and how to come back. */
export async function BreakBanner({ providerId }: { providerId: string }) {
  const st = await breaks.breakStatus(providerId).catch(() => null);
  if (!st || (!st.onBreak && !st.scheduled)) return null;
  const d = (x: Date) => x.toLocaleDateString("en-US", { timeZone: st.timeZone, weekday: "short", month: "short", day: "numeric" });
  return (
    <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
      <PauseCircle className="size-5 shrink-0" />
      <span className="flex-1">
        {st.onBreak ? `You're on a break since ${d(st.from!)}` : `Your break starts ${d(st.from!)}`}
        {st.until ? `, back ${d(st.until)}` : ""}. No new shifts are offered to you{st.onBreak ? "" : " from then"}; bookings you kept stay as they are.
      </span>
      <Link href="/provider/break" className="font-semibold text-brand-700">Resume coverage →</Link>
    </div>
  );
}
