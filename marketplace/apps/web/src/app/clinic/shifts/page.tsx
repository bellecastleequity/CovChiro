import Link from "next/link";
import { CalendarDays, PlusCircle } from "lucide-react";
import { prisma } from "@cm/db";
import { StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Empty, PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateLabel, money, timeRange } from "@/lib/format";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Shifts" };

export default async function Shifts() {
  const { actor } = await requireActor("clinic");
  const shifts = await prisma.shift.findMany({
    where: { location: { clinicOrgId: actor.clinicOrgId! } },
    include: { location: true, assignments: { where: { status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED", "DISPUTED"] } }, include: { provider: true } }, _count: { select: { applications: { where: { status: "ACTIVE" } } } } },
    orderBy: { startsAt: "desc" },
    take: 200,
  });
  return (
    <>
      <PageHeader title="Shifts" actions={<LinkButton href="/clinic/shifts/new"><PlusCircle className="size-4" />Post a shift</LinkButton>} />
      {shifts.length ? (
        <Card>
          <Table>
            <thead><tr><Th>Date</Th><Th>Location</Th><Th>Coverage</Th><Th>Provider</Th><Th className="text-right">Price</Th><Th>Status</Th></tr></thead>
            <tbody>
              {shifts.map((s) => {
                const a = s.assignments[0];
                return (
                  <tr key={s.id} className="hover:bg-slate-50">
                    <Td><Link href={`/clinic/shifts/${s.id}`} className="font-medium text-slate-900 hover:text-brand-700">{dateLabel(s.startsAt, s.location.timeZone)}</Link><div className="text-xs text-slate-500">{timeRange(s.startsAt, s.endsAt, s.location.timeZone)}</div></Td>
                    <Td>{s.location.name}</Td>
                    <Td>{s.professionCode}</Td>
                    <Td>{a ? a.provider.displayName : s._count.applications ? <span className="text-brand-700">{s._count.applications} applicant{s._count.applications === 1 ? "" : "s"}</span> : "—"}</Td>
                    <Td className="text-right tabular-nums">{money(a ? a.clinicTotalCents : s.clinicPriceCents - s.promoDiscountCents)}</Td>
                    <Td><StatusBadge status={s.status} /></Td>
                  </tr>
                );
              })}
            </tbody>
          </Table>
        </Card>
      ) : (
        <Empty title="No shifts yet" icon={<CalendarDays className="size-6" />} action={<LinkButton href="/clinic/shifts/new">Post your first shift</LinkButton>} />
      )}
    </>
  );
}
