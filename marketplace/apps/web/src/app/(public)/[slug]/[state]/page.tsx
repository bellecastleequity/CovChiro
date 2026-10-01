import { notFound } from "next/navigation";
import { BadgeCheck, CalendarClock, CreditCard, ShieldCheck } from "lucide-react";
import { brand } from "@cm/config";
import { cityLabel } from "@cm/core";
import { getSettings, seo } from "@cm/services";
import { LinkButton } from "@/components/ui/button";
import { Breadcrumbs, CityLinks, FaqBlock } from "@/components/site/seo-blocks";
import { breadcrumbLd, faqLd, JsonLd, pageMeta, serviceLd } from "@/lib/seo";
import { clinicFaq } from "@/lib/seo-copy";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; state: string }> };

export async function generateMetadata({ params }: Params) {
  const { slug, state } = await params;
  const r = await seo.resolveSeoPath(slug, state);
  if (!r) return {};
  const prof = r.profession.displayName.toLowerCase();
  return pageMeta({
    title: `Locum & fill-in ${prof} coverage in ${r.stateName}`,
    description: `${r.stateName} clinics: book fill-in ${prof}s with a verified ${r.stateName} license for vacations and sick days, in ${r.cities.slice(0, 3).map(cityLabel).join(", ")} and more.`,
    path: `/${slug}/${state}`,
  });
}

/** State hub for clinics: why, how, and links to every city page. */
export default async function StateCoverage({ params }: Params) {
  const { slug, state } = await params;
  const r = await seo.resolveSeoPath(slug, state);
  if (!r) notFound();
  const b = brand();
  const s = await getSettings();
  const prof = r.profession.displayName.toLowerCase();
  const path = `/${slug}/${state}`;
  const faq = clinicFaq(s, { profession: r.profession.displayName, stateName: r.stateName });
  const crumbs = [{ name: "Home", path: "/" }, { name: `${r.profession.displayName} coverage`, path: `/${slug}` }, { name: r.stateName, path }];
  return (
    <div className="container-page py-12">
      <JsonLd data={[breadcrumbLd(crumbs), faqLd(faq), serviceLd({ name: `Locum ${prof} coverage in ${r.stateName}`, serviceType: `Locum ${prof} staffing`, description: `Fill-in ${prof}s with verified ${r.stateName} licenses for ${r.stateName} clinics.`, path, areaServed: { state: r.state, stateName: r.stateName } })]} />
      <Breadcrumbs items={crumbs} />
      <div className="max-w-3xl">
        <div className="text-sm font-semibold uppercase tracking-wider text-brand-700">{r.stateName} · {r.profession.displayName} coverage</div>
        <h1 className="mt-2 text-4xl font-semibold leading-tight">Fill-in {prof} coverage for {r.stateName} clinics</h1>
        <p className="mt-4 text-lg text-slate-600">
          Vacation, illness, a seminar, parental leave or an unexpected emergency shouldn&apos;t close your practice. Post the days you need covered and {b.name} matches you with {prof}s who hold a verified {r.stateName} license, valid through the day they work.
        </p>
        <div className="mt-8 flex flex-wrap gap-3">
          <LinkButton href="/signup?role=clinic" size="lg">Post a shift</LinkButton>
          <LinkButton href="/for-clinics" variant="outline" size="lg">See pricing</LinkButton>
          <LinkButton href={`/jobs/${slug}/${state}`} variant="ghost" size="lg">{r.profession.credentialSuffix}? Find shifts</LinkButton>
        </div>
      </div>

      <section className="mt-14 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { Icon: BadgeCheck, t: `${r.stateName} licenses verified`, d: `Only ${prof}s with a verified ${r.stateName} license valid through the shift can see or apply to it.` },
          { Icon: CalendarClock, t: "Single days or weeks", d: "Book one day, several days in a row, or ongoing coverage on a weekly pattern." },
          { Icon: CreditCard, t: "One consistent price", d: "Prices are set by region and shift length. Mileage passes through to the provider at cost." },
          { Icon: ShieldCheck, t: "No patient data", d: "The platform never collects patient information, and payments run through Stripe." },
        ].map(({ Icon, t, d }) => (
          <div key={t} className="rounded-2xl border border-slate-200 p-6">
            <Icon className="size-6 text-accent-600" aria-hidden />
            <h2 className="mt-3 text-base font-semibold">{t}</h2>
            <p className="mt-1.5 text-sm text-slate-600">{d}</p>
          </div>
        ))}
      </section>

      <CityLinks cities={r.cities} base={path} title={`${r.profession.displayName} coverage by city in ${r.stateName}`} />
      <FaqBlock qa={faq} />
      <p className="mt-10 text-sm text-slate-500">
        Not in a listed city? We cover clinics anywhere in {r.stateName} where licensed providers are available. <a className="text-brand-700 hover:underline" href="/contact">Ask us</a> or <a className="text-brand-700 hover:underline" href="/how-it-works">see how it works</a>.
      </p>
    </div>
  );
}
