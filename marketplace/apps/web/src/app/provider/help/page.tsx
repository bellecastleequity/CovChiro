import { HelpHome } from "@/components/help/help-pages";
import { providerHelp } from "@/lib/help/provider";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Help center" };

export default async function ProviderHelp() {
  const { actor } = await requireActor("provider");
  return <HelpHome center={providerHelp} actor={actor} />;
}
