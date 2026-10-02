import { HelpRequest } from "@/components/help/help-pages";
import { providerHelp } from "@/lib/help/provider";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Support request" };

export default async function ProviderHelpRequest({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string }> }) {
  const { actor } = await requireActor("provider");
  return <HelpRequest center={providerHelp} actor={actor} id={(await params).id} sent={(await searchParams).sent === "1"} />;
}
