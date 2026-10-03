import { notFound } from "next/navigation";
import { Car, Clock, MapPin, Shirt, Star, Users } from "lucide-react";
import { prisma } from "@cm/db";
import { evaluateProviderForShift, getSettings } from "@cm/services";
import { parseVolumeTerms, providerView } from "@cm/core";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, PhiNotice, Textarea } from "@/components/ui/form";
import { Alert, PageHeader } from "@/components/ui/misc";
import { dateLabel, money, timeRange } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { applyAction, openThreadAction, withdrawAction } from "../../actions";

export default async function ShiftDetail({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor("provider");
  const { id } = await params;
  const shift = await prisma.shift.findUnique({ where: { id }, include: { location: { include: { clinicOrg: true } }, applications: { where: { providerId: actor.providerId! } } } });
  if (!shift) notFound();
  const app = shift.applications[0];
  // INV-1: a shift is only shown to providers who are eligible for it (or already applied).
  const ev = await evaluateProviderForShift(prisma, actor.providerId!, id);
  if (!ev.result.eligible && !app) notFound();
  const s = await getSettings();
  const mileage = ev.drive ? Math.round((s["pricing.mileageRoundTrip"] ? 2 : 1) * ev.drive.miles * s["pricing.mileageRateCentsPerMile"]) : 0;
  const pay = providerView({ clinicPriceCents: 0, providerPayCents: shift.providerPayCents, promoDiscountCents: 0, mileageCents: mileage, lodgingCents: 0 });
  const skills = await prisma.skill.findMany({ where: { id: { in: [...shift.requiredSkillIds, ...shift.preferredSkillIds] } } });
  const clinicRating = await prisma.rating.aggregate({ where: { raterType: "PROVIDER", revealedAt: { not: null }, assignment: { shift: { location: { clinicOrgId: shift.location.clinicOrgId } } } }, _avg: { stars: true }, _count: true });
  const tz = shift.location.timeZone;
  const volTerms = parseVolumeTerms(shift.volumeTerms);
  // Multi-day booking: the other days, and which of them this provider already applied to / works.
  const groupDays = shift.shiftGroupId
    ? await prisma.shift.findMany({
        where: { shiftGroupId: shift.shiftGroupId, status: { not: "CANCELLED" } },
        orderBy: { startsAt: "asc" },
        select: { id: true, startsAt: true, endsAt: true, status: true, applications: { where: { providerId: actor.providerId! }, select: { status: true } }, assignments: { where: { providerId: actor.providerId!, status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] } }, select: { id: true } } },
      })
    : [];
  const OPENISH = ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"];
  const openDays = groupDays.filter((d) => OPENISH.includes(d.status) && !d.applications.some((x) => x.status === "ACTIVE") && !d.assignments.length);
  const dayNo = groupDays.findIndex((d) => d.id === shift.id) + 1;
  return (
    <>
      <PageHeader eyebrow={groupDays.length > 1 && dayNo ? `${shift.professionCode} coverage · Day ${dayNo} of ${groupDays.length}` : `${shift.professionCode} coverage`} title={`${dateLabel(shift.startsAt, tz, { weekday: "long", month: "long", day: "numeric" })}`} description={`${timeRange(shift.startsAt, shift.endsAt, tz)} · ${shift.location.clinicOrg.displayName}`} />
      {shift.rateMode === "CLINIC" && !shift.releasedAt ? (
        <Alert tone="info" className="mb-5" title="Clinic-set rate">The clinic set its own rate for this shift. It isn't filled automatically: apply if the pay works for you and the clinic chooses who to confirm.</Alert>
      ) : null}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="About this shift" />
            <CardBody className="space-y-3 text-sm">
              <div className="flex items-center gap-2"><MapPin className="size-4 text-slate-400" />{shift.location.city}, {shift.state} <span className="text-slate-400">(exact address after confirmation)</span></div>
              <div className="flex items-center gap-2"><Clock className="size-4 text-slate-400" />{timeRange(shift.startsAt, shift.endsAt, tz)}</div>
              {ev.drive ? <div className="flex items-center gap-2"><Car className="size-4 text-slate-400" />About {ev.drive.minutes} min drive ({ev.drive.miles} mi)</div> : null}
              {shift.location.dressCode ? <div className="flex items-center gap-2"><Shirt className="size-4 text-slate-400" />Attire: {shift.location.dressCode}</div> : null}
              {shift.minYearsExperience ? <div className="flex items-center gap-2"><Star className="size-4 text-slate-400" />Clinic asks for {shift.minYearsExperience}+ years&apos; experience</div> : null}
              {shift.declaredTier && volTerms ? (
                <div className="flex items-start gap-2"><Users className="mt-0.5 size-4 shrink-0 text-slate-400" /><span><b>{shift.declaredTier === "LIGHT" ? "Light" : "Busy"} day</b>{shift.expectedPatients ? ` · about ${shift.expectedPatients} patients for you` : ""}. If you see more than {volTerms.ceiling + volTerms.grace}, each extra visit pays you {money(volTerms.overageProviderCents)}: enter the count when you clock out.</span></div>
              ) : shift.expectedPatients ? <div className="flex items-center gap-2"><Users className="size-4 text-slate-400" />About {shift.expectedPatients} patients</div> : shift.location.patientsPerDay ? <div className="flex items-center gap-2"><Users className="size-4 text-slate-400" />Usually about {shift.location.patientsPerDay} patients a day</div> : null}
              {clinicRating._count ? <div className="flex items-center gap-2"><Star className="size-4 text-amber-500" />{clinicRating._avg.stars?.toFixed(1)} from {clinicRating._count} provider rating{clinicRating._count === 1 ? "" : "s"}</div> : null}
              {skills.length ? (
                <div className="flex flex-wrap gap-1.5 pt-1">
                  {skills.map((k) => (
                    <Badge key={k.id} tone={shift.requiredSkillIds.includes(k.id) ? "brand" : "gray"}>{k.name}{shift.requiredSkillIds.includes(k.id) ? " · required" : ""}</Badge>
                  ))}
                </div>
              ) : null}
              {shift.notes ? <p className="whitespace-pre-line rounded-xl bg-slate-50 p-3 text-slate-700">{shift.notes}</p> : null}
            </CardBody>
          </Card>
          {groupDays.length > 1 ? (
            <Card>
              <CardHeader title={`Part of a ${groupDays.length}-day booking`} description="The clinic needs cover on each of these days. You can apply for one day or all of them." />
              <CardBody className="divide-y divide-slate-100 p-0 text-sm">
                {groupDays.map((d, i) => {
                  const mine = d.assignments.length ? "You're booked" : d.applications.some((x) => x.status === "ACTIVE") ? "Applied" : OPENISH.includes(d.status) ? "Open" : "Filled";
                  return (
                    <a key={d.id} href={`/provider/shifts/${d.id}`} className={`flex items-center justify-between px-5 py-3 hover:bg-slate-50 ${d.id === shift.id ? "bg-brand-50/50" : ""}`}>
                      <span><span className="text-slate-400">Day {i + 1} · </span>{dateLabel(d.startsAt, tz, { weekday: "short", month: "short", day: "numeric" })} · {timeRange(d.startsAt, d.endsAt, tz)}</span>
                      <Badge tone={mine === "Open" ? "brand" : mine === "Filled" ? "gray" : "green"}>{mine}</Badge>
                    </a>
                  );
                })}
              </CardBody>
            </Card>
          ) : null}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Your pay" />
            <CardBody className="space-y-2 text-sm">
              <div className="flex justify-between"><span>Shift pay</span><span className="tabular-nums">{money(pay.payCents)}</span></div>
              <div className="flex justify-between"><span>Mileage</span><span className="tabular-nums">{money(pay.mileageCents)}</span></div>
              {shift.lodgingAllowed ? <div className="flex justify-between text-slate-500"><span>Lodging</span><span>Reimbursed up to {money(shift.lodgingCapCentsPerNight)}/night</span></div> : null}
              <div className="flex justify-between border-t border-slate-100 pt-2 text-base font-semibold"><span>Total</span><span className="tabular-nums text-brand-700">{money(pay.totalCents)}</span></div>
            </CardBody>
          </Card>
          <Card>
            <CardBody>
              {app?.status === "ACTIVE" ? (
                <>
                  <Alert tone="success" title="You've applied">We'll let you know if the clinic selects you.</Alert>
                  <ActionForm action={withdrawAction} className="mt-3" confirm="Withdraw your application?">
                    <input type="hidden" name="applicationId" value={app.id} />
                    <SubmitButton variant="outline" className="w-full">Withdraw application</SubmitButton>
                  </ActionForm>
                  <ActionForm action={openThreadAction} className="mt-2" successMessage={false}>
                    <input type="hidden" name="shiftId" value={shift.id} />
                    <SubmitButton variant="ghost" className="w-full">Message the clinic</SubmitButton>
                  </ActionForm>
                </>
              ) : app ? (
                <Alert tone="info">Your application status: {app.status.toLowerCase().replace(/_/g, " ")}.</Alert>
              ) : (
                <ActionForm action={applyAction} className="space-y-4">
                  <input type="hidden" name="shiftId" value={shift.id} />
                  <Field label="Note to the clinic (optional)" htmlFor="note">
                    <Textarea id="note" name="note" maxLength={500} placeholder="Techniques you use, what you're comfortable with…" />
                    <PhiNotice />
                  </Field>
                  {openDays.length > 1 ? <Checkbox name="allDays" defaultChecked label={`Apply for all ${openDays.length} open days of this booking`} /> : null}
                  <Checkbox name="commit" required label="If selected, I commit to working this shift." />
                  <SubmitButton className="w-full" size="lg">{shift.instantBook ? "Book now" : "Apply"}</SubmitButton>
                </ActionForm>
              )}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
