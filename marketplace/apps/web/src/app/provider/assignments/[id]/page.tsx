import { notFound } from "next/navigation";
import { MapPin, Phone, User } from "lucide-react";
import { prisma } from "@cm/db";
import { getSettings, timeclock, volume } from "@cm/services";
import { visitsAction } from "@/app/timeclock-actions";
import { ProviderVisitCard } from "@/components/timeclock/visit-count";
import { ClockCard } from "@/components/timeclock/clock-card";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, PhiNotice, Select, Textarea } from "@/components/ui/form";
import { Alert, PageHeader } from "@/components/ui/misc";
import { dateLabel, money, timeRange } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { cancelAssignmentAction, disputeAction, graceCancelAction, lodgingAction, onMyWayAction, openThreadAction, ratingAction, reconfirmAction } from "../../actions";

export default async function Assignment({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor("provider");
  const { id } = await params;
  const a = await prisma.assignment.findFirst({
    where: { id, providerId: actor.providerId! },
    include: { shift: { include: { location: { include: { clinicOrg: true } } } }, ratings: true, lodgingReceipts: true, disputes: true, payouts: true },
  });
  if (!a) notFound();
  const s = await getSettings();
  const tz = a.shift.location.timeZone;
  const loc = a.shift.location;
  const live = a.status === "CONFIRMED" || a.status === "IN_PROGRESS";
  const hoursToStart = (+a.startsAt - Date.now()) / 3_600_000;
  const myRating = a.ratings.find((r) => r.raterType === "PROVIDER");
  const theirRating = a.ratings.find((r) => r.raterType === "CLINIC" && r.revealedAt);
  const disputeOpen = Date.now() - +a.endsAt < s["payments.disputeWindowHours"] * 3_600_000;
  const clockOpen = s["timeclock.enabled"] && ["CONFIRMED", "IN_PROGRESS", "COMPLETED", "DISPUTED"].includes(a.status) && +a.startsAt - Date.now() < s["timeclock.earliestInMinutes"] * 60_000;
  const clock = clockOpen ? await timeclock.timesheetForProvider(actor, a.id) : null;
  const visitView = +a.startsAt <= Date.now() ? await volume.visitViewForProvider(actor, a.id) : null;
  // Multi-day booking: this provider's remaining confirmed days (this one included).
  const remainingDays = a.shift.shiftGroupId
    ? await prisma.assignment.count({ where: { providerId: actor.providerId!, status: { in: ["CONFIRMED", "IN_PROGRESS"] }, startsAt: { gte: a.startsAt }, shift: { shiftGroupId: a.shift.shiftGroupId } } })
    : 1;
  return (
    <>
      <PageHeader eyebrow={loc.clinicOrg.displayName} title={dateLabel(a.startsAt, tz, { weekday: "long", month: "long", day: "numeric" })} description={timeRange(a.startsAt, a.endsAt, tz)} actions={<StatusBadge status={a.status} />} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {clock ? <ClockCard v={clock} /> : null}
          {visitView ? <ProviderVisitCard v={visitView} assignmentId={a.id} tz={tz} action={visitsAction} /> : null}
          {live && a.reconfirmRequestedAt && !a.reconfirmedAt ? (
            <Alert tone="warning" title="Please confirm you're still coming">
              <p>If you don't confirm by {dateLabel(new Date(+a.startsAt - s["reconfirm.deadlineBeforeHours"] * 3_600_000), tz, { weekday: "short", hour: "numeric", minute: "2-digit" })}, this shift goes to another provider.</p>
              <ActionForm action={reconfirmAction} className="mt-2">
                <input type="hidden" name="assignmentId" value={a.id} />
                <SubmitButton size="sm">I'm still coming</SubmitButton>
              </ActionForm>
            </Alert>
          ) : null}
          {live && hoursToStart <= 12 && hoursToStart > -2 && !a.onMyWayAt ? (
            <Card>
              <CardHeader title="Heading out?" description="Let the clinic know you're on your way." />
              <CardBody>
                <ActionForm action={onMyWayAction}>
                  <input type="hidden" name="assignmentId" value={a.id} />
                  <SubmitButton>On my way</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
          {live && (a.reconfirmedAt || a.onMyWayAt) ? (
            <p className="text-sm text-emerald-700">{a.onMyWayAt ? "✓ The clinic knows you're on your way." : "✓ You've confirmed you're coming."}</p>
          ) : null}
          {live ? (
            <Card>
              <CardHeader title="Where & who" description="Shared with you after confirmation." />
              <CardBody className="space-y-3 text-sm">
                <div className="flex gap-2"><MapPin className="size-4 shrink-0 text-slate-400" /><span>{loc.addressLine1}{loc.addressLine2 ? `, ${loc.addressLine2}` : ""}, {loc.city}, {loc.state} {loc.zip}</span></div>
                {loc.onSiteContactName ? <div className="flex gap-2"><User className="size-4 text-slate-400" />On-site contact: {loc.onSiteContactName}</div> : null}
                {loc.phone ? <div className="flex gap-2"><Phone className="size-4 text-slate-400" />Front desk: {loc.phone}</div> : null}
                {loc.dressCode ? <div><span className="font-medium">Attire:</span> {loc.dressCode}</div> : null}
                {loc.arrivalNotes ? (
                  <div className="rounded-xl bg-brand-50 p-3 text-brand-900">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-brand-700">How to find us</div>
                    <p className="whitespace-pre-line">{loc.arrivalNotes}</p>
                  </div>
                ) : null}
                {loc.photoKeys.length ? (
                  <div className="grid grid-cols-2 gap-2 sm:grid-cols-4">
                    {loc.photoKeys.map((k) => (
                      <a key={k} href={`/api/files/${k}`} target="_blank" rel="noreferrer">
                        {/* eslint-disable-next-line @next/next/no-img-element */}
                        <img src={`/api/files/${k}`} alt="Clinic exterior" className="aspect-[4/3] w-full rounded-lg object-cover ring-1 ring-slate-200" />
                      </a>
                    ))}
                  </div>
                ) : null}
                {loc.ehr ? <div><span className="font-medium">EHR:</span> {loc.ehr}</div> : null}
                <ActionForm action={openThreadAction} successMessage={false}>
                  <input type="hidden" name="shiftId" value={a.shiftId} />
                  <SubmitButton variant="outline" size="sm">Message the clinic</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
          {a.status === "COMPLETED" ? (
            <Card>
              <CardHeader title="Rate this clinic" description="Ratings are double-blind: revealed once both sides submit or after 14 days." />
              <CardBody>
                {myRating ? (
                  <p className="text-sm text-slate-600">You rated this clinic {myRating.stars}★.{theirRating ? ` The clinic rated you ${theirRating.stars}★.` : ""}</p>
                ) : (
                  <ActionForm action={ratingAction} className="space-y-3">
                    <input type="hidden" name="assignmentId" value={a.id} />
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
                      {[["stars", "Overall"], ["accuracy", "Posting accuracy"], ["staff", "Staff support"], ["organization", "Organization"], ["wouldReturn", "Would return"]].map(([n, l]) => (
                        <Field key={n} label={l}>
                          <Select name={n} defaultValue="5" required>{[5, 4, 3, 2, 1].map((v) => <option key={v} value={v}>{v}★</option>)}</Select>
                        </Field>
                      ))}
                    </div>
                    <Textarea name="comment" placeholder="Anything other providers should know? (optional)" maxLength={1000} />
                    <PhiNotice />
                    <SubmitButton>Submit rating</SubmitButton>
                  </ActionForm>
                )}
              </CardBody>
            </Card>
          ) : null}
          {a.shift.lodgingAllowed && ["IN_PROGRESS", "COMPLETED"].includes(a.status) ? (
            <Card>
              <CardHeader title="Lodging receipt" description={`Reimbursed up to ${money(a.shift.lodgingCapCentsPerNight)} per night.`} />
              <CardBody>
                {a.lodgingReceipts.map((r) => <div key={r.id} className="mb-2 text-sm">{money(r.amountCents)} · {r.nights} night(s) · <StatusBadge status={r.status === "SUBMITTED" ? "PENDING" : r.status === "APPROVED" ? "PAID" : "REJECTED"} label={r.status.toLowerCase()} /></div>)}
                <ActionForm action={lodgingAction} className="grid gap-3 sm:grid-cols-3" resetOnSuccess>
                  <input type="hidden" name="assignmentId" value={a.id} />
                  <Field label="Amount ($)"><Input name="amount" inputMode="decimal" required /></Field>
                  <Field label="Nights"><Input name="nights" type="number" min={1} defaultValue={1} required /></Field>
                  <Field label="Receipt"><Input name="receipt" type="file" accept="application/pdf,image/*" required /></Field>
                  <div className="sm:col-span-3"><SubmitButton size="sm">Submit receipt</SubmitButton></div>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Pay" />
            <CardBody className="space-y-2 text-sm">
              <div className="flex justify-between"><span>Shift pay</span><span>{money(a.providerPayCents)}</span></div>
              <div className="flex justify-between"><span>Mileage ({a.driveMiles} mi)</span><span>{money(a.mileageCents)}</span></div>
              {a.lodgingApprovedCents ? <div className="flex justify-between"><span>Lodging</span><span>{money(a.lodgingApprovedCents)}</span></div> : null}
              <div className="flex justify-between border-t border-slate-100 pt-2 font-semibold"><span>Total</span><span>{money(a.providerTotalCents)}</span></div>
              {a.payouts.map((p) => <div key={p.id} className="flex justify-between text-xs text-slate-500"><span>{p.description}</span><StatusBadge status={p.onHold ? "ON_HOLD" : p.status} /></div>)}
            </CardBody>
          </Card>
          {a.status === "CONFIRMED" && a.graceEndsAt && a.graceEndsAt > new Date() ? (
            <Card className="border-brand-300">
              <CardHeader title="Booked by On Call" description="Conflict? Cancel now with no penalty — we'll find someone else right away." />
              <CardBody>
                <ActionForm action={graceCancelAction} confirm="Release this On Call booking with no penalty?">
                  <input type="hidden" name="assignmentId" value={a.id} />
                  <SubmitButton variant="outline" className="w-full">Cancel (no penalty) — until {a.graceEndsAt.toLocaleTimeString("en-US", { hour: "numeric", minute: "2-digit" })}</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
          {a.status === "CONFIRMED" ? (
            <Card>
              <CardHeader title="Can't make it?" />
              <CardBody>
                {hoursToStart < s["payments.providerLateCancelHours"] ? <Alert tone="warning" className="mb-3">Cancelling within {s["payments.providerLateCancelHours"]} hours counts as a late cancellation and affects your reliability score.</Alert> : null}
                <ActionForm action={cancelAssignmentAction} confirm="Cancel this confirmed shift? The clinic will be notified and we'll look for a replacement.">
                  <input type="hidden" name="assignmentId" value={a.id} />
                  {remainingDays > 1 ? (
                    <Field label="Which days?" htmlFor="scope" className="mb-3">
                      <Select id="scope" name="scope" defaultValue="day">
                        <option value="day">Just this day</option>
                        <option value="remaining">This and all my remaining days ({remainingDays})</option>
                      </Select>
                    </Field>
                  ) : null}
                  <Textarea name="reason" placeholder="Reason (shared with our team)" required />
                  <SubmitButton variant="danger" className="mt-3 w-full">Cancel shift</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
          {["IN_PROGRESS", "COMPLETED"].includes(a.status) && disputeOpen && !a.disputes.some((d) => d.status === "OPEN") ? (
            <Card>
              <CardHeader title="Report a problem" description="Available for 48 hours after the shift." />
              <CardBody>
                <ActionForm action={disputeAction}>
                  <input type="hidden" name="assignmentId" value={a.id} />
                  <Textarea name="reason" required placeholder="What happened?" />
                  <PhiNotice />
                  <SubmitButton variant="outline" className="mt-3 w-full">Open a dispute</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
