import { brand, type SettingsMap } from "@cm/config";
import { cityLabel } from "@cm/core";
import type { seo } from "@cm/services";
import { LinkButton } from "@/components/ui/button";
import { Breadcrumbs, CityLinks, FaqBlock, JobCard, Stats } from "@/components/site/seo-blocks";
import { breadcrumbLd, faqLd, JsonLd } from "@/lib/seo";
import { providerFaq } from "@/lib/seo-copy";

/** Provider-facing jobs page for a state or a city (same layout, local facts). */
export function JobsLanding(o: {
  s: SettingsMap;
  profession: { code: string; displayName: string; slug: string; credentialSuffix: string };
  state: string;
  stateName: string;
  stateSlug: string;
  city?: string;
  citySlug?: string;
  jobs: seo.PublicJob[];
  cityLinks: string[];
  stats: { label: string; value: string }[];
}) {
  const b = brand();
  const prof = o.profession.displayName.toLowerCase();
  const place = o.city ? `${cityLabel(o.city)}, ${o.state}` : o.stateName;
  const base = `/jobs/${o.profession.slug}/${o.stateSlug}`;
  const path = o.citySlug ? `${base}/${o.citySlug}` : base;
  const faq = providerFaq(o.s, { profession: o.profession.displayName, stateName: o.stateName, city: o.city });
  const crumbs = [
    { name: "Home", path: "/" },
    { name: "Jobs", path: "/jobs" },
    { name: `${o.profession.displayName} jobs in ${o.stateName}`, path: base },
    ...(o.city ? [{ name: cityLabel(o.city), path }] : []),
  ];
  const signup = `/signup?role=provider&profession=${o.profession.code}`;
  return (
    <div className="container-page py-12">
      <JsonLd data={[breadcrumbLd(crumbs), faqLd(faq)]} />
      <Breadcrumbs items={crumbs} />
      <div className="max-w-3xl">
        <div className="text-sm font-semibold uppercase tracking-wider text-brand-700">Per diem · Locum · Fill-in</div>
        <h1 className="mt-2 text-4xl font-semibold leading-tight">{o.profession.displayName} jobs in {place}</h1>
        <p className="mt-4 text-lg text-slate-600">
          Pick up per diem and locum {prof} shifts at practices {o.city ? `in and around ${cityLabel(o.city)}` : `across ${o.stateName}`}. Set the days you&apos;re available and how far you&apos;ll drive, see your pay and mileage before you apply, and get paid to your bank after every shift through {b.name}.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <LinkButton href={signup} size="lg">Create your free profile</LinkButton>
          <LinkButton href="/for-providers" variant="outline" size="lg">Why {o.profession.credentialSuffix}s join</LinkButton>
        </div>
        <Stats items={o.stats} />
      </div>

      <section className="mt-14">
        <h2 className="text-xl font-semibold">Open {prof} shifts {o.city ? `near ${cityLabel(o.city)}` : `in ${o.stateName}`}</h2>
        {o.jobs.length ? (
          <div className="mt-4 grid gap-3 md:grid-cols-2">{o.jobs.slice(0, 30).map((j) => <JobCard key={j.id} j={j} />)}</div>
        ) : (
          <div className="mt-4 rounded-2xl border border-dashed border-slate-300 p-6 text-sm text-slate-600">
            No open shifts {o.city ? `near ${cityLabel(o.city)}` : ""} right now. New shifts go to verified, matching providers as soon as theyShifts are offered to verified providers first, often within hours of being posted.apos;re posted.{" "}
            <a href={signup} className="font-medium text-brand-700 hover:underline">Create your profile</a> so you&apos;re notified as soon as one matches you.
          </div>
        )}
      </section>

      <FaqBlock qa={faq} />
      <CityLinks cities={o.cityLinks} base={base} title={o.city ? `${o.profession.displayName} jobs near ${cityLabel(o.city)}` : `${o.profession.displayName} jobs by city in ${o.stateName}`} />
      <p className="mt-10 text-sm text-slate-500">
        Running a practice {o.city ? `in ${cityLabel(o.city)}` : `in ${o.stateName}`}? <a className="text-brand-700 hover:underline" href={`/${o.profession.slug}/${o.stateSlug}${o.citySlug ? `/${o.citySlug}` : ""}`}>Book fill-in {prof} coverage</a>.
      </p>
    </div>
  );
}
