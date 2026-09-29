import { Download, Wallet } from "lucide-react";
import { payoutsOverview } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Input, Select } from "@/components/ui/form";
import { Alert, Empty, PageHeader, Stat, Table, Td, Th } from "@/components/ui/misc";
import { dateLabel, dateTimeLabel, humanize, money } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { adjustmentAction, cancelPayoutAction, holdAction, issuePaymentAction } from "../actions";

export const metadata = { title: "Provider pay" };

export default async function AdminPayouts({ searchParams }: { searchParams: Promise<{ q?: string; provider?: string }> }) {
  const { actor } = await requireActor("admin");
  const f = await searchParams;
  const o = await payoutsOverview(actor, { q: f.q });
  const providers = f.provider ? o.providers.filter((p) => p.provider.id === f.provider) : o.providers;
  const t = o.totals;
  return (
    <>
      <PageHeader
        title="Provider pay"
        description="Every amount owed to providers. Payments go out automatically after the hold period; you can pay early, hold, or adjust. All transfers run through Stripe Connect."
        actions={<a href="/api/exports/payouts" className={buttonClass("outline", "sm")}><Download className="size-4" />Export CSV</a>}
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="Ready to pay" value={money(t.readyCents)} tone="brand" hint="past hold, no disputes" />
        <Stat label="In hold period" value={money(t.scheduledCents)} />
        <Stat label="On hold" value={money(t.onHoldCents)} tone={t.onHoldCents ? "amber" : "default"} />
        <Stat label="Booked (not worked)" value={money(t.upcomingCents)} />
        <Stat label="Paid YTD" value={money(t.paidYtdCents)} tone="green" />
      </div>
      <form className="my-5 flex gap-2"><Input name="q" defaultValue={f.q} placeholder="Search provider" className="w-64" /><button className={buttonClass("outline")}>Search</button></form>
      {providers.length === 0 ? <Empty title="No payouts yet" icon={<Wallet className="size-6" />} /> : null}
      <div className="space-y-5">
        {providers.map(({ provider, summary, rows }) => {
          const open = rows.filter((r) => !["PAID", "CANCELLED"].includes(r.status));
          const owed = summary.readyCents + summary.scheduledCents + summary.onHoldCents;
          return (
            <Card key={provider.id}>
              <CardHeader
                title={provider.displayName}
                description={`Ready ${money(summary.readyCents)} · hold period ${money(summary.scheduledCents)} · on hold ${money(summary.onHoldCents)} · booked ${money(summary.upcomingCents)} · paid ${money(summary.paidCents)}`}
                action={provider.stripePayoutsEnabled ? <Badge tone="green">Stripe ready</Badge> : <Badge tone="red">Payouts not set up</Badge>}
              />
              {open.length ? (
                <ActionForm action={issuePaymentAction} id={`pay-${provider.id}`}>
                  <input type="hidden" name="providerId" value={provider.id} />
                  <Table>
                    <thead><tr><Th /><Th>Item</Th><Th className="text-right">Amount</Th><Th>Status</Th><Th>Release</Th><Th /></tr></thead>
                    <tbody>
                      {open.map((r) => (
                        <tr key={r.id}>
                          <Td><input type="checkbox" name="payoutId" value={r.id} disabled={r.status === "PENDING" || r.onHold || r.disputed} className="size-4" aria-label="Include in payment" /></Td>
                          <Td><div className="font-medium text-slate-900">{r.description}</div><div className="text-xs text-slate-500">{humanize(r.kind)}{r.assignment ? ` · ${dateLabel(r.assignment.startsAt)} · ${r.assignment.professionCode}` : ""}</div></Td>
                          <Td className={`text-right tabular-nums font-semibold ${r.amountCents < 0 ? "text-red-700" : ""}`}>{money(r.amountCents, { exact: true })}</Td>
                          <Td><StatusBadge status={r.disputed ? "DISPUTED" : r.onHold ? "ON_HOLD" : r.status} />{r.holdReason ? <div className="text-xs text-amber-700">{r.holdReason}</div> : null}</Td>
                          <Td className="text-xs">{r.releaseAt ? dateTimeLabel(r.releaseAt) : "after completion"}</Td>
                          <Td>
                            <div className="flex gap-1">
                              {r.status !== "PENDING" ? (
                                <button form={`hold-${r.id}`} className="text-xs text-slate-500 hover:text-slate-900">{r.onHold ? "Release hold" : "Hold"}</button>
                              ) : null}
                              <button form={`cancel-${r.id}`} className="text-xs text-slate-400 hover:text-red-600">Cancel</button>
                            </div>
                          </Td>
                        </tr>
                      ))}
                    </tbody>
                  </Table>
                  <div className="flex flex-wrap items-center gap-3 border-t border-slate-100 px-5 py-3">
                    <Checkbox name="early" label="Pay before the hold period ends" />
                    <Input name="note" placeholder="Note (optional)" className="h-9 w-56" />
                    <SubmitButton size="sm" pendingText="Paying…">Issue payment{owed ? "" : ""}</SubmitButton>
                    <span className="text-xs text-slate-500">Tick items to pay only those; otherwise everything payable is sent. Negative adjustments are netted.</span>
                  </div>
                </ActionForm>
              ) : <CardBody><p className="text-sm text-slate-500">Nothing outstanding.</p></CardBody>}
              {open.map((r) => (
                <div key={r.id} className="hidden">
                  <ActionForm action={holdAction} id={`hold-${r.id}`}><input type="hidden" name="payoutId" value={r.id} /><input type="hidden" name="hold" value={r.onHold ? "0" : "1"} /><input type="hidden" name="reason" value="Held by admin" /></ActionForm>
                  <ActionForm action={cancelPayoutAction} id={`cancel-${r.id}`} confirm="Cancel this payout line?"><input type="hidden" name="payoutId" value={r.id} /></ActionForm>
                </div>
              ))}
              <CardBody className="border-t border-slate-100">
                <ActionForm action={adjustmentAction} className="flex flex-wrap items-end gap-2" resetOnSuccess>
                  <input type="hidden" name="providerId" value={provider.id} />
                  <Select name="direction" className="h-9 w-32"><option value="add">Bonus (+)</option><option value="deduct">Deduct (−)</option></Select>
                  <Input name="amount" placeholder="$ amount" inputMode="decimal" className="h-9 w-28" required />
                  <Input name="description" placeholder="Reason (shown to provider)" className="h-9 w-64" required />
                  <SubmitButton size="sm" variant="outline">Add adjustment</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          );
        })}
      </div>
      {o.transfers.length ? (
        <Card className="mt-6">
          <CardHeader title="Recent transfers" />
          <Table>
            <thead><tr><Th>Date</Th><Th>Provider</Th><Th className="text-right">Amount</Th><Th>Status</Th><Th>By</Th><Th>Stripe</Th></tr></thead>
            <tbody>
              {o.transfers.map((x) => (
                <tr key={x.id}><Td>{dateTimeLabel(x.createdAt)}</Td><Td>{x.provider.displayName}</Td><Td className="text-right tabular-nums">{money(x.amountCents, { exact: true })}</Td><Td><StatusBadge status={x.status} />{x.failureReason ? <div className="text-xs text-red-600">{x.failureReason}</div> : null}</Td><Td className="text-xs">{x.initiatedById ? "admin" : "auto"}{x.note ? ` · ${x.note}` : ""}</Td><Td className="font-mono text-xs">{x.stripeTransferId ?? "—"}</Td></tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
      <Alert tone="info" className="mt-6">Payments are sent automatically every few minutes for items past their hold period. Stripe issues 1099s to providers.</Alert>
    </>
  );
}
