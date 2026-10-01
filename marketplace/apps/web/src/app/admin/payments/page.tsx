import Link from "next/link";
import { prisma } from "@cm/db";
import { getSettings } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Alert, PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateTimeLabel, humanize, money } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { adminChargeAction, lodgingReviewAction, resolveDisputeAction } from "../actions";

export default async function Payments() {
  await requireActor("admin");
  const s = await getSettings();
  const [disputes, receipts, payments, clinics] = await Promise.all([
    prisma.dispute.findMany({ where: { status: "OPEN" }, include: { assignment: { include: { provider: true, shift: { include: { location: { include: { clinicOrg: true } } } } } } }, orderBy: { createdAt: "asc" } }),
    prisma.lodgingReceipt.findMany({ where: { status: "SUBMITTED" }, include: { assignment: { include: { provider: true, shift: true } } } }),
    prisma.payment.findMany({ include: { clinicOrg: true }, orderBy: { createdAt: "desc" }, take: 50 }),
    // Only clinics with a saved card or bank account can be charged.
    prisma.clinicOrg.findMany({ where: { hasPaymentMethod: true }, orderBy: { displayName: "asc" }, select: { id: true, displayName: true, paymentMethodLabel: true } }),
  ]);
  return (
    <>
      <PageHeader title="Payments & disputes" />
      <div className="space-y-6">
        <Card>
          <CardHeader title={`Open disputes (${disputes.length})`} description="The provider's payout is held until resolved." />
          <CardBody className="space-y-4">
            {disputes.length ? disputes.map((d) => (
              <div key={d.id} className="rounded-xl border border-slate-200 p-4 text-sm">
                <div className="font-medium">{d.assignment.shift.location.clinicOrg.displayName} ↔ {d.assignment.provider.displayName} · <Link className="text-brand-700" href={`/admin/shifts/${d.assignment.shiftId}`}>shift</Link></div>
                <div className="text-slate-600">Opened by {d.openedByType.toLowerCase()}: “{d.reason}”</div>
                <div className="text-xs text-slate-500">Clinic total {money(d.assignment.clinicTotalCents)} · provider total {money(d.assignment.providerTotalCents)}</div>
                <ActionForm action={resolveDisputeAction} className="mt-3 grid gap-2 sm:grid-cols-4">
                  <input type="hidden" name="disputeId" value={d.id} />
                  <Field label="Refund clinic ($)"><Input name="refund" inputMode="decimal" placeholder="0" /></Field>
                  <Field label="Provider pay"><Select name="adjDirection"><option value="deduct">Deduct</option><option value="add">Add</option></Select></Field>
                  <Field label="Amount ($)"><Input name="payoutAdjustment" inputMode="decimal" placeholder="0" /></Field>
                  <Field label="Resolution" className="sm:col-span-4"><Textarea name="resolution" required /></Field>
                  <div><SubmitButton size="sm">Resolve</SubmitButton></div>
                </ActionForm>
              </div>
            )) : <p className="text-sm text-slate-500">No open disputes.</p>}
          </CardBody>
        </Card>
        {receipts.length ? (
          <Card>
            <CardHeader title="Lodging receipts" description="Approved amounts are charged to the clinic and paid 100% to the provider." />
            <CardBody className="space-y-3">
              {receipts.map((r) => (
                <div key={r.id} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                  <span>{r.assignment.provider.displayName} · {money(r.amountCents)} · {r.nights} night(s) · cap {money((r.assignment.shift.lodgingCapCentsPerNight ?? 0) * r.nights)} · <a className="text-brand-700" target="_blank" href={`/api/files/${r.fileUrl}`}>receipt</a></span>
                  <div className="flex gap-2">
                    <ActionForm action={lodgingReviewAction}><input type="hidden" name="receiptId" value={r.id} /><input type="hidden" name="decision" value="approve" /><SubmitButton size="sm">Approve</SubmitButton></ActionForm>
                    <ActionForm action={lodgingReviewAction}><input type="hidden" name="receiptId" value={r.id} /><input type="hidden" name="decision" value="reject" /><SubmitButton size="sm" variant="outline">Reject</SubmitButton></ActionForm>
                  </div>
                </div>
              ))}
            </CardBody>
          </Card>
        ) : null}
        <Card>
          <CardHeader title="Manual charge" description={`Charge a clinic's saved payment method for an adjustment or fee.${s["features.conversionFeeEnabled"] ? "" : " Conversion fees are disabled until attorney review."}`} />
          <CardBody>
            {clinics.length ? (
            <ActionForm action={adminChargeAction} className="grid gap-2 sm:grid-cols-5" resetOnSuccess confirm="Charge this clinic's saved payment method?">
              <Select name="clinicOrgId" required className="sm:col-span-2" defaultValue="">
                <option value="" disabled>Choose a clinic…</option>
                {clinics.map((c) => <option key={c.id} value={c.id}>{c.displayName}{c.paymentMethodLabel ? ` — ${c.paymentMethodLabel}` : ""}</option>)}
              </Select>
              <Select name="type"><option value="ADJUSTMENT">Adjustment</option><option value="CANCELLATION_FEE">Cancellation fee</option>{s["features.conversionFeeEnabled"] ? <option value="CONVERSION_FEE">Conversion fee</option> : null}</Select>
              <Input name="amount" placeholder="$ amount (min $0.50)" required />
              <Input name="description" placeholder="Description" required />
              <div><SubmitButton size="sm" variant="outline">Charge</SubmitButton></div>
            </ActionForm>
            ) : (
              <p className="text-sm text-slate-500">No clinics have a saved card or bank account yet. Clinics appear here once they add one in their Billing page.</p>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Recent payments" />
          <Table>
            <thead><tr><Th>Date</Th><Th>Clinic</Th><Th>Type</Th><Th className="text-right">Amount</Th><Th>Status</Th></tr></thead>
            <tbody>{payments.map((p) => <tr key={p.id}><Td>{dateTimeLabel(p.createdAt)}</Td><Td>{p.clinicOrg.displayName}</Td><Td>{humanize(p.type)}</Td><Td className="text-right tabular-nums">{money(p.amountCents, { exact: true })}</Td><Td><StatusBadge status={p.status} /></Td></tr>)}</tbody>
          </Table>
        </Card>
        <Alert tone="info">Payment status only changes from Stripe responses and signature-verified webhooks.</Alert>
      </div>
    </>
  );
}
