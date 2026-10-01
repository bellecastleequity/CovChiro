import { prisma } from "@cm/db";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { InfoTip } from "@/components/ui/info-tip";
import { PageHeader } from "@/components/ui/misc";
import { dateTimeLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { availabilityAction, exceptionAction } from "../actions";

export const metadata = { title: "Availability" };
const DAYS = ["Sunday", "Monday", "Tuesday", "Wednesday", "Thursday", "Friday", "Saturday"];
const hhmm = (m: number) => `${String(Math.floor(m / 60) % 24).padStart(2, "0")}:${String(m % 60).padStart(2, "0")}`;

export default async function Availability() {
  const { actor } = await requireActor("provider");
  const p = await prisma.provider.findUniqueOrThrow({
    where: { id: actor.providerId! },
    include: { availability: true, blackouts: { where: { endsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } }, openDates: { where: { endsAt: { gt: new Date() } }, orderBy: { startsAt: "asc" } } },
  });
  const tz = p.homeTimeZone;
  return (
    <>
      <PageHeader title="Availability" description={`Times are in your home time zone (${tz.replace("America/", "").replace("_", " ")}). Include travel time — we add your drive plus a buffer before and after each shift.`} />
      <div className="grid gap-6 lg:grid-cols-5">
        <Card className="lg:col-span-3">
          <CardHeader title={<>Weekly schedule<InfoTip label="About your schedule">We only offer shifts that fit inside these hours, including your drive there and back. Shifts outside them never reach you, so keep this current.</InfoTip></>} />
          <CardBody>
            <ActionForm action={availabilityAction} className="space-y-2">
              {DAYS.map((d, i) => {
                const r = p.availability.find((x) => x.weekday === i);
                return (
                  <div key={d} className="grid grid-cols-[1fr_auto_auto] items-center gap-2 rounded-xl border border-slate-200 px-3 py-2">
                    <Checkbox name={`on-${i}`} defaultChecked={!!r} label={d} />
                    <Input type="time" name={`start-${i}`} defaultValue={r ? hhmm(r.startMin) : "07:00"} className="h-9 w-28" aria-label={`${d} start`} />
                    <Input type="time" name={`end-${i}`} defaultValue={r ? hhmm(r.endMin) : "19:00"} className="h-9 w-28" aria-label={`${d} end`} />
                  </div>
                );
              })}
              <SubmitButton className="mt-2">Save schedule</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title={<>Time off<InfoTip label="About time off">Vacation, other jobs, appointments: no offers during these dates, even inside your weekly schedule. Shifts you&apos;re already booked on aren&apos;t affected.</InfoTip></>} description="Blocks shifts during these times." />
            <CardBody>
              <ul className="mb-3 space-y-1 text-sm">
                {p.blackouts.map((b) => (
                  <li key={b.id} className="flex items-center justify-between">
                    <span>{dateTimeLabel(b.startsAt, tz)} → {dateTimeLabel(b.endsAt, tz)}</span>
                    <ActionForm action={exceptionAction} successMessage={false}><input type="hidden" name="kind" value="remove-blackout" /><input type="hidden" name="id" value={b.id} /><button className="text-xs text-slate-400 hover:text-red-600">Remove</button></ActionForm>
                  </li>
                ))}
              </ul>
              <ActionForm action={exceptionAction} className="grid grid-cols-2 gap-2" resetOnSuccess>
                <input type="hidden" name="kind" value="blackout" />
                <Field label="From"><Input type="date" name="startDate" required /></Field>
                <Field label="To"><Input type="date" name="endDate" required /></Field>
                <div className="col-span-2"><SubmitButton size="sm" variant="outline">Add time off</SubmitButton></div>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title={<>Extra open days<InfoTip label="About extra open days">Free on a day you normally aren&apos;t? Add it and you&apos;ll get offers for that day too, without changing your weekly schedule.</InfoTip></>} description="One-off availability outside your weekly schedule." />
            <CardBody>
              <ul className="mb-3 space-y-1 text-sm">
                {p.openDates.map((b) => (
                  <li key={b.id} className="flex items-center justify-between">
                    <span>{dateTimeLabel(b.startsAt, tz)} → {dateTimeLabel(b.endsAt, tz)}</span>
                    <ActionForm action={exceptionAction} successMessage={false}><input type="hidden" name="kind" value="remove-open" /><input type="hidden" name="id" value={b.id} /><button className="text-xs text-slate-400 hover:text-red-600">Remove</button></ActionForm>
                  </li>
                ))}
              </ul>
              <ActionForm action={exceptionAction} className="grid grid-cols-2 gap-2" resetOnSuccess>
                <input type="hidden" name="kind" value="open" />
                <Field label="Date"><Input type="date" name="startDate" required /></Field>
                <div />
                <Field label="From"><Input type="time" name="startTime" defaultValue="07:00" /></Field>
                <Field label="To"><Input type="time" name="endTime" defaultValue="19:00" /></Field>
                <div className="col-span-2"><SubmitButton size="sm" variant="outline">Add open day</SubmitButton></div>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
