import { providerPublicProfile } from "@cm/services";
import { ProviderProfileView } from "@/components/provider-profile";
import { Alert } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Your public profile" };

export default async function PublicPreview() {
  const { actor } = await requireActor("provider");
  const p = await providerPublicProfile(actor, actor.providerId!);
  return (
    <>
      <Alert tone="info" className="mb-5">This is how clinics see your profile. Your LinkedIn link is {p.linkedinHidden ? "shown after a shift is confirmed" : "visible"} to clinics per platform settings.</Alert>
      <ProviderProfileView p={p} />
    </>
  );
}
