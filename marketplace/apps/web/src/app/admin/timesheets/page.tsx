import Link from "next/link";
import { hoursLabel } from "@cm/core";
import { timeclock, volume } from "@cm/services";
import { adminApproveAction, adminSetVisitsAction } from "@/app/timeclock-actions";
import { Badge } from "@/components/ui/badge";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { TimesheetStatus } from "@/components/timeclock/timesheet-panel";
import { dateLabel, money } from "@/lib/format";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Timesheets" };
export const dynamic = "force-dynamic";

const STATUSES = [["SUBMITTED", "Waiting for clinic"], ["DISPUTED", "Problem reported"], ["APPROVED", "Signed off"], ["OPEN", "On the clock"]] as const;

const VOLUME = [["DISPUTED", "Counts disputed"], ["OPEN", "Waiting on clinic"], ["FINAL", "Settled"]] as const;

export default async function AdminTimesheets({ searchParams }: { searchParams: Promise<{ status?: string; volume?: string }> }) {
  const { actor } = await requireActor("admin");
  const { status, volume: vStatus = "DISPUTED" } = await searchParams;
  const { rows, counts } = await timeclock.adminTimesheets(actor, status || undefined);
  const visitRows = await volume.adminVisitCounts(actor, vStatus);
  return (
    <>
      <PageHeader title="Timesheets" description="Provider punches and clinic sign-offs. Times are stamped by our server; flags show late or early punches, hand-entered times, missing punch-outs and punches far from the clinic. A reported problem is a dispute: resolve it under Payments & disputes. Punches never change pay by themselves." />
      <Card className="mb-6 overflow-x-auto" id="visits">
        <CardHeader title="Patient visit counts" description="Volume-priced shifts: the provider's count, the clinic's answer and what was billed. When the counts are far apart the lower one is billed until you set the final count here (audited; charges or refunds the difference and adjusts the provider's pay)." />
        <div className="flex flex-wrap gap-2 px-5 pb-3">
          {VOLUME.map(([k, l]) => <Link key={k} href={`/admin/timesheets?volume=${k}${status ? `&status=${status}` : ""}#visits`} className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${vStatus === k ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200"}`}>{l}</Link>)}
        </div>
        <Table>
          <thead><tr><Th>Shift</Th><Th>Counts</Th><Th>Billed</Th><Th>Final count</Th></tr></thead>
          <tbody>
            {visitRows.length ? visitRows.map((r) => {
              const a = r.assignment;
              const tz = a.shift.location.timeZone;
              return (
                <tr key={r.assignmentId} className="align-top">
                  <Td><Link href={`/admin/shifts/${a.shiftId}`} className="font-medium text-slate-900 hover:text-brand-700">{a.provider.displayName}</Link><div className="text-xs text-slate-500">{a.shift.location.name} · {dateLabel(a.startsAt, tz)} · {a.shift.declaredTier === "LIGHT" ? "Light" : "Busy"} ({a.shift.expectedPatients ?? "?"} expected)</div></Td>
                  <Td className="text-xs">
                    <div>Provider: <b>{r.providerVisits ?? "—"}</b></div>
                    <div>Clinic: <b>{r.clinicVisits ?? "—"}</b>{r.clinicReason ? <span className="text-slate-500"> · {r.clinicReason}</span> : null}</div>
                  </Td>
                  <Td className="text-xs">
                    <Badge tone={r.status === "DISPUTED" ? "amber" : r.status === "FINAL" ? "green" : "gray"}>{r.status}</Badge>
                    <div className="mt-1">{r.finalVisits != null ? `${r.finalVisits} visits · ${r.overageVisits} extra` : "Not settled"}</div>
                    {r.overageVisits ? <div>{money(r.overageClinicCents)} clinic / {money(r.overageProviderCents)} provider{r.chargedAt ? "" : " (not charged yet)"}</div> : null}
                    {r.resolutionNote ? <div className="text-slate-500">Note: {r.resolutionNote}</div> : null}
                  </Td>
                  <Td>
                    <ActionForm action={adminSetVisitsAction} className="flex flex-wrap items-center gap-2">
                      <input type="hidden" name="assignmentId" value={r.assignmentId} />
                      <Input name="visits" type="number" min={0} defaultValue={r.finalVisits ?? r.providerVisits ?? ""} className="h-8 w-20" />
                      <Input name="note" placeholder="Why (for the record)" className="h-8 w-48" />
                      <SubmitButton size="sm" variant="outline">Set</SubmitButton>
                    </ActionForm>
                  </Td>
                </tr>
              );
            }) : <tr><Td colSpan={4} className="text-center text-sm text-slate-500">Nothing here.</Td></tr>}
          </tbody>
        </Table>
      </Card>
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
