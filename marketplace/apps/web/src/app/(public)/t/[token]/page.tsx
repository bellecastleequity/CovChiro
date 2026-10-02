import { notFound } from "next/navigation";
import { brand } from "@cm/config";
import { timeclock, volume } from "@cm/services";
import { tokenApproveAction, tokenConfirmVisitsAction, tokenReportAction, tokenReportVisitsAction } from "@/app/timeclock-actions";
import { ClinicVisitPanel } from "@/components/timeclock/visit-count";
import { SignOffForm } from "@/components/timeclock/signoff-form";
import { TimesheetPanel, TimesheetStatus } from "@/components/timeclock/timesheet-panel";

export const dynamic = "force-dynamic";
export const metadata = { title: "Timesheet sign-off", robots: { index: false } };

/** One-tap sign-off from the clinic's email (the signed link covers this one timesheet). */
export default async function TimesheetLink({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const v = await timeclock.timesheetByToken(token);
  if (!v) notFound();
  const visits = await volume.visitViewByToken(token);
  const b = brand();
  const day = v.startsAt.toLocaleDateString("en-US", { timeZone: v.timeZone, weekday: "long", month: "long", day: "numeric" });
  return (
    <section className="mx-auto max-w-xl px-4 py-10">
      <p className="text-sm font-semibold uppercase tracking-wide text-accent-700">{b.name} timesheet</p>
      <h1 className="mt-1 text-2xl font-semibold tracking-tight">{v.providerName}</h1>
      <p className="mt-1 text-slate-600">{v.locationName} · {day}</p>
      {v.punches.length || !visits ? <div className="mt-2"><TimesheetStatus status={v.status} /></div> : null}
      {visits ? (
        <div className={`mt-6 rounded-2xl border bg-white p-5 shadow-card ${visits.canRespond ? "border-amber-300 ring-2 ring-amber-100" : "border-slate-200"}`}>
          <h2 className="mb-3 font-semibold">Patient visits</h2>
          <ClinicVisitPanel v={visits} tz={v.timeZone} hidden={{ token }} confirm={tokenConfirmVisitsAction} report={tokenReportVisitsAction} />
        </div>
      ) : null}
      {v.punches.length || !visits ? (
      <div className="mt-6 rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
        <TimesheetPanel v={v} />
        {v.status === "SUBMITTED" ? (
          <div className="mt-6 border-t border-slate-100 pt-5">
            <h2 className="mb-3 font-semibold">Sign off</h2>
            <SignOffForm approve={tokenApproveAction} report={tokenReportAction} hidden={{ token }} />
          </div>
        ) : v.status === "APPROVED" ? (
          <details className="mt-4 rounded-xl border border-slate-200 px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium text-red-700">Something&apos;s not right?</summary>
            <SignOffForm approve={tokenApproveAction} report={tokenReportAction} hidden={{ token }} reportOnly />
          </details>
        ) : v.status === "OPEN" ? <p className="mt-4 text-sm text-slate-500">The provider hasn&apos;t punched out yet. You&apos;ll get an email when it&apos;s ready to sign off.</p> : null}
      </div>
      ) : null}
    </section>
  );
}
