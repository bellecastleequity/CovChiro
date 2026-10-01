import { ReferPage } from "@/components/referrals/refer-page";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Refer & earn" };
export const dynamic = "force-dynamic";

export default async function ProviderRefer() {
  const { user } = await requireActor("provider");
  return <ReferPage userId={user.id} kind="provider" />;
}
