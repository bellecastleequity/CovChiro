import { rewards } from "@cm/services";
import { RewardsView } from "@/components/rewards/rewards-view";
import { Empty, PageHeader } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Rewards" };

export default async function ClinicRewards() {
  const { actor } = await requireActor("clinic");
  const r = await rewards.myClinicRewards(actor);
  return (
    <>
      <PageHeader title="Rewards" description="Earn points for setting up, booking coverage, and signing off and rating each shift. Climb from Bronze to Platinum." />
      {r.enabled ? <RewardsView r={r} who="clinic" /> : <Empty title="Rewards are paused">Check back soon.</Empty>}
    </>
  );
}
