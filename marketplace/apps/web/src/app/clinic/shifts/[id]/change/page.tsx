import { notFound, redirect } from "next/navigation";
import { DateTime } from "luxon";
import { prisma } from "@cm/db";
import { getSettings, shiftChanges } from "@cm/services";
import { Alert, PageHeader } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";
import { ChangeShiftForm } from "./change-form";

export const metadata = { title: "Change shift" };

export default async function ChangeShift({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor("clinic");
  const { id } = await params;
  const shift = await prisma.shift.findFirst({
    where: { id, location: { clinicOrgId: actor.clinicOrgId! } },
    include: { location: true, assignments: { where: { status: "CONFIRMED" }, include: { provider: { select: { displayName: true } } } }, changes: { where: { status: "PENDING" } } },
  });
  if (!shift) notFound();
  if (shift.status === "DRAFT") redirect(`/clinic/shifts/new?draft=${id}`);
  const s = await getSettings();
  const tz = shift.location.timeZone;
  const start = DateTime.fromJSDate(shift.startsAt, { zone: tz });
  const end = DateTime.fromJSDate(shift.endsAt, { zone: tz });
  const provider = shift.assignments[0]?.provider.displayName ?? null;
  const allowed = shiftChanges.canChange(shift);
  return (
    <>
      <PageHeader
        eyebrow={`${shift.professionCode} · ${shift.location.name}`}
        title="Change this shift"
        description={
          provider
            ? `${provider} is confirmed, so they'll be asked to accept the change. If they decline or don't answer, they're released with no penalty, your deposit is refunded and we offer the shift with its new details to other providers.`
            : "No one is confirmed yet, so the change applies right away. Anyone who already applied is told about it."
        }
      />
      {!allowed ? (
        <Alert tone="warning">{shift.emergencyAt || shift.rescueOfShiftId ? "We're urgently finding cover for this shift, so it can't be changed right now. Contact us if the time or details are wrong." : "This shift can no longer be changed."}</Alert>
      ) : shift.changes.length ? (
        <Alert tone="info">A change is already waiting for {provider ?? "your provider"}. Withdraw it from the shift page to send a different one.</Alert>
      ) : (
        <ChangeShiftForm
          shiftId={shift.id}
          initial={{
            date: start.toISODate()!,
            start: start.toFormat("HH:mm"),
            end: end.toFormat("HH:mm"),
            lunch: String(shift.lunchMinutes),
            lunchStart: shift.lunchStartsAt ? DateTime.fromJSDate(shift.lunchStartsAt, { zone: shift.location.timeZone }).toFormat("HH:mm") : "12:00",
            expectedPatients: shift.expectedPatients,
            minYearsExperience: shift.minYearsExperience,
            notes: shift.notes ?? "",
          }}
          volume={shift.declaredTier !== null}
          provider={provider}
          minLeadHours={s["matching.changeMinLeadHours"]}
        />
      )}
    </>
  );
}
