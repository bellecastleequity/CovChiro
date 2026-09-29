import Link from "next/link";
import { prisma, type Prisma } from "@cm/db";
import { StatusBadge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateLabel, money, timeRange } from "@/lib/format";
import { requireActor } from "@/lib/session";

const STATUSES = ["DRAFT", "OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING", "CONFIRMED", "IN_PROGRESS", "COMPLETED", "UNFILLED", "CANCELLED"];

export default async function AdminShifts({ searchParams }: { searchParams: Promise<{ status?: string; state?: string; q?: string }> }) {
  await requireActor("admin");
  const f = await searchParams;
  const where: Prisma.ShiftWhereInput = {
    ...(f.status ? { status: f.status as never } : {}),
    ...(f.state ? { state: f.state.toUpperCase() } : {}),
    ...(f.q ? { location: { clinicOrg: { displayName: { contains: f.q, mode: "insensitive" } } } } : {}),
  };
  const shifts = await prisma.shift.findMany({
    where,
    include: { location: { include: { clinicOrg: true } }, assignments: { where: { status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED", "DISPUTED"] } }, include: { provider: true } }, _count: { select: { applications: { where: { status: "ACTIVE" } } } } },
    orderBy: { startsAt: "desc" },
    take: 200,
  });
  return (
    <>
      <PageHeader title="Shifts" />
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" placeholder="Clinic" defaultValue={f.q} className="w-48" />
        <Input name="state" placeholder="State" defaultValue={f.state} className="w-24" maxLength={2} />
        <Select name="status" defaultValue={f.status ?? ""} className="w-44"><option value="">All statuses</option>{STATUSES.map((s) => <option key={s} value={s}>{s}</option>)}</Select>
        <button className={buttonClass("outline")}>Filter</button>
      </form>
      <Card>
        <Table>
          <thead><tr><Th>When</Th><Th>Clinic</Th><Th>Prof / state</Th><Th>Provider</Th><Th className="text-right">Price / pay</Th><Th>Status</Th></tr></thead>
          <tbody>
            {shifts.map((s) => {
              const a = s.assignments[0];
              return (
                <tr key={s.id} className="hover:bg-slate-50">
                  <Td><Link href={`/admin/shifts/${s.id}`} className="font-medium text-slate-900 hover:text-brand-700">{dateLabel(s.startsAt, s.location.timeZone)}</Link><div className="text-xs text-slate-500">{timeRange(s.startsAt, s.endsAt, s.location.timeZone)}</div></Td>
                  <Td>{s.location.clinicOrg.displayName}<div className="text-xs text-slate-500">{s.location.city}</div></Td>
                  <Td>{s.professionCode} · {s.state}</Td>
                  <Td>{a?.provider.displayName ?? (s._count.applications ? `${s._count.applications} applicants` : "—")}</Td>
                  <Td className="text-right tabular-nums">{money(s.clinicPriceCents - s.promoDiscountCents)}<div className="text-xs text-slate-500">{money(s.providerPayCents)}</div></Td>
                  <Td><StatusBadge status={s.status} /></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
