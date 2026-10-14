import Link from "next/link";
import { getSettings, standing } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { Empty, PageHeader } from "@/components/ui/misc";
import { dateLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { endStandingAction, respondStandingAction, respondStandingChangeAction } from "../actions";

export const metadata = { title: "Standing bookings" };
export const dynamic = "force-dynamic";

const TONE: Record<string, "green" | "amber" | "gray" | "red"> = { ACTIVE: "green", PROPOSED: "amber", DECLINED: "gray", ENDED: "gray", WITHDRAWN: "gray" };

export default async function ProviderStanding() {
  const { actor } = await requireActor("provider");
  const [rows, s] = await Promise.all([standing.providerStanding(actor), getSettings()]);
  return (
    <>
      <PageHeader
        title="Standing bookings"
        description={`Regular work with a clinic you've covered for, booked and paid through the platform. We book each shift ${s["standing.horizonWeeks"]} weeks ahead; you can still cancel a single day like any shift, or end the arrangement with ${s["standing.endNoticeDays"]} days' notice.`}
      />
      <div className="space-y-4">
        {rows.length ? rows.map((b) => (
          <Card key={b.id}>
            <CardHeader
              title={<span className="flex flex-wrap items-center gap-2">{b.clinicName} <Badge tone={TONE[b.status] ?? "gray"}>{b.status === "PROPOSED" ? "New request" : b.status.toLowerCase()}</Badge></span>}
              description={`${standing.describePattern(b)} · ${b.location.name}, ${b.location.city} · from ${dateLabel(b.startsOn, "UTC", { month: "short", day: "numeric", year: "numeric" })}${b.endsOn ? ` to ${dateLabel(b.endsOn, "UTC", { month: "short", day: "numeric", year: "numeric" })}` : ""}`}
            />
            <CardBody className="space-y-3 text-sm">
              {b.notes ? <p className="whitespace-pre-line rounded-xl bg-slate-50 p-3 text-slate-700">{b.notes}</p> : null}
              {b.status === "PROPOSED" ? (
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={respondStandingAction}>
                    <input type="hidden" name="standingId" value={b.id} />
                    <input type="hidden" name="decision" value="accept" />
                    <SubmitButton>Accept</SubmitButton>
                  </ActionForm>
                  <ActionForm action={respondStandingAction} confirm="Decline this standing booking?">
                    <input type="hidden" name="standingId" value={b.id} />
                    <input type="hidden" name="decision" value="decline" />
                    <SubmitButton variant="outline">Decline</SubmitButton>
                  </ActionForm>
                </div>
              ) : null}
              {b.status === "ACTIVE" && b.pending ? (
                <div className="space-y-2 rounded-xl bg-amber-50 p-3 text-amber-900 ring-1 ring-amber-200">
                  <p className="font-medium">{b.clinicName} would like to change this standing booking</p>
                  <p>{standing.describeChange(b.pattern, b.pending)}</p>
                  {b.pending.notes && b.pending.notes !== b.notes ? <p className="whitespace-pre-line text-amber-800">{b.pending.notes}</p> : null}
                  <p className="text-xs text-amber-800">Nothing changes until you accept. If you accept, days that no longer fit are released (days in the next {s["payments.clinicFreeCancelHours"]} hours stay booked) and the new days are booked for you straight away.</p>
                  <div className="flex flex-wrap gap-2">
                    <ActionForm action={respondStandingChangeAction}>
                      <input type="hidden" name="standingId" value={b.id} />
                      <input type="hidden" name="decision" value="accept" />
                      <SubmitButton size="sm">Accept change</SubmitButton>
                    </ActionForm>
                    <ActionForm action={respondStandingChangeAction} confirm="Decline this change? Your current schedule stays as it is.">
                      <input type="hidden" name="standingId" value={b.id} />
                      <input type="hidden" name="decision" value="decline" />
                      <SubmitButton size="sm" variant="outline">Decline</SubmitButton>
                    </ActionForm>
                  </div>
                </div>
              ) : null}
              {b.upcoming.some((u) => u.assignments.some((a) => a.providerId === b.providerId)) ? (
                <div className="flex flex-wrap gap-2">
                  {b.upcoming.filter((u) => u.assignments.some((a) => a.providerId === b.providerId)).slice(0, 12).map((u) => (
                    <Link key={u.id} href={`/provider/assignments/${u.assignments.find((a) => a.providerId === b.providerId)!.id}`} className="rounded-lg bg-emerald-50 px-2 py-1 text-xs text-emerald-800 ring-1 ring-emerald-200">
                      {dateLabel(u.startsAt, b.location.timeZone, { weekday: "short", month: "short", day: "numeric" })}
                    </Link>
                  ))}
                </div>
              ) : null}
              {b.status === "ACTIVE" ? (
                <ActionForm action={endStandingAction} className="flex flex-wrap items-center gap-2" confirm={`End this standing booking? Shifts in the next ${s["standing.endNoticeDays"]} days stay booked; later ones are released.`}>
                  <input type="hidden" name="standingId" value={b.id} />
                  <Input name="reason" placeholder="Reason (shared with the clinic)" className="max-w-xs" />
                  <SubmitButton size="sm" variant="outline">End standing booking</SubmitButton>
                </ActionForm>
              ) : null}
            </CardBody>
          </Card>
        )) : <Empty title="No standing bookings">Clinics you&apos;ve worked with can invite you to a regular schedule. Requests show up here.</Empty>}
      </div>
    </>
  );
}
