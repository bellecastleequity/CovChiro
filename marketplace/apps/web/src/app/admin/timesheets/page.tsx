import Link from "next/link";
import { hoursLabel } from "@cm/core";
import { timeclock } from "@cm/services";
import { adminApproveAction } from "@/app/timeclock-actions";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { TimesheetStatus } from "@/components/timeclock/timesheet-panel";
import { dateLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Timesheets" };
export const dynamic = "force-dynamic";

const STATUSES = [["SUBMITTED", "Waiting for clinic"], ["DISPUTED", "Problem reported"], ["APPROVED", "Signed off"], ["OPEN", "On the clock"]] as const;

export default async function AdminTimesheets({ searchParams }: { searchParams: Promise<{ status?: string }> }) {
  const { actor } = await requireActor("admin");
  const { status } = await searchParams;
  const { rows, counts } = await timeclock.adminTimesheets(actor, status || undefined);
  return (
    <>
      <PageHeader title="Timesheets" description="Provider punches and clinic sign-offs. Times are stamped by our server; flags show late or early punches, hand-entered times, missing punch-outs and punches far from the clinic. A reported problem is a dispute: resolve it under Payments & disputes. Punches never change pay by themselves." />
      <div className="mb-4 flex flex-wrap gap-2">
        <Link href="/admin/timesheets" className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${!status ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200"}`}>All</Link>
        {STATUSES.map(([k, l]) => <Link key={k} href={`/admin/timesheets?status=${k}`} className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${status === k ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200"}`}>{l} · {counts[k] ?? 0}</Link>)}
      </div>
      <Card className="overflow-x-auto">
        <Table>
          <thead><tr><Th>Shift</Th><Th>Punches</Th><Th>Totals</Th><Th>Status</Th></tr></thead>
          <tbody>
            {rows.length ? rows.map((t) => {
              const a = t.assignment;
              const tz = a.shift.location.timeZone;
              const time = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
              return (
                <tr key={t.id} className="align-top">
                  <Td><Link href={`/admin/shifts/${a.shiftId}`} className="font-medium text-slate-900 hover:text-brand-700">{a.provider.displayName}</Link><div className="text-xs text-slate-500">{a.shift.location.clinicOrg.displayName} · {dateLabel(a.startsAt, tz)}</div></Td>
                  <Td className="text-xs">{a.punches.map((p) => <div key={p.id}>{p.kind.replace("_", " ").toLowerCase()} {time(p.at)}{p.source !== "LIVE" ? ` (${p.source.toLowerCase()})` : ""}{p.distanceMiles != null ? ` · ${p.distanceMiles.toFixed(1)} mi` : ""}</div>)}</Td>
                  <Td className="text-xs">Worked {hoursLabel(t.workedMinutes)}<br />Lunch {hoursLabel(t.breakMinutes)}{t.flags.length ? <div className="mt-1 max-w-56 text-amber-800">{t.flags.join("; ")}</div> : null}</Td>
                  <Td>
                    <TimesheetStatus status={t.status} />
                    {t.status === "APPROVED" ? <div className="mt-1 text-xs text-slate-500">{t.approvalMethod === "AUTO" ? "auto" : `${t.approverName ?? ""} · ${(t.approvalMethod ?? "").toLowerCase().replace("_", " ")}`}</div> : null}
                    {t.status === "SUBMITTED" ? (
                      <ActionForm action={adminApproveAction} className="mt-2 flex gap-1" confirm="Approve on the clinic's behalf?"><input type="hidden" name="assignmentId" value={t.assignmentId} /><Input name="note" placeholder="Why (e.g. confirmed by phone)" className="h-8 w-44 text-xs" /><SubmitButton size="sm" variant="outline">Approve</SubmitButton></ActionForm>
                    ) : null}
                  </Td>
                </tr>
              );
            }) : <tr><Td className="text-slate-500">No timesheets yet.</Td></tr>}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
