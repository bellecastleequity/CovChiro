import { prisma } from "@cm/db";
import { clinicVerify } from "@cm/services";
import { VerificationForm } from "@/components/clinic/verification-form";
import { Alert, PageHeader } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";
import { clinicVerificationEnterAction } from "../../../actions";

export const metadata = { title: "Enter clinic verification" };

export default async function AdminEnterVerification({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor("admin");
  const { id } = await params;
  const { org, form } = await clinicVerify.adminVerificationForm(actor, id);
  const professions = await prisma.profession.findMany({ where: { active: true }, select: { code: true, displayName: true }, orderBy: { displayName: "asc" } });
  return (
    <>
      <PageHeader
        back={{ href: `/admin/clinics/${id}#verification`, label: org.displayName }}
        title="Enter verification for the clinic"
        description="For an owner who couldn't use the form. It goes through the same automatic checks; anything flagged comes to the review page, where you can mark items OK and add documents."
      />
      <Alert tone="info" className="mb-6">Only enter what the owner gave you, and note how (phone, email). The ownership statement must be confirmed by the owner.</Alert>
      <VerificationForm action={clinicVerificationEnterAction} v={form} professions={professions} mode="admin" clinicOrgId={id} />
    </>
  );
}
