import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/misc";
import { AddProviderSideCard } from "@/components/workspace/add-side";
import { getSession, requireActor } from "@/lib/session";

export const metadata = { title: "Work shifts as a provider" };

export default async function AddProvider() {
  const { actor } = await requireActor("clinic");
  if (actor.role !== "CLINIC_OWNER" || (await getSession())?.workspaces.provider) redirect("/clinic");
  return (
    <>
      <PageHeader back={{ href: "/clinic", label: "Home" }} title="Work shifts as a provider" />
      <div className="max-w-2xl"><AddProviderSideCard /></div>
    </>
  );
}
