import Link from "next/link";
import { admin } from "@cm/services";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { requireActor } from "@/lib/session";

export const metadata = { title: "States & professions" };

export default async function States({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { actor } = await requireActor("admin");
  const { all } = await searchParams;
  const { professions, rows } = await admin.stateMatrix(actor);
  const shown = all ? rows : rows.filter((r) => r.state.enabled || r.cells.some((c) => c.psc) || ["FL", "GA", "AL"].includes(r.state.state));
  return (
    <>
      <PageHeader title="States & professions" description="A shift can be posted only where the state AND the profession-state pair are enabled, and (open states) only when at least one doctor can take it. With Settings → Open states on, every state not switched off here opens automatically each hour; switching a state or pair off keeps it off. Click a state to edit its checklist." actions={<Link className="text-sm text-brand-700" href={all ? "/admin/states" : "/admin/states?all=1"}>{all ? "Show active" : "Show all 51"}</Link>} />
      <Card className="overflow-x-auto">
        <table className="w-full min-w-[720px] text-sm">
          <thead>
            <tr className="border-b border-slate-200 text-left text-xs uppercase tracking-wide text-slate-500">
              <th className="px-4 py-2.5">State</th>
              {professions.map((p) => <th key={p.code} className="px-2 py-2.5 text-center">{p.code}</th>)}
            </tr>
          </thead>
          <tbody>
            {shown.map((r) => (
              <tr key={r.state.state} className="border-b border-slate-100">
                <td className="px-4 py-2"><Link href={`/admin/states/${r.state.state}`} className="font-medium hover:text-brand-700">{r.state.state}</Link> <span className={cn("ml-1 text-xs", r.state.enabled ? "text-emerald-600" : "text-slate-400")}>{r.state.enabled ? "enabled" : "off"}</span></td>
                {r.cells.map((c) => (
                  <td key={c.professionCode} className="px-2 py-2 text-center">
                    <Link href={`/admin/states/${r.state.state}?p=${c.professionCode}`} title={Object.entries(c.checklist).map(([k, v]) => `${v ? "✓" : "✗"} ${k}`).join("\n")} className={cn("inline-block rounded-md px-2 py-0.5 text-xs font-medium", c.status === "ENABLED" ? "bg-emerald-100 text-emerald-800" : c.status === "READY" ? "bg-sky-100 text-sky-800" : "bg-slate-100 text-slate-400")}>
                      {c.status === "ENABLED" ? `On · ${c.verifiedProviders}` : c.status === "READY" ? "Ready" : "Off"}
                    </Link>
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </Card>
      <p className="mt-3 text-xs text-slate-500">“On · n” shows verified providers licensed for that pair.</p>
    </>
  );
}
