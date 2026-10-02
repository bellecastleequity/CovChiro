import { UrgentHelp } from "@/components/help/urgent";
import { providerHelp } from "@/lib/help/provider";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Need help now?" };

export default async function ProviderUrgentHelp({ searchParams }: { searchParams: Promise<{ shift?: string; sent?: string }> }) {
  const { actor, user } = await requireActor("provider");
  const q = await searchParams;
  return <UrgentHelp center={providerHelp} actor={actor} user={{ name: user.name, email: user.email, phone: user.phone ?? null }} shiftId={q.shift} sentId={q.sent} />;
}
