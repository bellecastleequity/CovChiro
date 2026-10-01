import { notFound } from "next/navigation";
import { cityLabel } from "@cm/core";
import { getSettings, seo } from "@cm/services";
import { JobsLanding } from "@/components/site/jobs-landing";
import { pageMeta } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; state: string; city: string }> };

export async function generateMetadata({ params }: Params) {
  const { slug, state, city } = await params;
  const r = await seo.resolveSeoPath(slug, state, city);
  if (!r?.city) return {};
  const prof = r.profession.displayName.toLowerCase();
  const place = cityLabel(r.city);
  return pageMeta({
    title: `${r.profession.displayName} jobs in ${place}, ${r.state}: per diem & locum`,
    description: `Per diem and locum ${prof} jobs in ${place}, ${r.stateName}. Pick your days, see your pay before you apply, and get paid after every shift.`,
    path: `/jobs/${slug}/${state}/${city}`,
  });
}

export default async function CityJobs({ params }: Params) {
  const { slug, state, city } = await params;
  const r = await seo.resolveSeoPath(slug, state, city);
  if (!r?.city) notFound();
  const [s, d] = await Promise.all([getSettings(), seo.cityPageData(r.profession.code, r.state, r.city, r.cities)]);
  const place = cityLabel(r.city);
  const stats = [
    ...(d.jobs.length ? [{ label: "Open shifts nearby", value: String(d.jobs.length) }] : []),
    ...(d.practices ? [{ label: `${r.profession.displayName} practices in the ${place} area`, value: String(d.practices) }] : []),
  ];
  return (
    <JobsLanding
      s={s} profession={r.profession} state={r.state} stateName={r.stateName} stateSlug={state} city={r.city} citySlug={city}
      jobs={d.jobs} cityLinks={d.nearby} stats={stats}
    />
  );
}
