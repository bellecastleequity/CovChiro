"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { Check, ChevronLeft, PlayCircle } from "lucide-react";
import { Alert } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { resumeAction } from "./actions";

const STEPS = ["Your hours", "Return date", "Confirm"];

/** Resume coverage: 1) re-check weekly hours / open dates, 2) the date they're back, 3) confirm. */
export function ResumeWizard({ today, hours, openDates, since }: { today: string; hours: string[]; openDates: string[]; since: string }) {
  const [step, setStep] = useState(0);
  const [confirmed, setConfirmed] = useState(false);
  const [date, setDate] = useState(today);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<string | null>(null);
  const [pending, start] = useTransition();
  const none = !hours.length && !openDates.length;
  const label = new Date(`${date}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" });

  const submit = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("resumeDate", date);
      fd.set("hoursConfirmed", confirmed ? "true" : "");
      const r = await resumeAction(null, fd);
      if (r?.error) return setError(r.error);
      setError(null);
      setDone(r?.ok ?? "Done");
    });

  if (done) {
    return (
      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-center gap-2 text-lg font-semibold"><Check className="size-5 text-emerald-600" />{done}</div>
          <p className="text-sm text-slate-600">{date === today ? "Matching shifts will show up on Find shifts, and we'll send offers that fit your hours." : `From ${label} you'll be offered shifts that fit your hours again.`}</p>
          <Link href="/provider/shifts" className="text-sm font-medium text-brand-700">Find shifts</Link>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><PlayCircle className="size-5 text-emerald-600" />Resume coverage</span>} description={`You've been on a break since ${since}.`} />
      <CardBody className="space-y-5">
        <ol className="flex gap-2 text-xs font-medium">
          {STEPS.map((s, k) => (
            <li key={s} className={cn("rounded-full px-3 py-1", k === step ? "bg-brand-600 text-white" : k < step ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>{k + 1}. {s}</li>
          ))}
        </ol>
        {error ? <Alert tone="error">{error}</Alert> : null}

        {step === 0 ? (
          <div className="space-y-4 text-sm">
            <p className="text-slate-700">We only offer you shifts inside these hours. Please check they&apos;re still right.</p>
            <div className="rounded-xl border border-slate-200 p-4">
              {none ? <p className="text-amber-700">You haven&apos;t set any hours yet. Add them before you resume.</p> : null}
              {hours.length ? <ul className="space-y-1">{hours.map((h) => <li key={h}>{h}</li>)}</ul> : null}
              {openDates.length ? <div className="mt-2"><div className="text-xs font-semibold uppercase text-slate-500">Extra open dates</div><ul>{openDates.map((d) => <li key={d}>{d}</li>)}</ul></div> : null}
              <Link href="/provider/availability" className="mt-3 inline-block font-medium text-brand-700">Edit my hours →</Link>
            </div>
            <Checkbox checked={confirmed} onChange={(e) => setConfirmed(e.target.checked)} label="These hours are up to date" />
            <Button onClick={() => setStep(1)} disabled={!confirmed || none}>Next</Button>
          </div>
        ) : null}

        {step === 1 ? (
          <div className="space-y-4">
            <Field label="When can you take shifts again?" hint="Today means right away.">
              <Input type="date" value={date} min={today} onChange={(e) => setDate(e.target.value)} className="max-w-48" />
            </Field>
            <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(0)}><ChevronLeft className="size-4" />Back</Button><Button onClick={() => setStep(2)} disabled={!date}>Next</Button></div>
          </div>
        ) : null}

        {step === 2 ? (
          <div className="space-y-4 text-sm">
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="font-semibold">{date === today ? "Back from today" : `Back from ${label}`}</div>
              <div className="text-slate-600">Shifts are matched to the hours you confirmed.</div>
            </div>
            <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(1)}><ChevronLeft className="size-4" />Back</Button><Button onClick={submit} disabled={pending}>{pending ? "Saving…" : "Resume coverage"}</Button></div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
