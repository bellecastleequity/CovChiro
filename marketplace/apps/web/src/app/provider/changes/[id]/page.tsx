import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowRight } from "lucide-react";
import { shiftChanges } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, PageHeader } from "@/components/ui/misc";
import { dateLabel, money, timeRange } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { respondShiftChangeAction } from "../../actions";

export const metadata = { title: "Shift change" };

export default async function ShiftChangePage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor("provider");
  const { id } = await params;
  const c = await shiftChanges.changeForProvider(actor, id).catch(() => null);
  if (!c) notFound();
  const tz = c.shift.location.timeZone;
  const b = c.before.shift;
  const a = c.after.shift;
  const timeMoved = b.startsAt !== a.startsAt || b.endsAt !== a.endsAt;
  return (
    <>
      <PageHeader eyebrow={c.shift.location.name} title="The clinic asked to change your shift" description="Accept to keep the shift with the new details. If you decline, you're released with no penalty; it doesn't count as a cancellation." />
      {c.status !== "PENDING" ? (
        <Alert tone="info" className="mb-5">
          {c.status === "ACCEPTED" ? "You accepted this change." : c.status === "DECLINED" ? "You declined this change and were released from the shift." : c.status === "EXPIRED" ? "This change wasn't answered in time, so you were released from the shift with no penalty." : "The clinic withdrew this change. Your shift stays as booked."}
        </Alert>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="What's changing" />
          <CardBody className="space-y-4 text-sm">
            <Row label="Date and time" changed={timeMoved} before={`${dateLabel(b.startsAt, tz)} · ${timeRange(b.startsAt, b.endsAt, tz)}`} after={`${dateLabel(a.startsAt, tz)} · ${timeRange(a.startsAt, a.endsAt, tz)}`} />
            <Row label="Your pay" changed={c.before.totals?.providerTotalCents !== c.after.totals?.providerTotalCents} before={money(c.before.totals?.providerTotalCents ?? 0, { exact: true })} after={money(c.after.totals?.providerTotalCents ?? 0, { exact: true })} />
            {b.expectedPatients !== a.expectedPatients ? <Row label="Expected patient visits" changed before={String(b.expectedPatients ?? "Not set")} after={String(a.expectedPatients ?? "Not set")} /> : null}
            {b.minYearsExperience !== a.minYearsExperience ? <Row label="Experience asked for" changed before={`${b.minYearsExperience}+ years`} after={`${a.minYearsExperience}+ years`} /> : null}
            {(b.notes ?? "") !== (a.notes ?? "") ? (
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">New notes</div>
                <p className="mt-1 whitespace-pre-line rounded-lg bg-slate-50 p-3">{a.notes || "No notes"}</p>
              </div>
            ) : null}
            {c.message ? (
              <div>
                <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Note from the clinic</div>
                <p className="mt-1 rounded-lg bg-brand-50 p-3">“{c.message}”</p>
              </div>
            ) : null}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Your answer" />
          <CardBody className="space-y-3 text-sm">
            {c.status === "PENDING" ? (
              <>
                <p className="text-slate-600">Please answer by {dateLabel(c.respondBy, tz, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. No answer counts as a decline.</p>
                <ActionForm action={respondShiftChangeAction}>
                  <input type="hidden" name="changeId" value={c.id} />
                  <input type="hidden" name="answer" value="accept" />
                  <SubmitButton className="w-full" pendingText="Accepting…">Accept the change</SubmitButton>
                </ActionForm>
                <ActionForm action={respondShiftChangeAction} confirm="Decline and give up this shift? You won't be penalized.">
                  <input type="hidden" name="changeId" value={c.id} />
                  <input type="hidden" name="answer" value="decline" />
                  <SubmitButton variant="outline" className="w-full" pendingText="Declining…">Decline and release the shift</SubmitButton>
                </ActionForm>
              </>
            ) : null}
            <Link href="/provider/assignments" className="block text-center text-slate-500 hover:text-slate-800">My shifts</Link>
          </CardBody>
        </Card>
      </div>
    </>
  );
}

function Row({ label, before, after, changed }: { label: string; before: string; after: string; changed: boolean }) {
  return (
    <div>
      <div className="text-xs font-medium uppercase tracking-wide text-slate-500">{label}</div>
      {changed ? (
        <div className="mt-1 flex flex-wrap items-center gap-2">
          <span className="text-slate-500 line-through">{before}</span>
          <ArrowRight className="size-4 text-slate-400" />
          <span className="font-semibold">{after}</span>
        </div>
      ) : (
        <div className="mt-1">{after} <span className="text-xs text-slate-400">(unchanged)</span></div>
      )}
    </div>
  );
}
