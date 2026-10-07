import Link from "next/link";
import { chargebacks } from "@cm/services";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateLabel, money } from "@/lib/format";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Card disputes" };
export const dynamic = "force-dynamic";

export default async function Chargebacks() {
  const { actor } = await requireActor("admin");
  const rows = await chargebacks.listChargebacks(actor);
  return (
    <>
      <PageHeader
        back={{ href: "/admin/payments", label: "Payments" }}
        title="Card disputes (chargebacks)"
        description="When a clinic disputes a charge with its bank, Stripe takes the money back plus a fee until the bank decides. Each dispute here has evidence built from the booking's records; review it and submit it before the due date. The clinic can't post new shifts while a dispute is open, and the provider's unsent pay for that booking is held until you release it."
      />
      <Card>
        <Table>
          <thead><tr><Th>Opened</Th><Th>Clinic</Th><Th className="text-right">Amount</Th><Th>Reason</Th><Th>Status</Th><Th>Evidence due</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="text-xs">{dateLabel(r.createdAt)}</Td>
                <Td><Link href={`/admin/payments/chargebacks/${r.id}`} className="font-medium text-slate-900 hover:text-brand-700">{r.clinicName}</Link></Td>
                <Td className="text-right tabular-nums">{money(r.amountCents, { exact: true })}</Td>
                <Td className="text-xs">{r.reason.replace(/_/g, " ")}</Td>
                <Td><Badge tone={r.open ? "red" : r.status === "won" ? "green" : "gray"}>{r.status.replace(/_/g, " ")}</Badge></Td>
                <Td className="text-xs">{r.open && r.evidenceDueBy ? dateLabel(r.evidenceDueBy) : r.evidenceSubmittedAt ? `submitted ${dateLabel(r.evidenceSubmittedAt)}` : "—"}</Td>
              </tr>
            ))}
            {!rows.length ? <tr><Td colSpan={6} className="text-slate-500">No card disputes. Good.</Td></tr> : null}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
