import { AGREEMENT_VERSION, clinicProfile } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { Alert, PageHeader } from "@/components/ui/misc";
import { dateLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { agreementAction, orgAction, passwordAction } from "../actions";

export const metadata = { title: "Settings" };

export default async function Settings() {
  const { actor } = await requireActor("clinic");
  const { org } = await clinicProfile(actor);
  const owner = actor.role === "CLINIC_OWNER";
  const signed = org.agreementVersion === AGREEMENT_VERSION.CLINIC && org.agreementSignedAt;
  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Clinic" />
          <CardBody>
            <ActionForm action={orgAction} className="grid gap-4 sm:grid-cols-2">
              <Field label="Legal business name"><Input name="legalName" defaultValue={org.legalName} required disabled={!owner} /></Field>
              <Field label="Display name"><Input name="displayName" defaultValue={org.displayName} required disabled={!owner} /></Field>
              <Field label="Phone"><Input name="phone" defaultValue={org.phone ?? ""} disabled={!owner} /></Field>
              <Field label="Billing email"><Input name="billingEmail" type="email" defaultValue={org.billingEmail ?? ""} disabled={!owner} /></Field>
              {owner ? <div className="sm:col-span-2"><SubmitButton>Save</SubmitButton></div> : null}
            </ActionForm>
          </CardBody>
        </Card>
        <Card id="agreement">
          <CardHeader title="Clinic Platform Agreement" />
          <CardBody>
            {signed ? (
              <Alert tone="success">Signed {dateLabel(org.agreementSignedAt!)} (version {org.agreementVersion}).</Alert>
            ) : owner ? (
              <ActionForm action={agreementAction} successMessage={false}>
                <p className="mb-3 text-sm text-slate-600">Covers pricing, deposits and cancellations, payment authorization, supervision responsibilities, no patient information on the platform, and non-circumvention.</p>
                <SubmitButton>Review & sign</SubmitButton>
              </ActionForm>
            ) : <p className="text-sm text-slate-500">The clinic owner needs to sign the agreement.</p>}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Password" />
          <CardBody>
            <ActionForm action={passwordAction} className="grid gap-3 sm:grid-cols-3" resetOnSuccess>
              <Input name="current" type="password" placeholder="Current password" required />
              <Input name="next" type="password" placeholder="New password" minLength={10} required />
              <SubmitButton variant="outline">Change password</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
