import Link from "next/link";
import { welcome } from "@cm/services";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, Empty, PageHeader, Stat, Table, Td, Th } from "@/components/ui/misc";
import { money } from "@/lib/format";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Welcome Discount" };
export const dynamic = "force-dynamic";

const pct = (n: number, d: number) => (d ? `${Math.round((n / d) * 100)}%` : "—");

/** Welcome Discount report (docs/specs/welcome-discount.md §12): who has what, what it cost, who came back. */
export default async function AdminWelcome() {
  const { actor } = await requireActor("admin");
  const r = await welcome.welcomeReport(actor);
  const econ = [
    { label: "Welcome bookings", e: r.promo },
    { label: "Standard-rate bookings", e: r.standard },
    { label: "After the introductory bookings", e: r.afterIntro },
  ];
  return (
    <>
      <PageHeader title="Welcome Discount" description={`${r.settings.percent}% off each clinic's first ${r.settings.bookings} completed bookings, from our margin only (provider pay never changes). Change the percent, count or new enrollment in Settings → Welcome Discount; existing clinics keep what they have.`} />
      {!r.settings.enabled ? <Alert tone="warning" className="mb-5" title="New enrollment is off">New clinics don&apos;t get a Welcome Discount. Clinics that already have one keep it.</Alert> : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Clinics with the offer" value={r.clinics} />
        <Stat label="Reserved now" value={r.reserved} tone="brand" />
        <Stat label="Used (completed)" value={r.redeemed} tone="green" />
        <Stat label="Discounts funded" value={money(r.discountsFundedCents)} />
      </div>
      <div className="mt-3 grid grid-cols-2 gap-3 lg:grid-cols-5">
        <Stat label="3 left" value={r.available[3]} />
        <Stat label="2 left" value={r.available[2]} />
        <Stat label="1 left" value={r.available[1]} />
        <Stat label="0 left" value={r.available[0]} />
        <Stat label="Waiting for review" value={r.review} tone={r.review ? "amber" : "default"} />
      </div>
      <Card className="mt-6">
        <CardHeader title="Economics" description="Card fees are an estimate (2.9% + 30¢ per charge). Coverage only: mileage, lodging and airfare pass through." />
        <CardBody className="p-0">
          <Table>
            <thead><tr><Th>Bookings</Th><Th className="text-right">Count</Th><Th className="text-right">Avg. coverage</Th><Th className="text-right">Clinics paid</Th><Th className="text-right">Provider pay</Th><Th className="text-right">Spread</Th><Th className="text-right">Card fees (est.)</Th><Th className="text-right">Net contribution</Th></tr></thead>
            <tbody>
              {econ.map(({ label, e }) => (
                <tr key={label}>
                  <Td>{label}</Td>
                  <Td className="text-right tabular-nums">{e.bookings}</Td>
                  <Td className="text-right tabular-nums">{money(e.avgCents)}</Td>
                  <Td className="text-right tabular-nums">{money(e.clinicCents)}</Td>
                  <Td className="text-right tabular-nums">{money(e.providerCents)}</Td>
                  <Td className="text-right tabular-nums">{money(e.spreadCents)}</Td>
                  <Td className="text-right tabular-nums">{money(e.feesCents)}</Td>
                  <Td className="text-right tabular-nums">{money(e.contributionCents)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </CardBody>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Do clinics come back?" description="Analytics only: never used to decide who gets the discount." />
        <CardBody className="grid grid-cols-2 gap-3 text-sm lg:grid-cols-4">
          <Stat label="1st → 2nd booking" value={pct(r.retention.second, r.retention.first)} />
          <Stat label="2nd → 3rd" value={pct(r.retention.third, r.retention.second)} />
          <Stat label="3rd → 4th (full price)" value={pct(r.retention.fourth, r.retention.third)} />
          <Stat label="Lifetime coverage per clinic" value={money(r.lifetimeAvgCents)} />
          <Stat label="Repeat within 30 days" value={pct(r.retention.repeat30, r.retention.first)} />
          <Stat label="Within 60 days" value={pct(r.retention.repeat60, r.retention.first)} />
          <Stat label="Within 90 days" value={pct(r.retention.repeat90, r.retention.first)} />
          <Stat label="Avg. days between bookings" value={r.retention.avgDaysBetween ?? "—"} />
        </CardBody>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Clinics" />
        <CardBody className="p-0">
          {r.rows.length ? (
            <Table>
              <thead><tr><Th>Clinic</Th><Th>Status</Th><Th className="text-right">Used</Th><Th className="text-right">Reserved</Th><Th className="text-right">Saved</Th><Th className="text-right">Completed bookings</Th></tr></thead>
              <tbody>
                {r.rows.slice(0, 300).map((x) => (
                  <tr key={x.id}>
                    <Td><Link className="font-medium text-brand-700" href={`/admin/clinics/${x.id}#welcome`}>{x.name}</Link></Td>
                    <Td>{x.status === "REVIEW" ? <span className="font-medium text-amber-700">Review</span> : "Active"}</Td>
                    <Td className="text-right tabular-nums">{x.used} / {x.total}</Td>
                    <Td className="text-right tabular-nums">{x.reserved}</Td>
                    <Td className="text-right tabular-nums">{money(x.savedCents)}</Td>
                    <Td className="text-right tabular-nums">{x.completedBookings}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : <Empty title="No clinics have the Welcome Discount yet" />}
        </CardBody>
      </Card>
    </>
  );
}
