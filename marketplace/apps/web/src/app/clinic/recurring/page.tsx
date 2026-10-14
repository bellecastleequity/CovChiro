import Link from "next/link";
import { prisma } from "@cm/db";
import { getSettings, recurring, standing } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea, RequiredMark } from "@/components/ui/form";
import { InfoTip } from "@/components/ui/info-tip";
import { Alert, Empty, PageHeader } from "@/components/ui/misc";
import { dateLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { createRecurringAction, endRecurringAction, pauseRecurringAction, updateRecurringAction } from "../actions";

export const metadata = { title: "Recurring postings" };
export const dynamic = "force-dynamic";

const TONE: Record<string, "green" | "amber" | "gray"> = { ACTIVE: "green", PAUSED: "amber", ENDED: "gray" };
const DAYS = [
  [1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"],
] as const;
const CHIP = { BOOKED: "bg-emerald-50 text-emerald-800 ring-emerald-200", OPEN: "bg-amber-50 text-amber-800 ring-amber-200", WAITING: "bg-slate-50 text-slate-600 ring-slate-200" } as const;

interface Values {
  weekdays: number[];
  startTime: string;
  endTime: string;
  lunchMinutes: number;
  lunchStartTime: string | null;
  expectedPatients: number | null;
  startsOn: string;
  endsOn: string | null;
  notes: string | null;
  preferLastProvider: boolean;
}

/** The pattern fields shared by the create and edit forms. */
function PatternFields({ v, idp, today }: { v: Values; idp: string; today: string }) {
  return (
    <>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-slate-700">Every<RequiredMark /></legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {DAYS.map(([n, label]) => <Checkbox key={n} name="weekdays" value={n} label={label} defaultChecked={v.weekdays.includes(n)} />)}
        </div>
      </fieldset>
      <div className="grid grid-cols-2 gap-3">
        <Field label="From" htmlFor={`${idp}-st`}><Input id={`${idp}-st`} name="startTime" type="time" defaultValue={v.startTime} required /></Field>
        <Field label="To" htmlFor={`${idp}-et`}><Input id={`${idp}-et`} name="endTime" type="time" defaultValue={v.endTime} required /></Field>
        <Field label="Lunch (unpaid)" htmlFor={`${idp}-lm`}>
          <Select id={`${idp}-lm`} name="lunchMinutes" defaultValue={String(v.lunchMinutes)}>
            <option value="0">No lunch</option>
            <option value="30">30 minutes</option>
            <option value="45">45 minutes</option>
            <option value="60">1 hour</option>
            <option value="90">1.5 hours</option>
          </Select>
        </Field>
        <Field label="Lunch starts" htmlFor={`${idp}-ls`}><Input id={`${idp}-ls`} name="lunchStartTime" type="time" defaultValue={v.lunchStartTime ?? "12:00"} /></Field>
        <Field label="Expected visits (optional)" htmlFor={`${idp}-ep`} hint="The covering provider's own visits. Sets the Light/Busy price."><Input id={`${idp}-ep`} name="expectedPatients" type="number" min={0} max={500} defaultValue={v.expectedPatients ?? ""} /></Field>
        <div />
        <Field label="Starting" htmlFor={`${idp}-so`}><Input id={`${idp}-so`} name="startsOn" type="date" min={today} defaultValue={v.startsOn} required /></Field>
        <Field label="Ending (optional)" htmlFor={`${idp}-eo`}><Input id={`${idp}-eo`} name="endsOn" type="date" min={today} defaultValue={v.endsOn ?? ""} /></Field>
      </div>
      <Field label="Notes for providers (optional)" htmlFor={`${idp}-n`}><Textarea id={`${idp}-n`} name="notes" maxLength={2000} defaultValue={v.notes ?? ""} placeholder="e.g. Personal injury patients, afternoon block" /></Field>
      <Checkbox name="preferLastProvider" value="1" defaultChecked={v.preferLastProvider} label="Invite whoever covered it last before anyone else" />
    </>
  );
}

export default async function ClinicRecurring() {
  const { actor } = await requireActor("clinic");
  const [rows, locations, s] = await Promise.all([
    recurring.clinicRecurring(actor),
    prisma.clinicLocation.findMany({ where: { clinicOrgId: actor.clinicOrgId!, active: true }, orderBy: { createdAt: "asc" } }),
    getSettings(),
  ]);
  const professions = await prisma.profession.findMany({ where: { code: { in: [...new Set(locations.flatMap((l) => l.professionCodes))] }, active: true }, orderBy: { sortOrder: "asc" } });
  const today = new Date().toISOString().slice(0, 10);
  const leadDays = Math.ceil(s["recurring.minLeadHours"] / 24);
  return (
    <>
      <PageHeader
        title="Recurring postings"
        description={`Need cover on the same days every week, from whichever provider is available? Set the days once and we post each one ${s["recurring.horizonWeeks"]} weeks ahead as a normal open shift, at the usual rates. Any eligible provider can take a day; you choose from applicants as usual. Want one named provider on a regular schedule instead? Use Standing bookings.`}
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          {rows.length ? rows.map((r) => (
            <Card key={r.id}>
              <CardHeader
                title={<span className="flex flex-wrap items-center gap-2">{standing.describePattern(r)} <Badge tone={TONE[r.status] ?? "gray"}>{r.status.toLowerCase()}</Badge></span>}
                description={`${r.location.name} · ${r.professionCode} · from ${dateLabel(r.startsOn, "UTC", { month: "short", day: "numeric", year: "numeric" })}${r.endsOn ? ` to ${dateLabel(r.endsOn, "UTC", { month: "short", day: "numeric", year: "numeric" })}` : ""}${r.lunchMinutes ? ` · ${r.lunchMinutes} min lunch` : ""}${r.expectedPatients != null ? ` · ${r.expectedPatients} expected visits` : ""}`}
              />
              <CardBody className="space-y-3 text-sm">
                {r.lastError && r.status === "ACTIVE" ? <Alert tone="warning" title="We couldn't post the next days">{r.lastError} We try again every hour.</Alert> : null}
                {r.upcoming.length ? (
                  <>
                    <div className="flex flex-wrap gap-2">
                      {r.upcoming.slice(0, 15).map((u) => (
                        <Link key={u.id} href={`/clinic/shifts/${u.id}`} className={`rounded-lg px-2 py-1 text-xs ring-1 ${CHIP[u.state]}`} title={u.providerName ?? (u.state === "WAITING" ? "Waiting for an available provider" : "Open")}>
                          {dateLabel(u.startsAt, r.location.timeZone, { weekday: "short", month: "short", day: "numeric" })}{u.providerName ? ` · ${u.providerName}` : ""}
                        </Link>
                      ))}
                    </div>
                    <p className="text-xs text-slate-500">Green = booked · amber = posted, waiting for applicants · grey = no provider available yet (posts itself once one is).</p>
                  </>
                ) : r.status === "ACTIVE" ? <p className="text-slate-500">Days are posted as they come within {s["recurring.horizonWeeks"]} weeks.</p> : null}
                {r.preferLastProvider && r.lastProviderName ? <p className="text-slate-600">New days are offered to <span className="font-medium">{r.lastProviderName}</span> first (they covered it last).</p> : null}
                {r.status !== "ENDED" ? (
                  <>
                    <details className="rounded-xl ring-1 ring-slate-200 [&[open]>summary]:border-b [&[open]>summary]:border-slate-200">
                      <summary className="cursor-pointer select-none px-3 py-2 font-medium text-brand-700">Change days, hours or details</summary>
                      <ActionForm action={updateRecurringAction} className="space-y-3 p-3">
                        <input type="hidden" name="recurringId" value={r.id} />
                        <p className="text-xs text-slate-500">Open days that no longer fit are taken down; booked days always stay. Days already posted keep their details (change one on its own shift page); new days use the new details.</p>
                        <PatternFields idp={r.id} today={today} v={{ ...r, startsOn: r.startsOn.toISOString().slice(0, 10), endsOn: r.endsOn ? r.endsOn.toISOString().slice(0, 10) : null }} />
                        <SubmitButton size="sm">Save changes</SubmitButton>
                      </ActionForm>
                    </details>
                    <div className="flex flex-wrap items-center gap-2">
                      <ActionForm action={pauseRecurringAction}>
                        <input type="hidden" name="recurringId" value={r.id} />
                        <input type="hidden" name="to" value={r.status === "PAUSED" ? "resume" : "pause"} />
                        <SubmitButton size="sm" variant="outline">{r.status === "PAUSED" ? "Resume" : "Pause"}</SubmitButton>
                      </ActionForm>
                      <ActionForm action={endRecurringAction} className="flex flex-wrap items-center gap-3" confirm="End this recurring posting? No new days will be posted.">
                        <input type="hidden" name="recurringId" value={r.id} />
                        <Checkbox name="takeDown" value="1" defaultChecked label="Also take down open days nobody has taken" />
                        <SubmitButton size="sm" variant="outline">End</SubmitButton>
                      </ActionForm>
                    </div>
                  </>
                ) : null}
              </CardBody>
            </Card>
          )) : <Empty title="No recurring postings yet">Set one up and we&apos;ll keep the days posted for you, week after week.</Empty>}
        </div>
        <div className="lg:col-span-2">
          <Card>
            <CardHeader
              title={<>New recurring posting<InfoTip label="About recurring postings">Each day is its own shift: normal price, deposit when someone is booked, normal cancellation rules. Days less than {leadDays} days away aren&apos;t posted automatically; post those from Post shift. If no provider is available for a day yet, it waits and posts itself as soon as one is.</InfoTip></>}
              description="For example, Tue and Thu afternoons, 1–5 PM."
            />
            <CardBody>
              {locations.length ? (
                <ActionForm action={createRecurringAction} className="space-y-4" resetOnSuccess>
                  <Field label="Location" htmlFor="locationId">
                    <Select id="locationId" name="locationId" required>
                      {locations.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.city}</option>)}
                    </Select>
                  </Field>
                  <Field label="Coverage" htmlFor="professionCode">
                    <Select id="professionCode" name="professionCode" required>
                      {professions.map((p) => <option key={p.code} value={p.code}>{p.displayName}</option>)}
                    </Select>
                  </Field>
                  <PatternFields idp="new" today={today} v={{ weekdays: [], startTime: "13:00", endTime: "17:00", lunchMinutes: 0, lunchStartTime: null, expectedPatients: null, startsOn: today, endsOn: null, notes: null, preferLastProvider: true }} />
                  <SubmitButton className="w-full">Start posting</SubmitButton>
                </ActionForm>
              ) : <p className="text-sm text-slate-500"><Link href="/clinic/locations" className="font-medium text-brand-700 hover:underline">Add a location</Link> first.</p>}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
