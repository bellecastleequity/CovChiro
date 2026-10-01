import { notFound } from "next/navigation";
import { cityLabel } from "@cm/core";
import { getSettings, seo } from "@cm/services";
import { JobsLanding } from "@/components/site/jobs-landing";
import { pageMeta } from "@/lib/seo";

export const dynamic = "force-dynamic";

type Params = { params: Promise<{ slug: string; state: string }> };

export async function generateMetadata({ params }: Params) {
  const { slug, state } = await params;
  const r = await seo.resolveSeoPath(slug, state);
  if (!r) return {};
  const prof = r.profession.displayName.toLowerCase();
  return pageMeta({
    title: `${r.profession.displayName} jobs in ${r.stateName}: per diem & locum shifts`,
    description: `Per diem and locum ${prof} jobs across ${r.stateName}, including ${r.cities.slice(0, 3).map(cityLabel).join(", ")}. Pick your days, see pay up front, get paid after every shift.`,
    path: `/jobs/${slug}/${state}`,
  });
}

export default async function StateJobs({ params }: Params) {
  const { slug, state } = await params;
  const r = await seo.resolveSeoPath(slug, state);
  if (!r) notFound();
  const [s, jobs] = await Promise.all([getSettings(), seo.publicJobs({ professionCode: r.profession.code, state: r.state })]);
  return (
    <JobsLanding
      s={s} profession={r.profession} state={r.state} stateName={r.stateName} stateSlug={state}
      jobs={jobs} cityLinks={r.cities} stats={jobs.length ? [{ label: "Open shifts", value: String(jobs.length) }] : []}
    />
  );
}
