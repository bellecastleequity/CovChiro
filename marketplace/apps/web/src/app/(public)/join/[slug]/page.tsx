import { JoinPage } from "../join-page";

export const dynamic = "force-dynamic";
export const metadata = { title: "Graduating soon? Join the chiropractic coverage network" };

export default async function JoinCampaign({ params, searchParams }: { params: Promise<{ slug: string }>; searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const { slug } = await params;
  return <JoinPage slug={slug} search={await searchParams} />;
}
