import { DateTime } from "luxon";
import { BedDouble, CheckCircle2 } from "lucide-react";
import type { stay } from "@cm/services";
import { stayDetailsAction } from "@/app/clinic/actions";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, PhiNotice, Select, Textarea } from "@/components/ui/form";
import { Alert } from "@/components/ui/misc";

type View = Awaited<ReturnType<typeof stay.clinicStayView>>;

const local = (d: Date | null, tz: string) => (d ? DateTime.fromJSDate(d, { zone: tz }).toFormat("yyyy-MM-dd'T'HH:mm") : "");

/** Clinic-booked stay: the details form, who to book it for, and whether the provider has seen it. */
export function StayCard({ view }: { view: View }) {
  const { shift, live } = view;
  const tz = shift.location.timeZone;
  return (
    <Card id="stay">
      <CardHeader
        title="Your provider's stay"
        description="You book and pay for the stay (hotel, Airbnb, apartment or other) when your provider lives far enough away to stay the night before. Only the provider you confirm sees these details."
      />
      <CardBody>
        {live ? (
          live.needsStay ? (
            <div className="mb-4 space-y-2">
              <Alert tone={live.missing.length ? "warning" : "info"}>
                {live.displayName} {live.flyIn ? "flies in" : `lives ${live.driveMinutes} minutes away`}, so they need a place to stay the night before.
                <span className="mt-1 block font-semibold">Book it under their legal name: {live.legalName}</span>
                <span className="block text-xs">Hotels check ID at the front desk, so the name on the reservation has to match.</span>
                {live.stale ? <span className="mt-1 block font-medium">These details were for your previous provider. Change the reservation to {live.legalName}, then save again so {live.displayName} can see them.</span> : null}
                {live.missing.length && !live.stale ? <span className="mt-1 block">Still needed: {live.missing.join(", ")}.</span> : null}
              </Alert>
              {live.ackAt ? (
                <p className="flex items-center gap-1.5 text-sm text-emerald-700"><CheckCircle2 className="size-4" />{live.displayName} has seen the stay details ({live.ackAt.toLocaleString("en-US", { timeZone: tz, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}).</p>
              ) : !live.missing.length ? (
                <p className="text-sm text-slate-600">Shared with {live.displayName}. They haven&apos;t tapped &quot;Got it&quot; yet; we&apos;ll remind them.</p>
              ) : null}
            </div>
          ) : (
            <p className="mb-4 text-sm text-slate-600">{live.displayName} lives nearby ({live.driveMinutes} minutes away), so no stay is needed for this shift.</p>
          )
        ) : (
          <p className="mb-4 text-sm text-slate-600">You can book ahead; the guest name to use appears here once a provider is confirmed. If the provider you get lives nearby, no stay is needed.</p>
        )}
        <ActionForm action={stayDetailsAction} className="space-y-3">
          <input type="hidden" name="shiftId" value={shift.id} />
          <div className="grid gap-3 sm:grid-cols-[11rem_1fr]">
            <Field label="Type of stay">
              <Select name="kind" defaultValue={shift.lodgingStayKind ?? "HOTEL"}>
                <option value="HOTEL">Hotel</option>
                <option value="RENTAL">Airbnb, apartment or rental</option>
                <option value="OTHER">Other</option>
              </Select>
            </Field>
            <Field label="Place name">
              <Input name="place" maxLength={200} defaultValue={shift.stayPlace ?? ""} placeholder="e.g. Hampton Inn Downtown" />
            </Field>
          </div>
          <Field label="Address">
            <Input name="address" maxLength={300} defaultValue={shift.stayAddress ?? ""} placeholder="Street, city, state ZIP" />
          </Field>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Check-in">
              <Input type="datetime-local" name="checkIn" defaultValue={local(shift.stayCheckIn, tz)} />
            </Field>
            <Field label="Check-out">
              <Input type="datetime-local" name="checkOut" defaultValue={local(shift.stayCheckOut, tz)} />
            </Field>
          </div>
          <div className="grid gap-3 sm:grid-cols-2">
            <Field label="Booked under (name)" hint={live?.needsStay ? `Use ${live.legalName}` : "The provider's legal name"}>
              <Input name="bookedUnder" maxLength={200} defaultValue={shift.stayBookedUnder ?? ""} />
            </Field>
            <Field label="Confirmation number">
              <Input name="confirmation" maxLength={100} defaultValue={shift.stayConfirmation ?? ""} />
            </Field>
          </div>
          <Field label="Access instructions (optional)" hint="Door or lockbox code, key pickup, parking. Shown to your provider only from 48 hours before the shift.">
            <Textarea name="access" maxLength={600} defaultValue={shift.stayAccess ?? ""} />
          </Field>
          <Field label="Notes (optional)">
            <Textarea name="details" maxLength={600} defaultValue={shift.lodgingStayDetails ?? ""} placeholder="Anything else they should know: breakfast, early check-in, Wi-Fi…" />
            <PhiNotice />
          </Field>
          <Field label="Booking confirmation (optional)" hint="PDF or a screenshot, up to 10 MB.">
            <Input type="file" name="file" accept="application/pdf,image/*" />
          </Field>
          {shift.stayFileKey ? (
            <div className="flex flex-wrap items-center gap-3 text-sm">
              <a href={`/api/files/${shift.stayFileKey}`} target="_blank" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"><BedDouble className="size-4" />Current confirmation</a>
              <Checkbox name="removeFile" label="Remove it" />
            </div>
          ) : null}
          <SubmitButton className="w-full">{live?.needsStay ? `Save and share with ${live.displayName}` : "Save stay details"}</SubmitButton>
        </ActionForm>
      </CardBody>
    </Card>
  );
}
