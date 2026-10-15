import { BedDouble, CheckCircle2, FileText, KeyRound, MapPin } from "lucide-react";
import type { stay } from "@cm/services";
import { ackStayAction } from "@/app/provider/actions";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";

type View = NonNullable<ReturnType<typeof stay.providerStay>>;

/** The provider's clinic-booked stay: details, map, access (from 48 h before), confirmation file, "Got it". */
export function ProviderStayCard({ view, assignmentId }: { view: View; assignmentId: string }) {
  const tz = view.timeZone;
  const when = (d: Date) => d.toLocaleString("en-US", { timeZone: tz, weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" });
  return (
    <Card>
      <CardHeader title="Your stay" description={`Booked and paid for by the clinic: ${view.label}. You don't pay for it, and no lodging allowance is added.`} />
      <CardBody className="space-y-3 text-sm text-slate-700">
        {view.status === "UPDATING" ? (
          <p>The clinic is moving the reservation into your name. We&apos;ll let you know as soon as the details are ready.</p>
        ) : view.status === "WAITING" ? (
          <p>The clinic hasn&apos;t added where you&apos;re staying yet. We&apos;ll let you know as soon as they do, and remind them if it gets close.</p>
        ) : (
          <>
            {view.place || view.address ? (
              <div className="flex gap-2">
                <MapPin className="mt-0.5 size-4 shrink-0 text-slate-400" />
                <div>
                  {view.place ? <div className="font-semibold">{view.place}</div> : null}
                  {view.address ? <div>{view.address}</div> : null}
                  {view.mapUrl ? <a href={view.mapUrl} target="_blank" rel="noreferrer" className="text-brand-700 hover:underline">Open in Maps</a> : null}
                </div>
              </div>
            ) : null}
            <dl className="grid grid-cols-[7rem_1fr] gap-x-3 gap-y-1">
              {view.checkIn ? <><dt className="text-slate-500">Check-in</dt><dd>{when(view.checkIn)}</dd></> : null}
              {view.checkOut ? <><dt className="text-slate-500">Check-out</dt><dd>{when(view.checkOut)}</dd></> : null}
              {view.bookedUnder ? <><dt className="text-slate-500">Booked under</dt><dd>{view.bookedUnder}</dd></> : null}
              {view.confirmation ? <><dt className="text-slate-500">Confirmation</dt><dd className="font-mono">{view.confirmation}</dd></> : null}
            </dl>
            {view.access ? (
              <div className="flex gap-2 rounded-lg bg-amber-50 p-2 text-amber-900"><KeyRound className="mt-0.5 size-4 shrink-0" /><span className="whitespace-pre-line">{view.access}</span></div>
            ) : view.accessLater ? (
              <p className="flex items-center gap-2 text-xs text-slate-500"><KeyRound className="size-3.5" />Access instructions appear here from {when(view.accessLater)}.</p>
            ) : null}
            {view.notes ? <p className="whitespace-pre-line">{view.notes}</p> : null}
            {view.fileUrl ? <a href={view.fileUrl} target="_blank" className="inline-flex items-center gap-1 font-medium text-brand-700 hover:underline"><FileText className="size-4" />Booking confirmation</a> : null}
            {view.ackAt ? (
              <p className="flex items-center gap-1.5 text-emerald-700"><CheckCircle2 className="size-4" />You confirmed you&apos;ve seen these details.</p>
            ) : (
              <ActionForm action={ackStayAction}>
                <input type="hidden" name="assignmentId" value={assignmentId} />
                <SubmitButton className="w-full"><BedDouble className="size-4" />Got it</SubmitButton>
              </ActionForm>
            )}
            <p className="text-xs text-slate-500">Something wrong with the booking (name, dates)? Message the clinic from this page.</p>
          </>
        )}
      </CardBody>
    </Card>
  );
}
