import Link from "next/link";
import { prisma } from "@cm/db";
import { StatusBadge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";

export default async function Clinics() {
  await requireActor("admin");
  const rows = await prisma.clinicOrg.findMany({ include: { locations: true, _count: { select: { payments: true } } }, orderBy: { createdAt: "desc" }, take: 200 });
  return (
    <>
      <PageHeader title="Clinics" />
      <Card>
        <Table>
          <thead><tr><Th>Clinic</Th><Th>Locations</Th><Th>Payment method</Th><Th>Agreement</Th><Th>Status</Th></tr></thead>
          <tbody>
            {rows.map((c) => (
              <tr key={c.id} className="hover:bg-slate-50">
                <Td><Link href={`/admin/clinics/${c.id}`} className="font-medium text-slate-900 hover:text-brand-700">{c.displayName}</Link><div className="text-xs text-slate-500">{c.billingEmail}</div></Td>
                <Td>{c.locations.map((l) => `${l.city}, ${l.state}`).join(" · ") || "—"}</Td>
                <Td>{c.hasPaymentMethod ? "Yes" : "No"}</Td>
                <Td>{c.agreementSignedAt ? `v${c.agreementVersion}` : "—"}</Td>
                <Td><StatusBadge status={c.status} /></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
