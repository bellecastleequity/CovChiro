import Link from "next/link";
import { prisma } from "@cm/db";
import { getSettings, standing } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea, RequiredMark } from "@/components/ui/form";
import { InfoTip } from "@/components/ui/info-tip";
import { Empty, PageHeader } from "@/components/ui/misc";
import { dateLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { endStandingAction, proposeStandingAction } from "../actions";

export const metadata = { title: "Standing bookings" };
export const dynamic = "force-dynamic";

const TONE: Record<string, "green" | "amber" | "gray" | "red"> = { ACTIVE: "green", PROPOSED: "amber", DECLINED: "red", ENDED: "gray", WITHDRAWN: "gray" };
const DAYS = [
  [1, "Mon"], [2, "Tue"], [3, "Wed"], [4, "Thu"], [5, "Fri"], [6, "Sat"], [7, "Sun"],
] as const;

export default async function ClinicStanding({ searchParams }: { searchParams: Promise<{ provider?: string }> }) {
  const { actor } = await requireActor("clinic");
  const sp = await searchParams;
  const [rows, candidates, locations, s] = await Promise.all([
    standing.clinicStanding(actor),
    standing.standingCandidates(actor),
    prisma.clinicLocation.findMany({ where: { clinicOrgId: actor.clinicOrgId!, active: true }, orderBy: { createdAt: "asc" } }),
    getSettings(),
  ]);
  const preselect = candidates.find((c) => c.providerId === sp.provider);
  return (
    <>
      <PageHeader
        title="Standing bookings"
        description={`Want the same provider on a regular schedule? Set up a standing booking. We book each shift ${s["standing.horizonWeeks"]} weeks ahead at your usual rates, charged per shift like any other booking. To hire a provider directly instead, use Request to hire on their profile. Arranging work any other way breaches the Clinic Platform Agreement.`}
      />
      <div className="grid gap-6 lg:grid-cols-5">
        <div className="space-y-4 lg:col-span-3">
          {rows.length ? rows.map((b) => (
            <Card key={b.id}>
              <CardHeader
                title={<span className="flex flex-wrap items-center gap-2">{b.providerName} <Badge tone={TONE[b.status] ?? "gray"}>{b.status === "PROPOSED" ? "Waiting for provider" : b.status.toLowerCase()}</Badge></span>}
                description={`${standing.describePattern(b)} · ${b.location.name} · from ${dateLabel(b.startsOn, "UTC", { month: "short", day: "numeric", year: "numeric" })}${b.endsOn ? ` to ${dateLabel(b.endsOn, "UTC", { month: "short", day: "numeric", year: "numeric" })}` : ""}`}
              />
              <CardBody className="space-y-3 text-sm">
                {b.upcoming.length ? (
                  <div className="flex flex-wrap gap-2">
                    {b.upcoming.slice(0, 12).map((u) => (
                      <Link key={u.id} href={`/clinic/shifts/${u.id}`} className={`rounded-lg px-2 py-1 text-xs ring-1 ${u.assignments.some((a) => a.providerId === b.providerId) ? "bg-emerald-50 text-emerald-800 ring-emerald-200" : "bg-amber-50 text-amber-800 ring-amber-200"}`}>
                        {dateLabel(u.startsAt, b.location.timeZone, { weekday: "short", month: "short", day: "numeric" })}
                      </Link>
                    ))}
                  </div>
                ) : null}
                {b.upcoming.some((u) => !u.assignments.some((a) => a.providerId === b.providerId)) ? <p className="text-xs text-amber-700">Amber days couldn&apos;t be booked with {b.providerName}, so we posted them for other providers.</p> : null}
                {b.status === "ACTIVE" || b.status === "PROPOSED" ? (
                  <ActionForm action={endStandingAction} className="flex flex-wrap items-center gap-2" confirm={b.status === "PROPOSED" ? "Withdraw this proposal?" : `End this standing booking? Shifts in the next ${s["standing.endNoticeDays"]} days stay booked; later ones are cancelled at no charge.`}>
                    <input type="hidden" name="standingId" value={b.id} />
                    {b.status === "ACTIVE" ? <Input name="reason" placeholder="Reason (optional)" className="max-w-xs" /> : null}
                    <SubmitButton size="sm" variant="outline">{b.status === "PROPOSED" ? "Withdraw" : "End standing booking"}</SubmitButton>
                  </ActionForm>
                ) : null}
              </CardBody>
            </Card>
          )) : <Empty title="No standing bookings yet">Propose one to a provider you&apos;ve worked with.</Empty>}
        </div>
        <div className="lg:col-span-2">
          <Card>
            <CardHeader title={<>Propose a standing booking<InfoTip label="About standing bookings">The provider gets your request and accepts or declines. Once accepted, each matching day is booked automatically a few weeks ahead at your usual rates, with a deposit per shift like any booking. If they can&apos;t make a day, it&apos;s posted for other providers. Either side can end it with notice.</InfoTip></>} description="Available with providers you've completed a shift with." />
            <CardBody>
              {candidates.length && locations.length ? (
                <ActionForm action={proposeStandingAction} className="space-y-4" resetOnSuccess>
                  <Field label="Provider" htmlFor="providerProfession">
                    <Select id="providerProfession" name="providerProfession" defaultValue={preselect ? `${preselect.providerId}|${preselect.professionCode}` : undefined} required>
                      {candidates.map((c) => <option key={`${c.providerId}|${c.professionCode}`} value={`${c.providerId}|${c.professionCode}`}>{c.name} · {c.professionCode}</option>)}
                    </Select>
                  </Field>
                  <Field label="Location" htmlFor="locationId">
                    <Select id="locationId" name="locationId" required>
                      {locations.map((l) => <option key={l.id} value={l.id}>{l.name} · {l.city}</option>)}
                    </Select>
                  </Field>
                  <fieldset>
                    <legend className="mb-1.5 text-sm font-medium text-slate-700">Every<RequiredMark /></legend>
                    <div className="flex flex-wrap gap-x-4 gap-y-2">
                      {DAYS.map(([n, label]) => <Checkbox key={n} name="weekdays" value={n} label={label} />)}
                    </div>
                  </fieldset>
                  <div className="grid grid-cols-2 gap-3">
                    <Field label="From" htmlFor="startTime"><Input id="startTime" name="startTime" type="time" defaultValue="09:00" required /></Field>
                    <Field label="To" htmlFor="endTime"><Input id="endTime" name="endTime" type="time" defaultValue="17:00" required /></Field>
                    <Field label="Starting" htmlFor="startsOn"><Input id="startsOn" name="startsOn" type="date" required /></Field>
                    <Field label="Ending (optional)" htmlFor="endsOn"><Input id="endsOn" name="endsOn" type="date" /></Field>
                  </div>
                  <Field label="Note to the provider (optional)" htmlFor="notes"><Textarea id="notes" name="notes" maxLength={1000} /></Field>
                  <SubmitButton className="w-full">Send proposal</SubmitButton>
                </ActionForm>
              ) : <p className="text-sm text-slate-500">Once you&apos;ve completed a shift with a provider, you can offer them a standing booking here.</p>}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
