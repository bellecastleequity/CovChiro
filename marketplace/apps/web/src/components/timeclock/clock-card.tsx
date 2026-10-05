import { DateTime } from "luxon";
import { nextPunches, type PunchKind } from "@cm/core";
import type { timeclock } from "@cm/services";
import { missedPunchAction, onsiteSignAction, providerNoteAction } from "@/app/timeclock-actions";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { PunchButtons } from "./punch-buttons";
import { SignOffForm } from "./signoff-form";
import { TimesheetPanel, TimesheetStatus } from "./timesheet-panel";

type View = Awaited<ReturnType<typeof timeclock.timesheetView>>;
const LABEL: Record<PunchKind, string> = { IN: "Punch in", BREAK_START: "Lunch start", BREAK_END: "Lunch end", OUT: "Punch out" };

/** Provider's time clock for one shift: punch buttons, the day so far, missed punches, on-site sign-off. */
export function ClockCard({ v, title = "Time clock" }: { v: View; title?: string }) {
  if (!v.enabled) return null;
  const status = v.timesheet?.status ?? "OPEN";
  const next = status === "OPEN" ? nextPunches(v.punches.map((p) => ({ kind: p.kind, at: p.at }))) : [];
  const closesAt = +v.endsAt + 6 * 3_600_000;
  const live = Date.now() < closesAt;
  const nowLocal = DateTime.now().setZone(v.timeZone).toFormat("yyyy-LL-dd'T'HH:mm");
  return (
    <Card className="border-brand-200 ring-1 ring-brand-100">
      <CardHeader title={title} description={`${v.locationName} · ${v.clinicName}`} action={<TimesheetStatus status={status} />} />
      <CardBody className="space-y-4">
        {next.length && live ? <PunchButtons assignmentId={v.assignmentId} next={next as never} tz={v.timeZone} /> : null}
        <TimesheetPanel v={v} />
        {status === "OPEN" && next.length ? (
          <details className="rounded-xl border border-slate-200 px-3 py-2 text-sm">
            <summary className="cursor-pointer font-medium text-slate-700">Forgot to punch? Add a missed time</summary>
            <ActionForm action={missedPunchAction} className="mt-2 grid gap-2 sm:grid-cols-2" resetOnSuccess>
              <input type="hidden" name="assignmentId" value={v.assignmentId} />
              <input type="hidden" name="tz" value={v.timeZone} />
              <Select name="kind" defaultValue={next[0]}>{next.map((k) => <option key={k} value={k}>{LABEL[k]}</option>)}</Select>
              <Input name="at" type="datetime-local" required max={nowLocal} defaultValue={nowLocal} />
              <Input name="note" required minLength={3} placeholder="What happened? (shown to the clinic)" className="req-mark sm:col-span-2" />
              <div><SubmitButton size="sm" variant="outline">Add time</SubmitButton></div>
            </ActionForm>
          </details>
        ) : null}
        {status === "OPEN" || status === "SUBMITTED" ? (
          <ActionForm action={providerNoteAction} className="flex gap-2">
            <input type="hidden" name="assignmentId" value={v.assignmentId} />
            <Input name="note" defaultValue={v.timesheet?.providerNote ?? ""} placeholder="Note for the clinic (optional)" />
            <SubmitButton size="sm" variant="outline">Save</SubmitButton>
          </ActionForm>
        ) : null}
        {status === "SUBMITTED" && v.allowOnsite ? (
          <details className="rounded-xl border border-slate-200 px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium text-brand-700">Have the manager sign on this phone</summary>
            <p className="mt-2 text-xs text-slate-500">Hand your phone to the manager. They check the times, type their name and sign. The clinic also gets an emailed copy.</p>
            <div className="mt-3">
              <SignOffForm approve={onsiteSignAction} hidden={{ assignmentId: v.assignmentId }} signatureRequired cta="Sign off timesheet" />
            </div>
          </details>
        ) : null}
        {status === "SUBMITTED" ? <p className="text-xs text-slate-500">The clinic has been emailed a link to sign off. If they don&apos;t respond, it&apos;s approved automatically.</p> : null}
      </CardBody>
    </Card>
  );
}
