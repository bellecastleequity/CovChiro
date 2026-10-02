import { Users } from "lucide-react";
import type { volume } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Field, Input, Textarea } from "@/components/ui/form";
import { money } from "@/lib/format";

type View = NonNullable<Awaited<ReturnType<typeof volume.visitView>>>;
type Action = Parameters<typeof ActionForm>[0]["action"];

const when = (d: Date | null, tz: string) => (d ? d.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" }) : "");

function Summary({ v, tz, side }: { v: View; tz: string; side: "CLINIC" | "PROVIDER" }) {
  const settled = v.status === "FINAL" || v.status === "DISPUTED";
  return (
    <div className="space-y-1 text-sm text-slate-700">
      <p>
        <b>{v.tierLabel} day</b>{v.expected ? `, about ${v.expected} expected` : ""}. Covers up to <b>{v.allowedVisits}</b> visits ({v.ceiling} + {v.grace} grace); each visit past that {side === "PROVIDER" ? "pays you" : "adds"} {money(v.perVisitCents)}.
      </p>
      {v.providerVisits != null ? <p>Provider&apos;s count: <b>{v.providerVisits}</b>{v.clinicVisits != null && v.clinicVisits !== v.providerVisits ? <> · Clinic&apos;s count: <b>{v.clinicVisits}</b></> : v.clinicVisits != null ? " · confirmed by the clinic" : ""}</p> : null}
      {settled ? (
        <p>
          Final: <b>{v.finalVisits}</b> visits{v.overageVisits ? <> · {v.overageVisits} extra = <b>{money(v.overageCents)}</b>{side === "CLINIC" ? (v.chargedAt ? " charged" : " to be charged") : " added to your pay"}</> : " · nothing extra"}
          {v.status === "DISPUTED" ? <span className="text-amber-700"> · the counts differ, so the lower one is used while our team reviews it</span> : null}
        </p>
      ) : v.providerVisits != null && v.chargeDueAt ? (
        <p className="text-slate-500">{side === "CLINIC" ? "Extra visits, if any, are charged" : "Settles"} {when(v.chargeDueAt, tz)} unless the clinic reports a different count.</p>
      ) : null}
    </div>
  );
}

/** Provider: enter the day's visit count (numbers only). */
export function ProviderVisitCard({ v, assignmentId, tz, action }: { v: View; assignmentId: string; tz: string; action: Action }) {
  return (
    <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-card">
      <div className="mb-3 flex items-center justify-between gap-2">
        <h2 className="flex items-center gap-2 font-semibold"><Users className="size-4 text-accent-600" />Visits today</h2>
        {v.status ? <Badge tone={v.status === "FINAL" ? "green" : v.status === "DISPUTED" ? "amber" : "gray"}>{v.status === "FINAL" ? "Settled" : v.status === "DISPUTED" ? "Under review" : "Waiting on clinic"}</Badge> : null}
      </div>
      <Summary v={v} tz={tz} side="PROVIDER" />
      {v.canSubmit ? (
        <ActionForm action={action} className="mt-4 flex flex-wrap items-end gap-3">
          <input type="hidden" name="assignmentId" value={assignmentId} />
          <Field label="Patients you saw" hint="Only your own patients, not the whole clinic. A number only: never names or patient details.">
            <Input name="visits" type="number" min={0} max={300} inputMode="numeric" defaultValue={v.providerVisits ?? ""} required className="max-w-32" />
          </Field>
          <SubmitButton>{v.providerVisits != null ? "Update count" : "Save count"}</SubmitButton>
        </ActionForm>
      ) : v.providerVisits == null && !v.status ? <p className="mt-3 text-sm text-slate-500">You can enter the count once the shift starts, up to {when(v.lateUntil, tz)}.</p> : null}
    </div>
  );
}

/** Clinic: confirm the provider's count or report a different one, inside the dispute window. */
export function ClinicVisitPanel({ v, tz, hidden, confirm, report }: { v: View; tz: string; hidden: Record<string, string>; confirm: Action; report: Action }) {
  const fields = Object.entries(hidden).map(([k, val]) => <input key={k} type="hidden" name={k} value={val} />);
  return (
    <div className="space-y-4">
      <Summary v={v} tz={tz} side="CLINIC" />
      {v.providerVisits == null && !v.status ? <p className="text-sm text-slate-500">The provider enters how many patients they saw after the shift. You&apos;ll get a message to check it.</p> : null}
      {v.canRespond ? (
        <div className="space-y-3">
          <ActionForm action={confirm}>{fields}<SubmitButton>Confirm {v.providerVisits} visits</SubmitButton></ActionForm>
          <details className="rounded-xl border border-slate-200 px-3 py-2">
            <summary className="cursor-pointer text-sm font-medium text-slate-700">Report a different count</summary>
            <ActionForm action={report} className="mt-3 space-y-3">
              {fields}
              <Field label="Patients this provider saw" hint="Only the covering provider's patients."><Input name="visits" type="number" min={0} max={300} inputMode="numeric" required className="max-w-32" /></Field>
              <Field label="Why is it different?" hint="Numbers and reasons only: no patient names or details."><Textarea name="reason" required maxLength={300} placeholder="e.g. two patients cancelled; our sign-in sheet shows 20" /></Field>
              <SubmitButton variant="outline">Send my count</SubmitButton>
            </ActionForm>
          </details>
        </div>
      ) : null}
    </div>
  );
}
