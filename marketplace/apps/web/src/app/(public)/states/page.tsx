import { US_STATES } from "@cm/core";
import { prisma } from "@cm/db";
import Link from "next/link";
import { getSettings } from "@cm/services";
import { LeadForm } from "@/components/site/lead-form";
import { serviceWord } from "@/lib/seo";

export const metadata = { title: "Where we're available", description: "States and professions where you can book coverage today, and where we're launching next.", alternates: { canonical: "/states" } };
export const dynamic = "force-dynamic";

export default async function States() {
  const [pairs, professions] = await Promise.all([
    prisma.professionStateConfig.findMany({ where: { enabled: true } }),
    prisma.profession.findMany({ orderBy: { sortOrder: "asc" } }),
  ]);
  const spots = (await getSettings())["enrollment.trailblazerSpots"];
  const active = professions.filter((p) => p.active);
  const byState = new Map<string, string[]>();
  for (const p of pairs) byState.set(p.state, [...(byState.get(p.state) ?? []), p.professionCode]);
  return (
    <div className="container-page py-16">
      <h1 className="text-4xl font-semibold">Where we're available</h1>
      <p className="mt-3 max-w-2xl text-slate-600">We open state by state. If your state isn&apos;t open yet, hang tight: we&apos;ll be in your area soon.</p>
      <div className="mt-8 grid grid-cols-2 gap-2 sm:grid-cols-4 lg:grid-cols-6">
        {Object.entries(US_STATES).map(([code, name]) => {
          const live = byState.get(code);
          return (
            <div key={code} className={`rounded-xl border p-3 text-sm ${live ? "border-brand-300 bg-brand-50" : "border-slate-200 text-slate-400"}`}>
              <div className="font-semibold">{code}</div>
              <div className="truncate text-xs">{name}</div>
              {live ? <div className="mt-1 text-xs font-medium text-brand-700">{live.map((c) => { const p = professions.find((x) => x.code === c); return p ? serviceWord(p.slug) : c; }).join(", ")}</div> : null}
            </div>
          );
        })}
      </div>
      {active.length ? (
        <div className="mt-12 max-w-xl rounded-2xl border border-amber-300 bg-amber-50 p-6">
          <h2 className="text-lg font-semibold">{active.map((p) => `${p.displayName}s`).join(" and ")}: enroll now, from any state</h2>
          <p className="mt-1 text-sm text-slate-700">
            Your state isn&apos;t open yet? Sign up and finish your setup anyway, and you&apos;ll be among the first we invite when it opens.
            {spots > 0 ? ` The first ${spots} providers to enroll in each state before it opens earn a Trailblazer badge on their profile.` : ""}
          </p>
          <Link href="/signup?role=provider" className="mt-4 inline-flex rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700">Enroll as a provider</Link>
        </div>
      ) : null}
      <div id="waitlist" className="mt-6 max-w-xl rounded-2xl border border-slate-200 p-6">
        <h2 className="text-lg font-semibold">Join the waitlist</h2>
        <p className="mt-1 text-sm text-slate-600">We&apos;ll email you the day we open in your state.</p>
        <div className="mt-4">
          <LeadForm
            source="waitlist"
            askAudience
            professions={professions.map((p) => ({ code: p.code, name: p.displayName }))}
            states={Object.entries(US_STATES).filter(([code]) => code !== "US").map(([code, name]) => ({ code, name }))}
            cta="Join the waitlist"
          />
        </div>
      </div>
    </div>
  );
}
