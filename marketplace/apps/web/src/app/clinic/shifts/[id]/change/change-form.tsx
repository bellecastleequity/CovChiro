"use client";

import { useCallback, useState } from "react";
import Link from "next/link";
import { ArrowRight } from "lucide-react";
import { ActionForm, SubmitButton, type ActionState } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, PhiNotice, Select, Textarea } from "@/components/ui/form";
import { previewShiftChangeAction, changeShiftAction } from "../../../actions";

interface Side {
  startsAt: string;
  endsAt: string;
  expectedPatients: number | null;
  minYearsExperience: number;
  notes: string | null;
  priceCents: number;
}
interface Preview {
  before: Side;
  after: Side;
  providerName: string | null;
  respondBy: string | null;
  timeZone: string;
}

const dollars = (c: number) => `$${(c / 100).toLocaleString("en-US", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;

function When({ s, tz }: { s: Side; tz: string }) {
  const d = (iso: string, o: Intl.DateTimeFormatOptions) => new Date(iso).toLocaleString("en-US", { timeZone: tz, ...o });
  return (
    <>
      {d(s.startsAt, { weekday: "short", month: "short", day: "numeric" })}, {d(s.startsAt, { hour: "numeric", minute: "2-digit" })}–{d(s.endsAt, { hour: "numeric", minute: "2-digit" })}
    </>
  );
}

export function ChangeShiftForm({
  shiftId,
  initial,
  volume,
  provider,
  minLeadHours,
}: {
  shiftId: string;
  initial: { date: string; start: string; end: string; lunch: string; lunchStart: string; expectedPatients: number | null; minYearsExperience: number; notes: string };
  volume: boolean;
  provider: string | null;
  minLeadHours: number;
}) {
  const [preview, setPreview] = useState<Preview | null>(null);
  const [lunch, setLunch] = useState(initial.lunch);
  const [fields, setFields] = useState<Record<string, string>>({});
  const onDone = useCallback((s: ActionState) => {
    if (s?.data) setPreview(s.data as Preview);
  }, []);
  // Any edit after reviewing means reviewing again.
  const reset = () => setPreview(null);

  return (
    <div className="grid gap-6 lg:grid-cols-3">
      <div className="lg:col-span-2">
        <Card>
          <CardHeader title="New details" description="Location, profession and skills can't be changed here; cancel and post again for those." />
          <CardBody>
            <ActionForm
              action={previewShiftChangeAction}
              successMessage={false}
              onDone={onDone}
              className="space-y-4"
            >
              <div onChange={(e) => { const t = e.target as HTMLInputElement; setFields((f) => ({ ...f, [t.name]: t.value })); reset(); }} className="space-y-4">
                <input type="hidden" name="shiftId" value={shiftId} />
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Date" htmlFor="date"><Input id="date" name="date" type="date" defaultValue={initial.date} required /></Field>
                  <Field label="Start" htmlFor="start"><Input id="start" name="start" type="time" defaultValue={initial.start} required /></Field>
                  <Field label="End" htmlFor="end"><Input id="end" name="end" type="time" defaultValue={initial.end} required /></Field>
                </div>
                <div className="grid gap-4 sm:grid-cols-3">
                  <Field label="Lunch break (unpaid)" htmlFor="lunch">
                    <Select id="lunch" name="lunch" value={lunch} onChange={(e) => setLunch(e.target.value)}>
                      {[0, 30, 45, 60, 90, 120, 150, 180, 210, 240].map((m) => <option key={m} value={String(m)}>{m === 0 ? "No lunch" : m < 60 ? `${m} min` : `${m / 60} hour${m === 60 ? "" : "s"}`}</option>)}
                    </Select>
                  </Field>
                  {lunch !== "0" ? <Field label="Lunch starts" htmlFor="lunchStart"><Input id="lunchStart" name="lunchStart" type="time" step={900} defaultValue={initial.lunchStart} required /></Field> : null}
                </div>
                <div className="grid gap-4 sm:grid-cols-2">
                  {volume ? (
                    <Field label="Expected patient visits" htmlFor="expectedPatients" hint="Sets the Light or Busy price.">
                      <Input id="expectedPatients" name="expectedPatients" type="number" min={0} max={500} defaultValue={initial.expectedPatients ?? ""} />
                    </Field>
                  ) : null}
                  <Field label="Minimum years' experience" htmlFor="minYearsExperience">
                    <Input id="minYearsExperience" name="minYearsExperience" type="number" min={0} max={40} defaultValue={initial.minYearsExperience} />
                  </Field>
                </div>
                <Field label="Notes for the provider" htmlFor="notes">
                  <Textarea id="notes" name="notes" defaultValue={initial.notes} rows={3} />
                </Field>
                <PhiNotice />
                {provider ? (
                  <Field label={`Note to ${provider} about the change (optional)`} htmlFor="message">
                    <Input id="message" name="message" maxLength={500} placeholder="e.g. We're closing early that day" />
                  </Field>
                ) : null}
                {provider ? <p className="text-xs text-slate-500">Confirmed shifts can be changed up to {minLeadHours} hours before they start.</p> : null}
              </div>
              <SubmitButton variant="outline" pendingText="Checking…">Review change</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      </div>

      <div>
        <Card className={preview ? "border-brand-300 ring-2 ring-brand-100" : undefined}>
          <CardHeader title="Before you send" />
          <CardBody className="space-y-4 text-sm">
            {!preview ? (
              <p className="text-slate-500">Change the details, then tap Review change to see the new time and price.</p>
            ) : (
              <>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Time</div>
                  {preview.before.startsAt === preview.after.startsAt && preview.before.endsAt === preview.after.endsAt ? (
                    <div className="font-medium"><When s={preview.after} tz={preview.timeZone} /> <span className="text-xs font-normal text-slate-500">(unchanged)</span></div>
                  ) : (
                    <>
                      <div className="text-slate-500 line-through"><When s={preview.before} tz={preview.timeZone} /></div>
                      <div className="font-medium"><When s={preview.after} tz={preview.timeZone} /></div>
                    </>
                  )}
                </div>
                <div>
                  <div className="text-xs font-medium uppercase tracking-wide text-slate-500">Your price</div>
                  {preview.before.priceCents === preview.after.priceCents ? (
                    <div><span className="text-lg font-semibold">{dollars(preview.after.priceCents)}</span> <span className="text-xs text-slate-500">(unchanged)</span></div>
                  ) : (
                    <div className="flex items-center gap-2">
                      <span className="text-slate-500 line-through">{dollars(preview.before.priceCents)}</span>
                      <ArrowRight className="size-4 text-slate-400" />
                      <span className="text-lg font-semibold">{dollars(preview.after.priceCents)}</span>
                    </div>
                  )}
                </div>
                {preview.before.expectedPatients !== preview.after.expectedPatients ? (
                  <div>Expected visits: {preview.before.expectedPatients ?? "not set"} → {preview.after.expectedPatients ?? "not set"}</div>
                ) : null}
                {preview.before.minYearsExperience !== preview.after.minYearsExperience ? (
                  <div>Experience: {preview.before.minYearsExperience}+ → {preview.after.minYearsExperience}+ years</div>
                ) : null}
                {(preview.before.notes ?? "") !== (preview.after.notes ?? "") ? <div>Notes updated.</div> : null}
                <p className="rounded-lg bg-slate-50 p-3 text-slate-600">
                  {preview.providerName
                    ? `${preview.providerName} will be asked to accept by ${new Date(preview.respondBy!).toLocaleString("en-US", { timeZone: preview.timeZone, weekday: "short", hour: "numeric", minute: "2-digit" })}. Until then the shift stays as booked. If they decline or don't answer, we refund your deposit and find someone new for the new time.`
                    : "This applies right away. Anyone who applied is told."}
                </p>
                <ActionForm action={changeShiftAction} successMessage={false}>
                  <input type="hidden" name="shiftId" value={shiftId} />
                  {Object.entries({ ...initialFields(initial), ...fields }).map(([k, v]) => (
                    k === "expectedPatients" && !volume ? null : <input key={k} type="hidden" name={k} value={v} />
                  ))}
                  <SubmitButton className="w-full" pendingText="Sending…">
                    {preview.providerName ? `Send to ${preview.providerName}` : `Save change · ${dollars(preview.after.priceCents)}`}
                  </SubmitButton>
                </ActionForm>
              </>
            )}
            <Link href={`/clinic/shifts/${shiftId}`} className="block text-center text-slate-500 hover:text-slate-800">Keep it as it is</Link>
          </CardBody>
        </Card>
      </div>
    </div>
  );
}

function initialFields(i: { date: string; start: string; end: string; lunch: string; lunchStart: string; expectedPatients: number | null; minYearsExperience: number; notes: string }) {
  return { date: i.date, start: i.start, end: i.end, lunch: i.lunch, lunchStart: i.lunchStart, expectedPatients: i.expectedPatients == null ? "" : String(i.expectedPatients), minYearsExperience: String(i.minYearsExperience), notes: i.notes, message: "" };
}
