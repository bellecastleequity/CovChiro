import { growth, prelicensure } from "@cm/services";
import { GrowthJoin } from "../growth-join";
import { JoinPage } from "../join-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Join the chiropractic coverage network" };

/**
 * One /join/<code> route for both recruitment systems: a student-path
 * campaign (Admin → Recruitment) shows the student landing page; otherwise a
 * Growth campaign (Admin → Growth → Campaigns) shows the Growth landing page.
 */
export default async function JoinCampaign({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  const search = await searchParams;
  if (await prelicensure.campaignForSlug(slug).catch(() => null)) return <JoinPage slug={slug} search={search} />;
  const c = await growth.joinCampaign(slug, search.preview !== "1");
  if (c) return <GrowthJoin c={c} />;
  return <JoinPage slug={slug} search={search} />;
}
