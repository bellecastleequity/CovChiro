import Link from "next/link";
import { getSettings, tax } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, PageHeader, Stat, Table, Td, Th } from "@/components/ui/misc";
import { dateLabel, money } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { refreshTaxAction } from "../../actions";

export const metadata = { title: "1099 report" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, { tone: "green" | "amber" | "red" | "gray"; label: string }> = {
  COMPLETE: { tone: "green", label: "Complete" },
  LAST4: { tone: "amber", label: "Last 4 of SSN only" },
  MISSING: { tone: "red", label: "Missing" },
  UNKNOWN: { tone: "gray", label: "Not checked" },
};

export default async function Form1099({ searchParams }: { searchParams: Promise<{ year?: string }> }) {
  const { actor } = await requireActor("admin");
  const thisYear = new Date().getFullYear();
  const year = Number((await searchParams).year) || thisYear;
  const r = await tax.form1099Report(actor, year);
  const s = await getSettings();
  return (
    <>
      <PageHeader
        back={{ href: "/admin/payments", label: "Payments" }}
        title={`1099 report · ${year}`}
        description="What each provider was paid in the calendar year, to check against Stripe before 1099s go out. Stripe holds every provider's legal name, address and SSN or EIN (their W-9 details) and can file and deliver the 1099-NEC forms: Stripe Dashboard → Connect → Tax forms."
        actions={<a className={buttonClass("outline", "sm")} href={`/api/exports/form1099?year=${year}`}>Download CSV</a>}
      />
      <div className="mb-4 flex flex-wrap gap-2 text-sm">
        {[thisYear, thisYear - 1, thisYear - 2].map((y) => (
          <Link key={y} href={`?year=${y}`} className={buttonClass(y === year ? "primary" : "outline", "sm")}>{y}</Link>
        ))}
      </div>
      <div className="mb-6 grid gap-4 sm:grid-cols-3">
        <Stat label="Providers paid" value={String(r.rows.length)} />
        <Stat label={`At or over ${money(r.thresholdCents)}`} value={String(r.over)} />
        <Stat label="Over it, tax info not complete" value={String(r.needsTaxInfo)} />
      </div>
      {r.needsTaxInfo ? <Alert tone="warning" className="mb-6" title="Some providers over the threshold don't have complete tax info with Stripe">Ask them to open Payouts on their account and finish Stripe&apos;s tax step, then press &ldquo;Refresh from Stripe&rdquo;.</Alert> : null}
      <Card className="mb-6">
        <CardBody className="space-y-2 text-sm text-slate-600">
          <p>Threshold: {money(r.thresholdCents)} per provider per year (Settings → Taxes (1099)). Paid = payouts sent in {year}, by the date they were paid.</p>
          <p>&ldquo;Travel allowances&rdquo; are the flat mileage, lodging and airfare amounts inside shift pay (no receipts). Ask your accountant whether they belong in box 1; the threshold flag uses the full total so nobody is missed.</p>
          <ActionForm action={refreshTaxAction} successMessage>
            <SubmitButton size="sm" variant="outline">Refresh tax info from Stripe</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Providers" />
        <Table>
          <thead><tr><Th>Provider</Th><Th>Paid as</Th><Th>Tax info (Stripe)</Th><Th className="text-right">Total paid</Th><Th className="text-right">Travel allowances</Th><Th className="text-right">Adjustments</Th><Th /></tr></thead>
          <tbody>
            {r.rows.map((x) => (
              <tr key={x.id}>
                <Td><Link href={`/admin/providers/${x.id}`} className="font-medium text-slate-900 hover:text-brand-700">{x.legalName}</Link><div className="text-xs text-slate-500">{x.email}</div></Td>
                <Td className="text-xs">{x.taxEntity === "COMPANY" ? "Company (EIN)" : "Individual (SSN)"}</Td>
                <Td><Badge tone={STATUS[x.taxInfoStatus]?.tone ?? "gray"}>{STATUS[x.taxInfoStatus]?.label ?? x.taxInfoStatus}</Badge>{x.taxCheckedAt ? <div className="text-xs text-slate-400">checked {dateLabel(x.taxCheckedAt)}</div> : null}</Td>
                <Td className="text-right tabular-nums font-medium">{money(x.totalCents, { exact: true })}</Td>
                <Td className="text-right tabular-nums text-slate-600">{money(x.travelCents, { exact: true })}</Td>
                <Td className="text-right tabular-nums text-slate-600">{money(x.adjustmentsCents, { exact: true })}</Td>
                <Td>{x.overThreshold ? <Badge tone="brand">1099</Badge> : null}</Td>
              </tr>
            ))}
            {!r.rows.length ? <tr><Td colSpan={7} className="text-slate-500">No provider payments in {year}.</Td></tr> : null}
          </tbody>
        </Table>
      </Card>
      <p className="mt-4 text-xs text-slate-400">No tax IDs are stored on this site. {s["tax.form1099ThresholdDollars"] < 2000 ? "" : "The $2,000 threshold applies to payments made from 2026 on; it was $600 before. Confirm with your accountant."}</p>
    </>
  );
}
