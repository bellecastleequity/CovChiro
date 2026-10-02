import { notFound } from "next/navigation";
import type { Metadata } from "next";
import { getSettings } from "@cm/services";
import { CoverageLanding } from "@/components/site/coverage-landing";
import { landingPair, serviceWord, stateRates } from "@/lib/seo";

export const dynamic = "force-dynamic";

type P = { params: Promise<{ slug: string; state: string }> };

export async function generateMetadata({ params }: P): Promise<Metadata> {
  const { slug, state } = await params;
  const pair = await landingPair(slug, state);
  if (!pair) return {};
  const { profession: p, state: st } = pair;
  const service = serviceWord(p.slug);
  return {
    title: `${service} Coverage ${st.name} | Temporary & Locum ${p.displayName}s`,
    description: `Temporary ${p.displayName.toLowerCase()} coverage across ${st.name}: licensed, insured ${p.credentialSuffix}s by the half day, day or week for vacations, holidays, sick days and leave. Set prices, book online.`,
    alternates: { canonical: `/${p.slug}/${st.slug}` },
  };
}

export default async function StateLanding({ params }: P) {
  const { slug, state } = await params;
  const pair = await landingPair(slug, state);
  if (!pair) notFound();
  const [groups, s] = await Promise.all([stateRates(pair.profession.code, pair.state.code), getSettings()]);
  return <CoverageLanding p={pair.profession} st={pair.state} area={null} groups={groups} s={s} path={`/${pair.profession.slug}/${pair.state.slug}`} />;
}
