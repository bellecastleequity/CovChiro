import Link from "next/link";
import { BellRing, PauseCircle } from "lucide-react";
import { activity, breaks } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { confirmActiveAction } from "@/app/provider/actions";

/**
 * Dashboard banner: a break they chose (and how to come back), a pause for inactivity (one tap
 * to come back), or, before that pause, a nudge to tap "I'm still available".
 */
export async function BreakBanner({ providerId }: { providerId: string }) {
  const [st, act] = await Promise.all([breaks.breakStatus(providerId).catch(() => null), activity.activityStatus(providerId).catch(() => null)]);
  if (act?.paused) {
    return (
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-amber-300 bg-amber-50 px-4 py-3 text-sm text-amber-900">
        <PauseCircle className="size-5 shrink-0" />
        <span className="flex-1">Your profile is paused because we haven&apos;t seen a shift, application or check-in from you in a while. You won&apos;t get new shift offers until you come back. Bookings you already have aren&apos;t affected.</span>
        <ActionForm action={confirmActiveAction} successMessage={false}>
          <SubmitButton size="sm">I&apos;m active again</SubmitButton>
        </ActionForm>
      </div>
    );
  }
  if (st && (st.onBreak || st.scheduled)) {
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
  if (act?.remindPauseAt) {
    const by = act.remindPauseAt.toLocaleDateString("en-US", { timeZone: "America/New_York", weekday: "long", month: "short", day: "numeric" });
    return (
      <div className="mb-6 flex flex-wrap items-center gap-3 rounded-2xl border border-brand-200 bg-brand-50 px-4 py-3 text-sm text-brand-900">
        <BellRing className="size-5 shrink-0" />
        <span className="flex-1">Still taking coverage shifts? Tap to stay active, or we&apos;ll pause your profile on {by}.</span>
        <ActionForm action={confirmActiveAction} successMessage={false}>
          <SubmitButton size="sm">I&apos;m still available</SubmitButton>
        </ActionForm>
      </div>
    );
  }
  return null;
}
