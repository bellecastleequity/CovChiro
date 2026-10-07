import Link from "next/link";
import { notFound } from "next/navigation";
import { chargebacks } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/form";
import { Alert, PageHeader } from "@/components/ui/misc";
import { dateLabel, dateTimeLabel, money } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { chargebackEvidenceAction, chargebackReleaseAction } from "../../../actions";

export const metadata = { title: "Card dispute" };
export const dynamic = "force-dynamic";

const LABEL: Record<string, string> = {
  product_description: "What was sold",
  customer_name: "Customer",
  customer_email_address: "Customer email",
  service_date: "Service date",
  cancellation_policy_disclosure: "Cancellation policy",
  uncategorized_text: "Summary of records",
};

export default async function Chargeback({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor("admin");
  const d = await chargebacks.chargebackDetail(actor, (await params).id).catch(() => null);
  if (!d) notFound();
  const c = d.dispute;
  return (
    <>
      <PageHeader back={{ href: "/admin/payments/chargebacks", label: "Card disputes" }} title={`${d.clinicName ?? "Clinic"} disputed ${money(c.amountCents, { exact: true })}`} description={`Reason: ${c.reason.replace(/_/g, " ")} · opened ${dateTimeLabel(c.createdAt)} · Stripe ${c.stripeDisputeId}`} actions={<Badge tone={d.open ? "red" : c.status === "won" ? "green" : "gray"}>{c.status.replace(/_/g, " ")}</Badge>} />
      {d.open && c.evidenceDueBy ? <Alert tone="warning" className="mb-5" title={`Evidence due by ${dateLabel(c.evidenceDueBy)}`}>If nothing is submitted by then, the bank decides for the clinic.</Alert> : null}
      <div className="grid gap-6 lg:grid-cols-[1fr_20rem]">
        <Card>
          <CardHeader title="Evidence (built from the booking's records)" description="This is what goes to Stripe and the bank. It never includes patient information." />
          <CardBody className="space-y-4 text-sm">
            {Object.entries(d.evidence).map(([k, v]) => (
              <div key={k}><div className="text-xs font-medium uppercase tracking-wide text-slate-500">{LABEL[k] ?? k}</div><p className="mt-1 whitespace-pre-line text-slate-800">{v}</p></div>
            ))}
            {d.open ? (
              <ActionForm action={chargebackEvidenceAction} className="space-y-3 border-t border-slate-100 pt-4">
                <input type="hidden" name="id" value={c.id} />
                <Field label="Anything to add (optional)" hint="E.g. what the clinic told you, or that the clinic re-booked afterwards. Plain facts only."><Textarea name="note" defaultValue={c.adminNote ?? ""} className="min-h-24" /></Field>
                <div className="flex flex-wrap gap-2">
                  <SubmitButton name="mode" value="draft" variant="outline" size="sm">Save to Stripe as draft</SubmitButton>
                  <SubmitButton name="mode" value="submit" size="sm">Submit to the bank (final)</SubmitButton>
                </div>
              </ActionForm>
            ) : c.evidenceSubmittedAt ? <p className="text-slate-500">Evidence submitted {dateTimeLabel(c.evidenceSubmittedAt)}.</p> : null}
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Booking" />
            <CardBody className="space-y-2 text-sm">
              {d.shiftId ? <Link href={`/admin/shifts/${d.shiftId}`} className="text-brand-700 hover:underline">Open the shift</Link> : <p className="text-slate-500">This charge isn&apos;t tied to a booking (manual or placement charge).</p>}
              {d.providerName ? <p>Provider: {d.providerName}</p> : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Provider pay on hold" description="The provider's unsent pay for this booking was put on hold when the dispute opened. The provider did the work, so release it unless something went wrong with the shift." />
            <CardBody>
              {c.heldPayoutIds.length ? (
                <ActionForm action={chargebackReleaseAction}>
                  <input type="hidden" name="id" value={c.id} />
                  <SubmitButton size="sm" variant="outline">Release held pay ({c.heldPayoutIds.length})</SubmitButton>
                </ActionForm>
              ) : <p className="text-sm text-slate-500">Nothing was held (already paid, or no booking).</p>}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
