import { providerPublicProfile } from "@cm/services";
import { ProviderProfileView } from "@/components/provider-profile";
import { requireActor } from "@/lib/session";

export default async function AdminProviderProfile({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor("admin");
  return <ProviderProfileView p={await providerPublicProfile(actor, (await params).id)} />;
}
