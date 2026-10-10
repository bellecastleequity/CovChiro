import { prisma } from "@cm/db";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Input } from "@/components/ui/form";
import { addProviderSideAction } from "@/app/clinic/actions";
import { addClinicSideAction } from "@/app/provider/actions";

/** Clinic owner: add a provider side to the same login (taking shifts at other clinics). */
export async function AddProviderSideCard() {
  const professions = await prisma.profession.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  return (
    <Card id="take-shifts">
      <CardHeader title="Work shifts as a provider" description="Licensed yourself? Add a provider profile to this same login and pick up shifts at other clinics on your days off. You switch between your clinic and your shifts from the menu — no second account." />
      <CardBody>
        <ActionForm action={addProviderSideAction} successMessage={false} className="space-y-3">
          <div className="flex flex-wrap gap-4">
            {professions.map((p) => <Checkbox key={p.code} name="professions" value={p.code} defaultChecked={p.code === "DC"} label={`${p.displayName} (${p.credentialSuffix})`} />)}
          </div>
          <p className="text-xs text-slate-500">You&apos;ll add your licenses and get verified like any provider. You&apos;re never matched to your own clinic&apos;s shifts.</p>
          <SubmitButton>Add my provider profile</SubmitButton>
        </ActionForm>
      </CardBody>
    </Card>
  );
}

/** Provider: add a clinic they own to the same login. */
export function AddClinicSideCard() {
  return (
    <Card id="own-clinic">
      <CardHeader title="Add my clinic" description="Own a practice that needs coverage? Add it to this same login and post shifts for it. You switch between your shifts and your clinic from the menu — no second account." />
      <CardBody>
        <ActionForm action={addClinicSideAction} successMessage={false} className="flex flex-wrap gap-2">
          <Input name="organization" placeholder="Clinic name" required minLength={2} className="max-w-xs" />
          <SubmitButton>Add my clinic</SubmitButton>
        </ActionForm>
        <p className="mt-2 text-xs text-slate-500">Your clinic is verified like any other before its shifts go out. You&apos;re never matched to your own clinic&apos;s shifts.</p>
      </CardBody>
    </Card>
  );
}
