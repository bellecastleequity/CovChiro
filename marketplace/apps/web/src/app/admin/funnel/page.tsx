import Link from "next/link";
import { prelicensure } from "@cm/services";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, PageHeader, Stat, Table, Td, Th } from "@/components/ui/misc";
import { money } from "@/lib/format";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Provider funnel" };

const pct = (a: number, b: number) => (b ? `${Math.round((a / b) * 100)}%` : "—");

function GroupTable({ rows, costs }: { rows: Awaited<ReturnType<typeof prelicensure.providerFunnel>>["bySource"]; costs?: boolean }) {
  if (!rows.length) return <p className="text-sm text-slate-500">No providers yet.</p>;
  return (
    <Table>
      <thead>
        <tr>
          <Th>&nbsp;</Th>
          <Th className="text-right">Registered</Th>
          <Th className="text-right">Licensed</Th>
          <Th className="text-right">Ready (ever)</Th>
          <Th className="text-right">Ready now</Th>
          <Th className="text-right">First shift</Th>
          <Th className="text-right">Reg → ready</Th>
          {costs ? <Th className="text-right">Cost / ready</Th> : null}
        </tr>
      </thead>
      <tbody>
        {rows.map((r) => (
          <tr key={r.key}>
            <Td>{r.label}</Td>
            <Td className="text-right">{r.registered}</Td>
            <Td className="text-right">{r.licensed}</Td>
            <Td className="text-right">{r.coverageReady}</Td>
            <Td className="text-right">{r.readyNow}</Td>
            <Td className="text-right">{r.firstShift}</Td>
            <Td className="text-right">{pct(r.coverageReady, r.registered)}</Td>
            {costs ? <Td className="text-right">{r.costCents && r.coverageReady ? money(Math.round(r.costCents / r.coverageReady)) : "—"}</Td> : null}
          </tr>
        ))}
      </tbody>
    </Table>
  );
}

export default async function Funnel({ searchParams }: { searchParams: Promise<{ students?: string }> }) {
  const { actor } = await requireActor("admin");
  const studentsOnly = (await searchParams).students === "1";
  const f = await prelicensure.providerFunnel(actor, { studentsOnly });
  const max = Math.max(1, ...f.steps.map((s) => s.count));
  return (
    <>
      <PageHeader
        title="Provider funnel"
        description="From first visit to repeat provider. Counts are how many have ever reached each step."
        actions={
          <div className="flex gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
            <Link href="/admin/funnel" className={`rounded-lg px-3 py-1.5 ${!studentsOnly ? "bg-white shadow-sm" : "text-slate-500"}`}>All providers</Link>
            <Link href="/admin/funnel?students=1" className={`rounded-lg px-3 py-1.5 ${studentsOnly ? "bg-white shadow-sm" : "text-slate-500"}`}>Students only</Link>
          </div>
        }
      />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-3">
        <Stat label="Registered providers" value={f.headline.registered} hint="Every provider account, any stage" />
        <Stat label="Coverage-ready now" value={f.headline.coverageReady} tone="green" hint="Would be matched to a shift today" />
        <Stat label="On the student path" value={f.headline.students} tone="brand" hint="Not yet licensed" />
      </div>
      <Alert tone="warning" className="mt-4">
        Quote <strong>coverage-ready</strong> providers ({f.headline.coverageReady}) when describing network size — registered accounts ({f.headline.registered}) include students and anyone not yet verified.
      </Alert>
      <Card className="mt-6">
        <CardHeader title="Funnel" description="Percentages are conversion from the step above." />
        <CardBody className="space-y-2.5">
          {f.steps.map((s, i) => (
            <div key={s.key} className="grid grid-cols-[minmax(8rem,14rem)_1fr_5.5rem] items-center gap-3 text-sm">
              <div className="text-slate-700">{s.label}</div>
              <div className="h-3 rounded-full bg-slate-100">
                <div className={`h-3 rounded-full ${s.key === "coverageReady" || s.key === "firstShift" || s.key === "repeat" ? "bg-accent-600" : "bg-brand-500"}`} style={{ width: `${(s.count / max) * 100}%` }} />
              </div>
              <div className="text-right tabular-nums">
                {s.count} {i > 0 ? <span className="text-xs text-slate-400">{pct(s.count, f.steps[i - 1]!.count)}</span> : null}
              </div>
            </div>
          ))}
        </CardBody>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Where providers are today" />
        <Table>
          <tbody>
            {f.stages.map((s) => (
              <tr key={s.key}>
                <Td>{s.label}</Td>
                <Td className="text-right">{s.count}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card className="mt-6">
        <CardHeader title="By acquisition source" description="Channel spend lives with each recruitment link (Recruitment page)." />
        <GroupTable rows={f.bySource} />
      </Card>
      <Card className="mt-6">
        <CardHeader title="By recruitment link" />
        <GroupTable rows={f.byCampaign} costs />
      </Card>
      <Card className="mt-6">
        <CardHeader title="By school" />
        <GroupTable rows={f.bySchool} />
      </Card>
    </>
  );
}
