import { notFound } from "next/navigation";
import { brand } from "@cm/config";
import { cityLabel } from "@cm/core";
import { getSettings, seo } from "@cm/services";
import { LinkButton } from "@/components/ui/button";
import { Breadcrumbs, CityLinks, FaqBlock, Stats } from "@/components/site/seo-blocks";
import { breadcrumbLd, faqLd, JsonLd, pageMeta, serviceLd } from "@/lib/seo";
import { clinicFaq } from "@/lib/seo-copy";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; state: string; city: string }> };

export async function generateMetadata({ params }: Params) {
  const { slug, state, city } = await params;
  const r = await seo.resolveSeoPath(slug, state, city);
  if (!r?.city) return {};
  const prof = r.profession.displayName.toLowerCase();
  const where = `${cityLabel(r.city)}, ${r.state}`;
  return pageMeta({
    title: `Fill-in ${prof} coverage in ${where}`,
    description: `Need a locum ${prof} in ${cityLabel(r.city)}? Book fill-in coverage from ${prof}s with a verified ${r.stateName} license and keep your practice open while you're away.`,
    path: `/${slug}/${state}/${city}`,
  });
}

/** City landing page for clinics: local, factual, with real numbers when there are enough of them. */
export default async function CityCoverage({ params }: Params) {
  const { slug, state, city } = await params;
  const r = await seo.resolveSeoPath(slug, state, city);
  if (!r?.city) notFound();
  const b = brand();
  const s = await getSettings();
  const d = await seo.cityPageData(r.profession.code, r.state, r.city, r.cities);
  const prof = r.profession.displayName.toLowerCase();
  const place = cityLabel(r.city);
  const path = `/${slug}/${state}/${city}`;
  const faq = clinicFaq(s, { profession: r.profession.displayName, stateName: r.stateName, city: r.city });
  const crumbs = [
    { name: "Home", path: "/" },
    { name: `${r.profession.displayName} coverage`, path: `/${slug}` },
    { name: r.stateName, path: `/${slug}/${state}` },
    { name: place, path },
  ];
  const stats = [
    ...(d.providersNearby ? [{ label: `Verified ${prof}s within ${d.radiusMiles} mi`, value: String(d.providersNearby) }] : []),
    ...(d.jobs.length ? [{ label: "Open shifts nearby", value: String(d.jobs.length) }] : []),
  ];
  return (
    <div className="container-page py-12">
      <JsonLd
        data={[
          breadcrumbLd(crumbs),
          faqLd(faq),
          serviceLd({ name: `Locum ${prof} coverage in ${place}, ${r.state}`, serviceType: `Locum ${prof} staffing`, description: `Fill-in ${prof}s with verified ${r.stateName} licenses for clinics in ${place}.`, path, areaServed: { city: place, state: r.state, stateName: r.stateName } }),
        ]}
      />
      <Breadcrumbs items={crumbs} />
      <div className="max-w-3xl">
        <div className="text-sm font-semibold uppercase tracking-wider text-brand-700">{place}, {r.state} · Locum {prof} coverage</div>
        <h1 className="mt-2 text-4xl font-semibold leading-tight">Fill-in {prof} coverage in {place}, {r.stateName}</h1>
        <p className="mt-4 text-lg text-slate-600">
          Taking time off, out sick, or away at a seminar? Keep your {place} practice open. Post the days you need covered and {b.name} matches you with {prof}s who hold a verified {r.stateName} license, so your patients keep their appointments while you&apos;re away.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <LinkButton href="/signup?role=clinic" size="lg">Post a shift in {place}</LinkButton>
          <LinkButton href="/tools/cost-of-closing" variant="outline" size="lg">Cost of closing calculator</LinkButton>
        </div>
        <Stats items={stats} />
      </div>

      <section className="mt-14 max-w-3xl">
        <h2 className="text-xl font-semibold">How {place} clinics book coverage</h2>
        <ol className="mt-4 space-y-4">
          {[
            ["Post the day", `Choose your ${place} location, the date and hours. The price is shown up front, set by region and shift length.`],
            ["Get matched", `${r.profession.displayName}s licensed in ${r.stateName} who are available and within driving distance are notified. Review applicants with ratings, drive time and skills, or let us choose.`],
            ["Confirm", "A small deposit confirms the booking. Share arrival notes and message your provider in the app."],
            ["Pay after the shift", "The balance is charged after the shift through the platform, and both sides rate each other."],
          ].map(([t, x], i) => (
            <li key={t} className="flex gap-4">
              <span className="flex size-8 shrink-0 items-center justify-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">{i + 1}</span>
              <div>
                <h3 className="font-semibold">{t}</h3>
                <p className="text-sm text-slate-600">{x}</p>
              </div>
            </li>
          ))}
        </ol>
      </section>

      <section className="mt-14 max-w-3xl rounded-2xl bg-slate-50 p-6">
        <h2 className="text-xl font-semibold">When {place} practices use fill-in coverage</h2>
        <ul className="mt-3 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
          {["Vacations and holidays", "Illness or injury", "Continuing education and seminars", "Parental or family leave", "A provider who quits or cancels", "Extra hands on your busiest days"].map((x) => (
            <li key={x} className="flex gap-2"><span className="text-accent-600" aria-hidden>✓</span>{x}</li>
          ))}
        </ul>
      </section>

      <FaqBlock qa={faq} title={`${r.profession.displayName} coverage in ${place}: questions`} />
      <CityLinks cities={d.nearby} base={`/${slug}/${state}`} title={`Coverage near ${place}`} />
      <p className="mt-10 text-sm text-slate-500">
        Are you a {prof} near {place}? <a className="text-brand-700 hover:underline" href={`/jobs/${slug}/${state}/${city}`}>See per diem {prof} shifts in {place}</a>.
      </p>
    </div>
  );
}
