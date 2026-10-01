import { ReferPage } from "@/components/referrals/refer-page";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Refer & earn" };
export const dynamic = "force-dynamic";

export default async function ClinicRefer() {
  const { user } = await requireActor("clinic");
  return <ReferPage userId={user.id} kind="clinic" />;
}
