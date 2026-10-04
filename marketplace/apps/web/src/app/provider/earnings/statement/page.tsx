import Link from "next/link";
import { DateTime } from "luxon";
import { brand } from "@cm/config";
import { statements } from "@cm/services";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader, Stat, Table, Td, Th } from "@/components/ui/misc";
import { PrintButton } from "@/components/ui/print-button";
import { dateLabel, money } from "@/lib/format";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Earnings summary" };
export const dynamic = "force-dynamic";

const KIND: Record<string, string> = { SHIFT: "Shift pay", LODGING: "Lodging", LATE_CANCEL: "Late-cancel share", ADJUSTMENT: "Adjustment / bonus" };

export default async function EarningsStatement({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { actor } = await requireActor("provider");
  const thisYear = DateTime.now().setZone("America/New_York").year;
  const year = Number((await searchParams).year ?? thisYear);
  const st = await statements.providerAnnualStatement(actor, year);
  const b = brand();
  return (
    <>
      <PageHeader back={{ href: "/provider/earnings", label: "Earnings" }} title={`${year} earnings summary`} description={`${st.provider.legalName} · paid through ${b.name} (Stripe)`} actions={<PrintButton />} />
      <div className="mb-4 flex flex-wrap gap-2 print:hidden">
        {[thisYear, thisYear - 1, thisYear - 2].map((y) => <Link key={y} href={`/provider/earnings/statement?year=${y}`} className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${y === year ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200"}`}>{y}</Link>)}
      </div>
      <div className="mb-6 grid grid-cols-2 gap-3 sm:grid-cols-3">
        <Stat label={`Paid in ${year}`} value={money(st.total, { exact: true })} tone="green" />
        <Stat label="Shifts paid" value={st.shifts} />
        <Stat label="Payments" value={st.lines.length} />
      </div>
      <Card className="mb-6 print:border-0 print:shadow-none">
        <CardHeader title="By month" />
        <Table>
          <tbody>{st.byMonth.map((m) => <tr key={m.label}><Td>{m.label}</Td><Td className="text-right tabular-nums">{m.cents ? money(m.cents, { exact: true }) : "—"}</Td></tr>)}</tbody>
        </Table>
      </Card>
      <Card className="overflow-x-auto print:border-0 print:shadow-none">
        <CardHeader title="Every payment" />
        <Table>
          <thead><tr><Th>Paid</Th><Th>Item</Th><Th>Shift</Th><Th className="text-right">Amount</Th></tr></thead>
          <tbody>
            {st.lines.length ? st.lines.map((l) => (
              <tr key={l.id}>
                <Td className="whitespace-nowrap">{dateLabel(l.paidAt)}</Td>
                <Td>{KIND[l.kind] ?? l.kind}{l.kind === "ADJUSTMENT" ? <div className="text-xs text-slate-500">{l.description}</div> : null}</Td>
                <Td className="text-xs">{l.shiftDate ? `${dateLabel(l.shiftDate)} · ${l.clinic}` : "—"}</Td>
                <Td className="text-right tabular-nums">{money(l.amountCents, { exact: true })}</Td>
              </tr>
            )) : <tr><Td className="text-slate-500">No payments in {year}.</Td></tr>}
          </tbody>
        </Table>
      </Card>
      <p className="mt-3 text-xs text-slate-500">For your records. Payments are made to you as an independent professional; where required, Stripe sends your official tax form (1099) for the year. Shift pay includes any mileage reimbursement.</p>
    </>
  );
}
