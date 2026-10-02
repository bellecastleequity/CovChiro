import Link from "next/link";
import { DateTime } from "luxon";
import { brand } from "@cm/config";
import { statements } from "@cm/services";
import { Card } from "@/components/ui/card";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { PrintButton } from "@/components/ui/print-button";
import { dateLabel, money } from "@/lib/format";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Monthly statement" };
export const dynamic = "force-dynamic";

const TYPE: Record<string, string> = { DEPOSIT: "Deposit", BALANCE: "Balance", LODGING: "Lodging", CANCELLATION_FEE: "Cancellation fee", CONVERSION_FEE: "Placement fee", REFUND: "Refund", ADJUSTMENT: "Adjustment" };

export default async function Statement({ searchParams }: { searchParams: Promise<{ month?: string }> }) {
  const { actor } = await requireActor("clinic");
  const months = await statements.clinicStatementMonths(actor);
  const month = (await searchParams).month ?? months[0] ?? DateTime.now().setZone("America/New_York").toFormat("yyyy-LL");
  const st = await statements.clinicStatement(actor, month);
  const b = brand();
  return (
    <>
      <PageHeader title={`Statement: ${st.label}`} description={`${st.org.legalName}${st.org.billingEmail ? ` · ${st.org.billingEmail}` : ""}`} actions={<PrintButton />} />
      <div className="mb-4 flex flex-wrap gap-2 print:hidden">
        {months.map((m) => <Link key={m} href={`/clinic/billing/statement?month=${m}`} className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${m === month ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200"}`}>{DateTime.fromISO(`${m}-01`).toFormat("LLL yyyy")}</Link>)}
      </div>
      <p className="mb-4 hidden text-sm print:block">{b.name} · {b.supportEmail}</p>
      <Card className="overflow-x-auto print:border-0 print:shadow-none">
        <Table>
          <thead><tr><Th>Date</Th><Th>Item</Th><Th>Shift</Th><Th className="text-right">Amount</Th></tr></thead>
          <tbody>
            {st.lines.length ? st.lines.map((l) => (
              <tr key={l.id}>
                <Td className="whitespace-nowrap">{dateLabel(l.date)}</Td>
                <Td>{TYPE[l.type] ?? l.type}{l.description && l.type !== "DEPOSIT" && l.type !== "BALANCE" ? <div className="text-xs text-slate-500">{l.description}</div> : null}</Td>
                <Td className="text-xs">{l.shiftDate ? `${dateLabel(l.shiftDate)} · ${l.location}` : "—"}{l.provider ? <div className="text-slate-500">{l.provider}</div> : null}</Td>
                <Td className="text-right tabular-nums">{money(l.amountCents, { exact: true })}</Td>
              </tr>
            )) : <tr><Td className="text-slate-500">No charges or refunds this month.</Td></tr>}
          </tbody>
          <tfoot>
            <tr className="border-t border-slate-200"><Td colSpan={3} className="text-right">Charges</Td><Td className="text-right tabular-nums">{money(st.charges, { exact: true })}</Td></tr>
            <tr><Td colSpan={3} className="text-right">Refunds</Td><Td className="text-right tabular-nums">{st.refunds ? `−${money(st.refunds, { exact: true })}` : money(0, { exact: true })}</Td></tr>
            <tr className="font-semibold"><Td colSpan={3} className="text-right">Net paid</Td><Td className="text-right tabular-nums">{money(st.net, { exact: true })}</Td></tr>
          </tfoot>
        </Table>
      </Card>
      <p className="mt-3 text-xs text-slate-500">Charged to your card or bank on file through Stripe. Card receipts from Stripe show the same amounts.</p>
    </>
  );
}
