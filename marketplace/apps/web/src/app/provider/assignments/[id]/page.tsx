import { notFound } from "next/navigation";
import { MapPin, Phone, User } from "lucide-react";
import { prisma } from "@cm/db";
import { getSettings } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, PhiNotice, Select, Textarea } from "@/components/ui/form";
import { Alert, PageHeader } from "@/components/ui/misc";
import { dateLabel, money, timeRange } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { cancelAssignmentAction, disputeAction, lodgingAction, openThreadAction, ratingAction } from "../../actions";

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
  return (
    <>
      <PageHeader eyebrow={loc.clinicOrg.displayName} title={dateLabel(a.startsAt, tz, { weekday: "long", month: "long", day: "numeric" })} description={timeRange(a.startsAt, a.endsAt, tz)} actions={<StatusBadge status={a.status} />} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {live ? (
            <Card>
              <CardHeader title="Where & who" description="Shared with you after confirmation." />
              <CardBody className="space-y-3 text-sm">
                <div className="flex gap-2"><MapPin className="size-4 shrink-0 text-slate-400" /><span>{loc.addressLine1}{loc.addressLine2 ? `, ${loc.addressLine2}` : ""}, {loc.city}, {loc.state} {loc.zip}</span></div>
                {loc.onSiteContactName ? <div className="flex gap-2"><User className="size-4 text-slate-400" />On-site contact: {loc.onSiteContactName}</div> : null}
                {loc.phone ? <div className="flex gap-2"><Phone className="size-4 text-slate-400" />Front desk: {loc.phone}</div> : null}
                {loc.dressCode ? <div><span className="font-medium">Dress code:</span> {loc.dressCode}</div> : null}
                {loc.arrivalNotes ? <p className="whitespace-pre-line rounded-xl bg-brand-50 p-3 text-brand-900">{loc.arrivalNotes}</p> : null}
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
          {a.status === "CONFIRMED" ? (
            <Card>
              <CardHeader title="Can't make it?" />
              <CardBody>
                {hoursToStart < s["payments.providerLateCancelHours"] ? <Alert tone="warning" className="mb-3">Cancelling within {s["payments.providerLateCancelHours"]} hours counts as a late cancellation and affects your reliability score.</Alert> : null}
                <ActionForm action={cancelAssignmentAction} confirm="Cancel this confirmed shift? The clinic will be notified and we'll look for a replacement.">
                  <input type="hidden" name="assignmentId" value={a.id} />
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
