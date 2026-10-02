import { HelpContact } from "@/components/help/help-pages";
import { clinicHelp } from "@/lib/help/clinic";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Contact support" };

export default async function ClinicHelpContact({ searchParams }: { searchParams: Promise<{ subject?: string }> }) {
  const { actor } = await requireActor("clinic");
  return <HelpContact center={clinicHelp} actor={actor} subject={(await searchParams).subject} />;
}
