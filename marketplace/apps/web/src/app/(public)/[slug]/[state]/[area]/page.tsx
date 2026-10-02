import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { areaBySlug } from "@cm/core";
import { getSettings } from "@cm/services";
import { CoverageLanding } from "@/components/site/coverage-landing";
import { landingPair, serviceWord, stateRates } from "@/lib/seo";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ slug: string; state: string; area: string }> };

async function load(slug: string, state: string, areaSlug: string) {
  const pair = await landingPair(slug, state);
  const found = pair ? areaBySlug(pair.state.slug, areaSlug) : null;
  return pair && found ? { ...pair, area: found.area } : null;
}

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { slug, state, area } = await params;
  const x = await load(slug, state, area);
  if (!x) return {};
  const service = serviceWord(x.profession.slug);
  const towns = x.area.cities.slice(0, 3).map((c) => c.name).join(", ");
  return {
    title: `${service} Coverage ${x.area.name} | ${towns} & Nearby`,
    description: `Licensed ${x.profession.displayName.toLowerCase()}s to cover your ${x.area.name} practice (${towns} and nearby): vacations, holidays, sick days and leave. Verified ${x.state.name} license and malpractice, set day rates.`,
    alternates: { canonical: `/${x.profession.slug}/${x.state.slug}/${x.area.slug}` },
  };
}

export default async function AreaLanding({ params }: P) {
  const { slug, state, area } = await params;
  const x = await load(slug, state, area);
  if (!x) notFound();
  const [groups, s] = await Promise.all([stateRates(x.profession.code, x.state.code), getSettings()]);
  return <CoverageLanding p={x.profession} st={x.state} area={x.area} groups={groups} s={s} path={`/${x.profession.slug}/${x.state.slug}/${x.area.slug}`} />;
}
