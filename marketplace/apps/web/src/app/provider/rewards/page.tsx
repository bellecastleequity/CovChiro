import { rewards } from "@cm/services";
import { RewardsView } from "@/components/rewards/rewards-view";
import { Empty, PageHeader } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Rewards" };

export default async function ProviderRewards() {
  const { actor } = await requireActor("provider");
  const r = await rewards.myProviderRewards(actor);
  return (
    <>
      <PageHeader title="Rewards" description="Earn points for every setup step and every shift you cover well. Climb from Bronze to Platinum." />
      {r.enabled ? <RewardsView r={r} who="provider" /> : <Empty title="Rewards are paused">Check back soon.</Empty>}
    </>
  );
}
