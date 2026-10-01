import Link from "next/link";
import { prisma } from "@cm/db";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { pct } from "@/lib/format";
import { requireActor } from "@/lib/session";

export default async function Providers({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  await requireActor("admin");
  const { q } = await searchParams;
  const rows = await prisma.provider.findMany({
    where: q ? { OR: [{ legalName: { contains: q, mode: "insensitive" } }, { displayName: { contains: q, mode: "insensitive" } }, { user: { email: { contains: q, mode: "insensitive" } } }] } : {},
    include: { user: true, licenses: { where: { status: "VERIFIED" } }, stats: true, professions: true },
    orderBy: { createdAt: "desc" },
    take: 200,
  });
  return (
    <>
      <PageHeader title="Providers" />
      <form className="mb-4 flex gap-2"><Input name="q" defaultValue={q} placeholder="Name or email" className="w-64" /><button className={buttonClass("outline")}>Search</button></form>
      <Card>
        <Table>
          <thead><tr><Th>Provider</Th><Th>Professions</Th><Th>Verified licenses</Th><Th>Completed</Th><Th>Reliability</Th><Th>Status</Th></tr></thead>
          <tbody>
            {rows.map((p) => {
              const s = p.stats;
              const rel = s ? (s.completedShifts + 5) / (s.completedShifts + 5 + 2 * s.lateCancels + 5 * s.noShows) : 1;
              return (
                <tr key={p.id} className="hover:bg-slate-50">
                  <Td><Link href={`/admin/providers/${p.id}`} className="font-medium text-slate-900 hover:text-brand-700">{p.displayName}</Link><div className="text-xs text-slate-500">{p.user.email}</div></Td>
                  <Td>{p.professions.map((x) => x.professionCode).join(", ")}</Td>
                  <Td>{p.licenses.map((l) => `${l.professionCode}-${l.state}`).join(", ") || "—"}</Td>
                  <Td>{s?.completedShifts ?? 0}</Td>
                  <Td>{pct(rel)}</Td>
                  <Td><div className="flex flex-wrap gap-1"><StatusBadge status={p.status} />{p.preLicensure ? <Badge tone="blue">Student</Badge> : null}</div></Td>
                </tr>
              );
            })}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
