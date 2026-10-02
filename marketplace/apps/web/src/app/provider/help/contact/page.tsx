import { HelpContact } from "@/components/help/help-pages";
import { providerHelp } from "@/lib/help/provider";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Contact support" };

export default async function ProviderHelpContact({ searchParams }: { searchParams: Promise<{ subject?: string }> }) {
  const { actor } = await requireActor("provider");
  return <HelpContact center={providerHelp} actor={actor} subject={(await searchParams).subject} />;
}
