import { HelpHome } from "@/components/help/help-pages";
import { clinicHelp } from "@/lib/help/clinic";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Help center" };

export default async function ClinicHelp() {
  const { actor } = await requireActor("clinic");
  return <HelpHome center={clinicHelp} actor={actor} />;
}
