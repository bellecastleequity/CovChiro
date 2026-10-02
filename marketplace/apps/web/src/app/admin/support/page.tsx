import Link from "next/link";
import { support } from "@cm/services";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { relative } from "@/lib/format";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Support" };
export const dynamic = "force-dynamic";

const TABS = [["OPEN", "Waiting on us"], ["ANSWERED", "Waiting on them"], ["CLOSED", "Closed"]] as const;

export default async function AdminSupport({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { actor } = await requireActor("admin");
  const { status = "OPEN" } = await searchParams;
  const { rows, counts } = await support.adminList(actor, status === "ALL" ? undefined : status);
  return (
    <>
      <PageHeader title="Support" description="Requests from clinics and providers via Help center → Contact support. Reply here; they get it in the app and by email." />
      <div className="mb-4 flex flex-wrap gap-2">
        {TABS.map(([k, l]) => (
          <Link key={k} href={`/admin/support?status=${k}`} className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${status === k ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200"}`}>
            {l} · {counts[k] ?? 0}
          </Link>
        ))}
        <Link href="/admin/support?status=ALL" className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${status === "ALL" ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200"}`}>All</Link>
      </div>
      <Card className="overflow-x-auto">
        <Table>
          <thead><tr><Th>Request</Th><Th>From</Th><Th>Topic</Th><Th>Last message</Th></tr></thead>
          <tbody>
            {rows.length ? rows.map((r) => (
              <tr key={r.id} className="hover:bg-slate-50">
                <Td><Link href={`/admin/support/${r.id}`} className="font-medium text-slate-900 hover:text-brand-700">{r.subject}</Link><div className="text-xs text-slate-500">{r._count.messages} message{r._count.messages === 1 ? "" : "s"}</div></Td>
                <Td>{r.user.name}<div className="text-xs text-slate-500">{r.audience === "PROVIDER" ? "Provider" : "Clinic"} · {r.user.email}</div></Td>
                <Td className="text-sm">{r.topic}</Td>
                <Td className="text-sm">{relative(r.lastMessageAt)} {r.status === "OPEN" ? <Badge tone="amber">needs reply</Badge> : null}</Td>
              </tr>
            )) : <tr><Td colSpan={4} className="text-center text-sm text-slate-500">Nothing here.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
