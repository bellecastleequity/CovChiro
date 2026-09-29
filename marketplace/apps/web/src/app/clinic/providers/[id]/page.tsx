import { notFound } from "next/navigation";
import { DomainError } from "@cm/core";
import { providerPublicProfile } from "@cm/services";
import { ProviderProfileView } from "@/components/provider-profile";
import { requireActor } from "@/lib/session";

export default async function ClinicProviderProfile({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor("clinic");
  const p = await providerPublicProfile(actor, (await params).id).catch((e) => {
    if (e instanceof DomainError) notFound();
    throw e;
  });
  return <ProviderProfileView p={p} />;
}
