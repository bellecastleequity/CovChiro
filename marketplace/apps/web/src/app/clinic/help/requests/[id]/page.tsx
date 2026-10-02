import { HelpRequest } from "@/components/help/help-pages";
import { clinicHelp } from "@/lib/help/clinic";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Support request" };

export default async function ClinicHelpRequest({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ sent?: string }> }) {
  const { actor } = await requireActor("clinic");
  return <HelpRequest center={clinicHelp} actor={actor} id={(await params).id} sent={(await searchParams).sent === "1"} />;
}
