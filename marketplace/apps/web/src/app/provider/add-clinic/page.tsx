import { redirect } from "next/navigation";
import { PageHeader } from "@/components/ui/misc";
import { AddClinicSideCard } from "@/components/workspace/add-side";
import { getSession, requireActor } from "@/lib/session";

export const metadata = { title: "Add my clinic" };

export default async function AddClinic() {
  await requireActor("provider");
  if ((await getSession())?.workspaces.clinic) redirect("/provider");
  return (
    <>
      <PageHeader back={{ href: "/provider", label: "Home" }} title="Add my clinic" />
      <div className="max-w-2xl"><AddClinicSideCard /></div>
    </>
  );
}
