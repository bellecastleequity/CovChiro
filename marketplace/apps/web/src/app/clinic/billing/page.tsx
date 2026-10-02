import { buttonClass } from "@/components/ui/button";
import Link from "next/link";
import { CreditCard } from "lucide-react";
import { prisma } from "@cm/db";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, Empty, PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateTimeLabel, humanize, money } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { paymentSetupAction } from "../actions";

export const metadata = { title: "Billing" };

export default async function Billing({ searchParams }: { searchParams: Promise<{ stripe?: string; setup?: string }> }) {
  const { actor } = await requireActor("clinic");
  const sp = await searchParams;
  const org = await prisma.clinicOrg.findUniqueOrThrow({ where: { id: actor.clinicOrgId! } });
  const [payments, codes] = await Promise.all([
    prisma.payment.findMany({ where: { clinicOrgId: org.id }, include: { assignment: { select: { startsAt: true } } }, orderBy: { createdAt: "desc" }, take: 100 }),
    prisma.promoRedemption.findMany({ where: { clinicOrgId: org.id }, include: { promoCode: true }, orderBy: { createdAt: "desc" } }),
  ]);
  return (
    <>
      <PageHeader title="Billing" description="Payments run through Stripe. We never store your card or bank numbers." actions={<Link href="/clinic/billing/statement" className={buttonClass("outline", "sm")}>Monthly statements</Link>} />
      {sp.stripe || sp.setup === "done" ? <Alert tone="success" className="mb-5">Payment method saved.</Alert> : null}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="Payment method" />
          <CardBody className="space-y-3">
            <div className="flex items-center gap-3 rounded-xl border border-slate-200 p-3">
              <CreditCard className="size-5 text-slate-400" />
              <span className="text-sm">{org.hasPaymentMethod ? org.paymentMethodLabel ?? "Saved payment method" : "None on file"}</span>
            </div>
            {actor.role === "CLINIC_OWNER" ? (
              <ActionForm action={paymentSetupAction} successMessage={false}>
                <SubmitButton variant={org.hasPaymentMethod ? "outline" : "primary"}>{org.hasPaymentMethod ? "Update" : "Add card or bank account"}</SubmitButton>
              </ActionForm>
            ) : <p className="text-xs text-slate-500">Only the clinic owner can change billing.</p>}
          </CardBody>
        </Card>
        <Card className="lg:col-span-2">
          <CardHeader title="Payment history" />
          {payments.length ? (
            <Table>
              <thead><tr><Th>Date</Th><Th>Item</Th><Th className="text-right">Amount</Th><Th>Status</Th></tr></thead>
              <tbody>
                {payments.map((p) => (
                  <tr key={p.id}>
                    <Td>{dateTimeLabel(p.createdAt)}</Td>
                    <Td>{humanize(p.type)}{p.assignment ? <span className="text-slate-500"> · shift {p.assignment.startsAt.toISOString().slice(0, 10)}</span> : null}{p.failureReason ? <div className="text-xs text-red-600">{p.failureReason}</div> : null}</Td>
                    <Td className={`text-right tabular-nums ${p.type === "REFUND" ? "text-emerald-700" : ""}`}>{p.type === "REFUND" ? "−" : ""}{money(p.amountCents, { exact: true })}</Td>
                    <Td><StatusBadge status={p.status} /></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <div className="p-5"><Empty title="No payments yet" /></div>}
        </Card>
      </div>
      {codes.length ? (
        <Card className="mt-6">
          <CardHeader title="Promo codes used" />
          <CardBody className="space-y-1 text-sm">
            {codes.map((c) => <div key={c.id} className="flex justify-between"><span className="font-mono">{c.promoCode.code}</span><span>{c.voidedAt ? "Returned (shift cancelled)" : `−${money(c.discountCents)}`}</span></div>)}
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
