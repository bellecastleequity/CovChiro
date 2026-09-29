import { admin } from "@cm/services";
import { buttonClass } from "@/components/ui/button";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateTimeLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";

export default async function Audit({ searchParams }: { searchParams: Promise<{ q?: string; type?: string }> }) {
  const { actor } = await requireActor("admin");
  const f = await searchParams;
  const rows = await admin.searchAudit(actor, { q: f.q, entityType: f.type });
  return (
    <>
      <PageHeader title="Audit log" description="Append-only record of every state change and admin write." />
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={f.q} placeholder="Action or entity id" className="w-64" />
        <Input name="type" defaultValue={f.type} placeholder="Entity type (e.g. Shift)" className="w-48" />
        <button className={buttonClass("outline")}>Search</button>
      </form>
      <Card>
        <Table>
          <thead><tr><Th>When</Th><Th>Action</Th><Th>Entity</Th><Th>Actor</Th><Th>Change</Th></tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <Td className="whitespace-nowrap text-xs">{dateTimeLabel(r.createdAt)}</Td>
                <Td className="font-mono text-xs">{r.action}</Td>
                <Td className="text-xs">{r.entityType}<div className="font-mono text-slate-400">{r.entityId}</div></Td>
                <Td className="text-xs">{r.actorUserId ?? "system"}</Td>
                <Td className="max-w-md"><pre className="max-h-24 overflow-auto whitespace-pre-wrap break-all text-[11px] text-slate-500">{r.after ? JSON.stringify(r.after) : ""}</pre></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
