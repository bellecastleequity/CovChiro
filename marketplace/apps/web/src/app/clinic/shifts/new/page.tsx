import { prisma } from "@cm/db";
import { postingOptions } from "@cm/services";
import { LinkButton } from "@/components/ui/button";
import { Empty, PageHeader } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";
import { PostShiftWizard } from "./wizard";

export const metadata = { title: "Post a shift" };

export default async function NewShift({ searchParams }: { searchParams: Promise<{ code?: string }> }) {
  const { actor } = await requireActor("clinic");
  const { code } = await searchParams;
  const org = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: actor.clinicOrgId! } });
  const locations = await prisma.clinicLocation.findMany({ where: { clinicOrgId: actor.clinicOrgId!, active: true }, orderBy: { createdAt: "asc" } });
  if (!locations.length) {
    return (
      <>
        <PageHeader title="Post a shift" />
        <Empty title="Add a location first" action={<LinkButton href="/clinic/locations">Add location</LinkButton>}>We need your clinic's address to find licensed providers in your state.</Empty>
      </>
    );
  }
  const options = await Promise.all(locations.map((l) => postingOptions(actor, l.id)));
  const redemptions = await prisma.promoRedemption.count({ where: { clinicOrgId: org.id, voidedAt: null } });
  const welcome = redemptions === 0 ? await prisma.promoCode.findFirst({ where: { assignedEmail: org.billingEmail ?? "", active: true, usedCount: 0, OR: [{ expiresAt: null }, { expiresAt: { gt: new Date() } }] }, orderBy: { createdAt: "desc" } }) : null;
  return (
    <>
      <PageHeader title="Post a shift" description="Prices come from our regional rate card. You'll see the total before posting." />
      <PostShiftWizard
        canPost={org.status === "ACTIVE" && org.hasPaymentMethod}
        defaultCode={code ?? welcome?.code ?? ""}
        locations={options.map((o) => ({
          id: o.location.id,
          name: o.location.name,
          city: o.location.city,
          state: o.location.state,
          timeZone: o.location.timeZone,
          professions: o.professions,
        }))}
      />
    </>
  );
}
