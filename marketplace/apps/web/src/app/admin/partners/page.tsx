import Link from "next/link";
import { getSettings, partners } from "@cm/services";
import { Card, CardBody } from "@/components/ui/card";
import { Alert, Empty, PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateLabel, money } from "@/lib/format";
import { requireActor } from "@/lib/session";

const YMD: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

export const metadata = { title: "Partner clinics" };
export const dynamic = "force-dynamic";

const STATUS: Record<string, string> = { OFFERED: "Offer sent", ACTIVE: "Partner", ENDED: "Ended / ending" };

/** Partner clinic program report: every partnership with the discounts given (all time and this term). */
export default async function AdminPartners() {
  const { actor } = await requireActor("admin");
  const [rows, s] = await Promise.all([partners.partnerReport(actor), getSettings()]);
  const total = rows.reduce((t, r) => t + r.all.cents, 0);
  return (
    <>
      <PageHeader title="Partner clinics" description={`Clinics that book all their coverage with us in return for ${s["partner.discountPercent"]}% off (from our margin, never provider pay) and rates locked each ${s["partner.termMonths"]}-month term. Offer a partnership from a clinic's admin page.`} />
      {!s["features.partnerProgram"] ? <Alert tone="warning" className="mb-5" title="The program is off">No partner discount or rate lock is applied while Settings → Features → Partner clinic program is off.</Alert> : null}
      <Card>
        <CardBody className="p-0">
          {rows.length ? (
            <Table>
              <thead><tr><Th>Clinic</Th><Th>Status</Th><Th>Discount</Th><Th>Current term</Th><Th className="text-right">This term</Th><Th className="text-right">All time</Th></tr></thead>
              <tbody>
                {rows.map(({ p, term, all, current }) => (
                  <tr key={p.id}>
                    <Td><Link className="font-medium text-brand-700" href={`/admin/clinics/${p.clinicOrg.id}`}>{p.clinicOrg.displayName}</Link></Td>
                    <Td>{STATUS[p.status] ?? p.status}{p.status === "ENDED" && p.endedAt ? ` · ${dateLabel(p.endedAt, undefined, YMD)}` : ""}</Td>
                    <Td>{p.discountPercent}%</Td>
                    <Td>{term ? `${term.termNumber}: ${dateLabel(term.termStart, undefined, YMD)} – ${dateLabel(term.termEnd, undefined, YMD)}` : p.status === "OFFERED" ? `offered ${dateLabel(p.offeredAt, undefined, YMD)}` : "—"}</Td>
                    <Td className="text-right tabular-nums">{current ? `${money(current.cents)} (${current.bookings})` : "—"}</Td>
                    <Td className="text-right tabular-nums">{money(all.cents)} ({all.bookings})</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          ) : (
            <Empty title="No partner clinics yet" />
          )}
        </CardBody>
      </Card>
      {rows.length ? <p className="mt-3 text-sm text-slate-500">Total partner discounts given: <b>{money(total)}</b>. Counts bookings that stand (cancelled ones are refunded).</p> : null}
    </>
  );
}
