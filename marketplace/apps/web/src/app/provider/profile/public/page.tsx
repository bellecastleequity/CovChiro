import Link from "next/link";
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
      <Link href="/provider/profile" className="mb-2 inline-flex items-center gap-1 text-sm font-medium text-slate-500 hover:text-brand-700"><span aria-hidden>←</span> Profile</Link>
      <Alert tone="info" className="mb-5">This is how clinics see your profile. Your LinkedIn link is {p.linkedinHidden ? "shown after a shift is confirmed" : "visible"} to clinics per platform settings.</Alert>
      <ProviderProfileView p={p} />
    </>
  );
}
