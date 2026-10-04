"use client";

import { useState, useTransition } from "react";
import Link from "next/link";
import { AlertTriangle, Check, ChevronLeft, PauseCircle } from "lucide-react";
import { Alert } from "@/components/ui/misc";
import { Button } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { money } from "@/lib/format";
import { previewBreakAction, startBreakAction } from "./actions";

interface Booking { id: string; clinic: string; city: string; startsAt: string; endsAt: string; timeZone: string; payCents: number; late: boolean }
interface Preview { from: string; lateHours: number; during: Booking[]; before: Booking[] }

const when = (b: Booking) => {
  const d = (o: Intl.DateTimeFormatOptions) => new Date(b.startsAt).toLocaleString("en-US", { timeZone: b.timeZone, ...o });
  const end = new Date(b.endsAt).toLocaleString("en-US", { timeZone: b.timeZone, hour: "numeric", minute: "2-digit" });
  return `${d({ weekday: "short", month: "short", day: "numeric" })}, ${d({ hour: "numeric", minute: "2-digit" })}–${end}`;
};
const STEPS = ["Start date", "Your bookings", "Confirm"];

/** Taking a break: 1) start date, 2) each booking during the break, keep or release, 3) confirm. */
export function BreakWizard({ today }: { today: string }) {
  const [step, setStep] = useState(0);
  const [startDate, setStartDate] = useState(today);
  const [preview, setPreview] = useState<Preview | null>(null);
  const [i, setI] = useState(0);
  const [choice, setChoice] = useState<Record<string, "keep" | "release">>({});
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ released: number; kept: number } | null>(null);
  const [pending, start] = useTransition();

  const loadBookings = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("startDate", startDate);
      const r = await previewBreakAction(null, fd);
      if (r?.error) return setError(r.error);
      setError(null);
      setPreview(r?.data as Preview);
      setI(0);
      setChoice({});
      setStep(1);
    });

  const decide = (id: string, c: "keep" | "release") => {
    setChoice((x) => ({ ...x, [id]: c }));
    if (preview && i + 1 < preview.during.length) setI(i + 1);
    else setStep(2);
  };

  const confirm = () =>
    start(async () => {
      const fd = new FormData();
      fd.set("startDate", startDate);
      for (const [id, c] of Object.entries(choice)) fd.append(c, id);
      const r = await startBreakAction(null, fd);
      if (r?.error) return setError(r.error);
      setError(null);
      setDone(r?.data as { released: number; kept: number });
    });

  const fromLabel = preview ? new Date(`${startDate}T12:00:00`).toLocaleDateString("en-US", { weekday: "long", month: "long", day: "numeric" }) : "";

  if (done) {
    return (
      <Card>
        <CardBody className="space-y-3">
          <div className="flex items-center gap-2 text-lg font-semibold"><Check className="size-5 text-emerald-600" />Your break is set from {fromLabel}</div>
          <p className="text-sm text-slate-600">
            You won&apos;t get new shift offers or invitations from that date. {done.kept ? `You're keeping ${done.kept} booking${done.kept === 1 ? "" : "s"}; we'll see you there.` : ""} {done.released ? `${done.released} booking${done.released === 1 ? " was" : "s were"} released and we're finding cover.` : ""}
          </p>
          <p className="text-sm text-slate-600">When you&apos;re ready, tap <b>Resume coverage</b> on your profile or dashboard.</p>
          <Link href="/provider" className="text-sm font-medium text-brand-700">Back to my dashboard</Link>
        </CardBody>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader title={<span className="flex items-center gap-2"><PauseCircle className="size-5 text-amber-600" />Taking a break</span>} description="New bookings stop from your start date. You decide what happens to each booking you already have." />
      <CardBody className="space-y-5">
        <ol className="flex gap-2 text-xs font-medium">
          {STEPS.map((s, k) => (
            <li key={s} className={cn("rounded-full px-3 py-1", k === step ? "bg-brand-600 text-white" : k < step ? "bg-emerald-50 text-emerald-700" : "bg-slate-100 text-slate-500")}>{k + 1}. {s}</li>
          ))}
        </ol>
        {error ? <Alert tone="error">{error}</Alert> : null}

        {step === 0 ? (
          <div className="space-y-4">
            <Field label="When does your break start?" hint="From this date you won't be offered or invited to new shifts.">
              <Input type="date" value={startDate} min={today} onChange={(e) => setStartDate(e.target.value)} className="max-w-48" />
            </Field>
            <Button onClick={loadBookings} disabled={pending || !startDate}>{pending ? "Checking…" : "Next"}</Button>
          </div>
        ) : null}

        {step === 1 && preview ? (
          <div className="space-y-4">
            {preview.before.length ? (
              <p className="text-sm text-slate-600">Before your break: {preview.before.length} booking{preview.before.length === 1 ? "" : "s"} you&apos;ll complete as planned ({preview.before.map(when).join("; ")}).</p>
            ) : null}
            {preview.during.length === 0 ? (
              <>
                <p className="text-sm text-slate-700">You have no bookings from {fromLabel}. Nothing to decide.</p>
                <div className="flex gap-2"><Button variant="outline" onClick={() => setStep(0)}><ChevronLeft className="size-4" />Back</Button><Button onClick={() => setStep(2)}>Next</Button></div>
              </>
            ) : (
              (() => {
                const b = preview.during[i];
                return (
                  <div className="space-y-3">
                    <div className="text-sm font-medium text-slate-500">Booking {i + 1} of {preview.during.length}</div>
                    <div className="rounded-xl border border-slate-200 p-4">
                      <div className="font-semibold text-slate-900">{when(b)}</div>
                      <div className="text-sm text-slate-600">{b.clinic} · {b.city} · {money(b.payCents)}</div>
                      {b.late ? (
                        <div className="mt-3 flex gap-2 rounded-lg bg-amber-50 p-3 text-sm text-amber-800"><AlertTriangle className="mt-0.5 size-4 shrink-0" />It starts within {preview.lateHours} hours, so releasing it counts as a late cancellation and affects your reliability score.</div>
                      ) : null}
                    </div>
                    <div className="flex flex-wrap gap-2">
                      <Button onClick={() => decide(b.id, "keep")}>Keep this booking</Button>
                      <Button variant="outline" onClick={() => decide(b.id, "release")}>Release it</Button>
                      <Button variant="ghost" onClick={() => (i > 0 ? setI(i - 1) : setStep(0))}><ChevronLeft className="size-4" />Back</Button>
                    </div>
                  </div>
                );
              })()
            )}
          </div>
        ) : null}

        {step === 2 && preview ? (
          <div className="space-y-4 text-sm">
            <div className="rounded-xl border border-slate-200 p-4">
              <div className="font-semibold">Break starts {fromLabel}</div>
              <ul className="mt-2 space-y-1 text-slate-700">
                {preview.during.map((b) => (
                  <li key={b.id} className="flex justify-between gap-3"><span>{when(b)} · {b.clinic}</span><span className={cn("font-medium", choice[b.id] === "release" ? "text-red-700" : "text-emerald-700")}>{choice[b.id] === "release" ? `Release${b.late ? " (late)" : ""}` : "Keep"}</span></li>
                ))}
                {!preview.during.length ? <li>No bookings during your break.</li> : null}
              </ul>
            </div>
            <ul className="list-disc space-y-1 pl-5 text-slate-600">
              <li>You won&apos;t be offered, invited to or matched with shifts from that date. Open applications and offers for those dates are withdrawn.</li>
              <li>Released bookings go back to the clinic and we find cover. Kept bookings stay as they are.</li>
              <li>Come back any time with <b>Resume coverage</b>.</li>
            </ul>
            <div className="flex gap-2">
              <Button variant="outline" onClick={() => (preview.during.length ? (setI(preview.during.length - 1), setStep(1)) : setStep(1))}><ChevronLeft className="size-4" />Back</Button>
              <Button onClick={confirm} disabled={pending}>{pending ? "Saving…" : "Start my break"}</Button>
            </div>
          </div>
        ) : null}
      </CardBody>
    </Card>
  );
}
