import { Download, Wallet } from "lucide-react";
import { providerEarnings } from "@cm/services";
import { StatusBadge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardHeader } from "@/components/ui/card";
import { Empty, PageHeader, Stat, Table, Td, Th } from "@/components/ui/misc";
import { dateLabel, dateTimeLabel, humanize, money } from "@/lib/format";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Earnings" };

export default async function Earnings() {
  const { actor } = await requireActor("provider");
  const e = await providerEarnings(actor);
  const s = e.summary;
  return (
    <>
      <PageHeader title="Earnings" description="Every dollar you're owed, when it's released, and what's been paid." actions={<a href="/api/exports/earnings" className={buttonClass("outline", "sm")}><Download className="size-4" />Export CSV</a>} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Upcoming (booked)" value={money(s.upcomingCents)} hint="Confirmed shifts not yet worked" />
        <Stat label="In hold period" value={money(s.scheduledCents + s.readyCents)} hint="Released automatically after the hold" tone="brand" />
        <Stat label="On hold" value={money(s.onHoldCents)} hint="Dispute or review in progress" tone={s.onHoldCents ? "amber" : "default"} />
        <Stat label="Paid this year" value={money(s.paidYtdCents)} hint={`${money(s.paidCents)} all time`} tone="green" />
      </div>
      <Card className="mt-6">
        <CardHeader title="Pay ledger" />
        {e.rows.length ? (
          <Table>
            <thead><tr><Th>Item</Th><Th>Shift</Th><Th className="text-right">Amount</Th><Th>Status</Th><Th>Release / paid</Th></tr></thead>
            <tbody>
              {e.rows.map((r) => (
                <tr key={r.id}>
                  <Td><div className="font-medium text-slate-900">{r.description}</div><div className="text-xs text-slate-500">{humanize(r.kind)}{r.clinic ? ` · ${r.clinic}` : ""}</div></Td>
                  <Td>{r.shiftDate ? dateLabel(r.shiftDate) : "—"}</Td>
                  <Td className={`text-right font-semibold tabular-nums ${r.amountCents < 0 ? "text-red-700" : ""}`}>{money(r.amountCents, { exact: true })}</Td>
                  <Td><StatusBadge status={r.disputed ? "DISPUTED" : r.status} />{r.holdReason ? <div className="mt-1 text-xs text-amber-700">{r.holdReason}</div> : null}</Td>
                  <Td className="text-xs">{r.paidAt ? `Paid ${dateTimeLabel(r.paidAt)}` : r.releaseAt ? `Releases ${dateTimeLabel(r.releaseAt)}` : "After the shift"}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <div className="p-5"><Empty title="No earnings yet" icon={<Wallet className="size-6" />}>Once you're confirmed for a shift, your pay shows up here.</Empty></div>
        )}
      </Card>
      {e.transfers.length ? (
        <Card className="mt-6">
          <CardHeader title="Payments sent" description="Transfers to your bank through Stripe." />
          <Table>
            <thead><tr><Th>Date</Th><Th className="text-right">Amount</Th><Th>Status</Th><Th>Reference</Th></tr></thead>
            <tbody>
              {e.transfers.map((t) => (
                <tr key={t.id}><Td>{dateTimeLabel(t.paidAt ?? t.createdAt)}</Td><Td className="text-right font-semibold tabular-nums">{money(t.amountCents, { exact: true })}</Td><Td><StatusBadge status={t.status} /></Td><Td className="font-mono text-xs">{t.stripeTransferId ?? "—"}</Td></tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
    </>
  );
}
