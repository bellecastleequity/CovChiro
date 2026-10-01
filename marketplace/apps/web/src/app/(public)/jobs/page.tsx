import Link from "next/link";
import { brand } from "@cm/config";
import { slugify, US_STATES } from "@cm/core";
import { seo } from "@cm/services";
import { LinkButton } from "@/components/ui/button";
import { Breadcrumbs, JobCard } from "@/components/site/seo-blocks";
import { breadcrumbLd, JsonLd, pageMeta } from "@/lib/seo";

export const dynamic = "force-dynamic";

export const metadata = pageMeta({
  title: "Per diem & locum chiropractor jobs: open shifts",
  description: "Open per diem, locum and fill-in shifts for licensed chiropractors and other providers. See the date, hours and your pay, then apply with a free profile.",
  path: "/jobs",
});

export default async function Jobs() {
  const b = brand();
  const [live, jobs] = await Promise.all([seo.seoLive(), seo.publicJobs({ take: 60 })]);
  const crumbs = [{ name: "Home", path: "/" }, { name: "Jobs", path: "/jobs" }];
  return (
    <div className="container-page py-12">
      <JsonLd data={breadcrumbLd(crumbs)} />
      <Breadcrumbs items={crumbs} />
      <div className="max-w-3xl">
        <h1 className="text-4xl font-semibold leading-tight">Per diem &amp; locum provider jobs</h1>
        <p className="mt-4 text-lg text-slate-600">
          Clinics post the days they need covered; {b.name} shows each shift only to providers licensed for that state. Create a free profile to apply and to be notified when a new shift matches you.
        </p>
        <div className="mt-8"><LinkButton href="/signup?role=provider" size="lg">Create your free profile</LinkButton></div>
      </div>
      <section className="mt-12">
        <h2 className="text-xl font-semibold">Browse by state</h2>
        <ul className="mt-4 flex flex-wrap gap-2">
          {live.flatMap((p) => p.states.map((st) => (
            <li key={`${p.slug}-${st}`}>
              <Link href={`/jobs/${p.slug}/${slugify(US_STATES[st])}`} className="inline-block rounded-full border border-slate-200 px-4 py-2 text-sm hover:border-brand-300 hover:text-brand-700">{p.name} jobs in {US_STATES[st]}</Link>
            </li>
          )))}
        </ul>
      </section>
      <section className="mt-12">
        <h2 className="text-xl font-semibold">Open shifts</h2>
        {jobs.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">{jobs.map((j) => <JobCard key={j.id} j={j} />)}</div>
        ) : (
          <p className="mt-4 rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">No open shifts right now. New shifts go to verified, matching providers as soon as they&apos;re posted, so create your profile to be first in line.</p>
        )}
      </section>
    </div>
  );
}
