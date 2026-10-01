import { CalendarCheck, GraduationCap, ShieldCheck } from "lucide-react";
import { growth } from "@cm/services";
import { LinkButton } from "@/components/ui/button";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join as a provider" };

/** School / event recruiting link (/join/palmer). Students can register before licensure. */
export default async function Join({ params, searchParams }: { params: Promise<{ code: string }>; searchParams: Promise<{ preview?: string }> }) {
  const { code } = await params;
  const c = await growth.joinCampaign(code, (await searchParams).preview !== "1");
  const signup = `/signup?role=provider${c ? `&campaign=${encodeURIComponent(c.code)}` : ""}&profession=${c?.professionCode ?? "DC"}`;
  return (
    <div className="container-page py-16">
      <div className="max-w-2xl">
        <div className="text-sm font-semibold uppercase tracking-wider text-brand-700">{c?.schoolName ?? "For chiropractors and students"}</div>
        <h1 className="mt-2 text-4xl font-semibold">{c?.headline ?? "Choose coverage days around your schedule"}</h1>
        <p className="mt-4 text-lg text-slate-600">{c?.body ?? "Pick up coverage days without committing to another permanent position. Register now, even before you're licensed. We'll tell you as soon as you're eligible for coverage shifts."}</p>
        <div className="mt-8 flex gap-3"><LinkButton href={signup} size="lg">Register</LinkButton></div>
        <p className="mt-3 text-xs text-slate-500">Registering doesn&apos;t guarantee any shifts. You become eligible once your license and malpractice insurance are verified.</p>
      </div>
      <div className="mt-12 grid gap-5 sm:grid-cols-3">
        {[
          { Icon: GraduationCap, t: "Register before licensure", d: "Students and new graduates can sign up now. We'll check in after graduation about your license." },
          { Icon: ShieldCheck, t: "Verified once", d: "Upload your license and malpractice certificate; we verify both and remind you before they expire." },
          { Icon: CalendarCheck, t: "Your schedule, your radius", d: "You choose your available days and how far you'll drive, and you can change them any time." },
        ].map(({ Icon, t, d }) => (
          <div key={t} className="rounded-2xl border border-slate-200 p-6">
            <Icon className="size-6 text-accent-600" />
            <div className="mt-3 font-semibold">{t}</div>
            <p className="mt-1.5 text-sm text-slate-600">{d}</p>
          </div>
        ))}
      </div>
    </div>
  );
}
