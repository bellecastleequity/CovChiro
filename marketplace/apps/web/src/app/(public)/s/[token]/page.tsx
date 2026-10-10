import Link from "next/link";
import { notFound } from "next/navigation";
import { BedDouble, CalendarDays, Clock, MapPin, Stethoscope, Users, Wallet } from "lucide-react";
import { brand } from "@cm/config";
import { shiftRecruit } from "@cm/services";
import { claimRecruitAction } from "@/app/recruit-actions";
import { RememberShift } from "@/components/recruit/remember-shift";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { LinkButton } from "@/components/ui/button";
import { money } from "@/lib/format";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";
export const metadata = { title: "A coverage shift for you", robots: { index: false } };

/** "Recruit a provider" link: the shift in brief (no clinic name or address), then sign up or claim. */
export default async function RecruitShift({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const sum = await shiftRecruit.summary(token);
  if (!sum) notFound();
  const session = await getSession();
  const isProvider = !!session?.workspaces.provider;
  const b = brand();
  const d = sum.shift;
  const rows: [React.ReactNode, React.ReactNode, React.ReactNode][] = [
    [<Stethoscope key="i" className="size-5" />, "Coverage", d.professionName],
    [<CalendarDays key="i" className="size-5" />, "Date", d.otherDays.length ? `${d.date} (+${d.otherDays.length} more day${d.otherDays.length === 1 ? "" : "s"})` : d.date],
    [<Clock key="i" className="size-5" />, "Hours", d.time],
    [<MapPin key="i" className="size-5" />, "Where", `${d.city}, ${d.state} (exact address once you're booked)`],
    [<Wallet key="i" className="size-5" />, "Pay", <>{money(d.payCents)}{d.mileageNote ? " + mileage" : ""}{d.otherDays.length ? " per day" : ""}</>],
    ...(d.tier ? [[<Users key="i" className="size-5" />, "The day", <>{d.tier}{d.expectedPatients ? `, about ${d.expectedPatients} patients for you` : ""}{d.extraVisitCents ? `. Each visit past ${d.extraVisitsAfter} pays ${money(d.extraVisitCents)} more.` : ""}</>] as [React.ReactNode, React.ReactNode, React.ReactNode]] : []),
    ...(d.lodgingNightCents ? [[<BedDouble key="i" className="size-5" />, "Lodging", `${money(d.lodgingNightCents)} a night if you live far enough away to stay over`] as [React.ReactNode, React.ReactNode, React.ReactNode]] : []),
  ];
  return (
    <section className="mx-auto max-w-xl px-4 py-12">
      <RememberShift token={token} />
      <p className="text-sm font-semibold uppercase tracking-wide text-accent-700">{b.name}</p>
      <h1 className="mt-1 text-3xl font-semibold tracking-tight">{sum.state === "OPEN" ? "A coverage shift for you" : "This shift has been filled"}</h1>
      <p className="mt-2 text-slate-600">
        {sum.state === "OPEN"
          ? "A colleague thought you'd be a great fit. Here are the details. It's open to other providers too, so claim it soon."
          : "Thanks for looking. Create a free profile and you'll hear about the next shifts near you first."}
      </p>
      <div className="mt-6 divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white shadow-card">
        {rows.map(([icon, k, v]) => (
          <div key={String(k)} className="flex gap-3 px-5 py-3.5">
            <span className="mt-0.5 text-accent-600">{icon}</span>
            <div>
              <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{k}</div>
              <div className="text-slate-900">{v}</div>
            </div>
          </div>
        ))}
        {d.otherDays.length ? <div className="px-5 py-3 text-sm text-slate-600">Also: {d.otherDays.join(" · ")}</div> : null}
        {d.requiredSkills.length || d.minYearsExperience ? (
          <div className="px-5 py-3 text-sm text-slate-600">
            {d.requiredSkills.length ? <>Requires: {d.requiredSkills.join(", ")}. </> : null}
            {d.minYearsExperience ? <>{d.minYearsExperience}+ years of experience.</> : null}
          </div>
        ) : null}
      </div>

      <div className="mt-6 space-y-3">
        {isProvider ? (
          <ActionForm action={claimRecruitAction} successMessage={false}>
            <input type="hidden" name="token" value={token} />
            <SubmitButton size="lg" className="w-full">{sum.state === "OPEN" ? "Claim this shift" : "Go to my dashboard"}</SubmitButton>
          </ActionForm>
        ) : session ? (
          <p className="rounded-xl bg-slate-50 p-3 text-sm text-slate-600">You&apos;re signed in with a non-provider account. Sign out and create a provider profile to claim this shift.</p>
        ) : (
          <>
            <LinkButton href="/signup?role=provider" size="lg" className="w-full">Create my free profile to claim it</LinkButton>
            <p className="text-center text-sm text-slate-500">
              Already have a profile? <Link href={`/login?next=${encodeURIComponent(`/s/${token}`)}`} className="font-medium text-brand-700 underline">Sign in</Link>
            </p>
          </>
        )}
        <div className="rounded-xl bg-slate-50 p-4 text-sm text-slate-600">
          <b className="text-slate-800">What happens next:</b> sign up (about 2 minutes), add your {d.state} license and malpractice certificate, set up payouts and sign the agreement. We verify your credentials, and as soon as you&apos;re cleared the shift is waiting in your account to review and accept.
        </div>
      </div>
    </section>
  );
}
