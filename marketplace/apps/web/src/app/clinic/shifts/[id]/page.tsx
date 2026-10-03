import { notFound } from "next/navigation";
import Link from "next/link";
import { Ban, Car, Heart, MessageSquare, Radar, Star, Zap } from "lucide-react";
import { prisma } from "@cm/db";
import { clinicView } from "@cm/core";
import { dispatch, getSettings, shiftCandidates, shiftChanges, timeclock, volume } from "@cm/services";
import { clinicApproveAction, clinicConfirmVisitsAction, clinicReportAction, clinicReportVisitsAction } from "@/app/timeclock-actions";
import { ClinicVisitPanel } from "@/components/timeclock/visit-count";
import { SignOffForm } from "@/components/timeclock/signoff-form";
import { TrustPanel } from "@/components/clinic/trust-panel";
import { bookAgainAction } from "../../actions";
import { TimesheetPanel, TimesheetStatus } from "@/components/timeclock/timesheet-panel";
import { AutoRefresh, Countdown } from "@/components/countdown";
import { BadgeList } from "@/components/provider-profile";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, PhiNotice, Select, Textarea } from "@/components/ui/form";
import { Alert, Empty, PageHeader } from "@/components/ui/misc";
import { dateLabel, money, pct, relative, timeRange } from "@/lib/format";
import { requireActor } from "@/lib/session";
import {
  blockAction, boostAction, cancelDispatchAction, confirmAllDaysAction, cancelShiftAction, disputeAction, favoriteAction, findSomeoneNowAction, instantConfirmAction, inviteAction, openThreadAction,
  markArrivedAction, postDraftAction, privateFeedbackAction, ratingAction, releaseClinicRateAction, reportNoShowAction, selectAction, withdrawShiftChangeAction,
} from "../../actions";

type Cand = Awaited<ReturnType<typeof shiftCandidates>>["applicants"][number];

function CandidateCard({ c, shiftId, applicant }: { c: Cand; shiftId: string; applicant: boolean }) {
  return (
    <div className="rounded-2xl border border-slate-200 p-4">
      <div className="flex items-start gap-3">
        {c.photoUrl ? <img src={`/api/files/${c.photoUrl}`} alt="" className="size-12 rounded-full object-cover" /> : <div className="grid size-12 place-items-center rounded-full bg-brand-50 font-semibold text-brand-700">{c.displayName.replace(/^Dr\.?\s*/, "").slice(0, 1)}</div>}
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <Link href={`/clinic/providers/${c.providerId}`} className="font-semibold hover:text-brand-700">{c.displayName}, {c.credentialTitle}</Link>
            {c.badges.map((b) => <Badge key={b} tone={b === "Favorite" ? "brand" : "green"}>{b}</Badge>)}
            {c.instantConfirm ? <Badge tone="brand"><Zap className="size-3" />Instant confirm available</Badge> : null}
            {c.acceptedPending ? <Badge tone="green">Accepted — waiting</Badge> : null}
          </div>
          <div className="mt-0.5 flex flex-wrap gap-x-3 text-xs text-slate-500">
            <span>{c.city}, {c.state}</span>
            {c.driveMinutes !== null ? <span className="flex items-center gap-1"><Car className="size-3" />{c.driveMinutes} min</span> : null}
            <span className="flex items-center gap-1"><Star className="size-3 text-amber-500" />{c.ratingAvg ? `${c.ratingAvg.toFixed(1)} (${c.ratingCount})` : "No ratings yet"}</span>
            <span>Reliability {pct(c.reliability)}</span>
            <span>Match {Math.round(c.score * 100)}</span>
            {c.personalInjuryExperience ? <span className="font-medium text-accent-700">Personal injury experience</span> : null}
          </div>
          {c.skills.length ? <div className="mt-2 flex flex-wrap gap-1">{c.skills.slice(0, 8).map((s) => <Badge key={s}>{s}</Badge>)}</div> : null}
          {c.earnedBadges.length ? <div className="mt-2"><BadgeList badges={c.earnedBadges} compact /></div> : null}
          {c.note ? <p className="mt-2 rounded-lg bg-slate-50 p-2 text-sm text-slate-700">“{c.note}”</p> : null}
        </div>
      </div>
      <div className="mt-3 flex flex-wrap gap-2">
        {c.instantConfirm && !applicant && !c.acceptedPending ? (
          <ActionForm action={instantConfirmAction} confirm={`Confirm ${c.displayName} now? They're On Call for shifts like this. The deposit is charged now.`}>
            <input type="hidden" name="shiftId" value={shiftId} />
            <input type="hidden" name="providerId" value={c.providerId} />
            <SubmitButton size="sm"><Zap className="size-4" />Confirm instantly</SubmitButton>
          </ActionForm>
        ) : null}
        {applicant || c.acceptedPending ? (
          <ActionForm action={selectAction} confirm={`Confirm ${c.displayName} for this shift? The deposit is charged now.`}>
            <input type="hidden" name="shiftId" value={shiftId} />
            <input type="hidden" name="providerId" value={c.providerId} />
            <SubmitButton size="sm">Select</SubmitButton>
          </ActionForm>
        ) : c.pendingOffer ? (
          <Badge tone="amber">Invitation sent</Badge>
        ) : (
          <label className="flex items-center gap-2 rounded-xl border border-slate-300 px-3 py-1.5 text-sm">
            <input type="checkbox" name="providerId" value={c.providerId} form={`invite-${shiftId}`} className="size-4 text-brand-600" /> Invite
          </label>
        )}
        <ActionForm action={openThreadAction} successMessage={false}>
          <input type="hidden" name="shiftId" value={shiftId} />
          <input type="hidden" name="providerId" value={c.providerId} />
          <SubmitButton size="sm" variant="ghost"><MessageSquare className="size-4" />Message</SubmitButton>
        </ActionForm>
        <ActionForm action={blockAction} confirm={`Block ${c.displayName}? They won't be matched to your shifts.`}>
          <input type="hidden" name="providerId" value={c.providerId} />
          <SubmitButton size="sm" variant="ghost"><Ban className="size-4" />Block</SubmitButton>
        </ActionForm>
      </div>
    </div>
  );
}

export default async function ClinicShift({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ posted?: string; saved?: string; rebooked?: string; changed?: string }> }) {
  const { actor, user } = await requireActor("clinic");
  const { id } = await params;
  const sp = await searchParams;
  const shift = await prisma.shift.findFirst({
    where: { id, location: { clinicOrgId: actor.clinicOrgId! } },
    include: {
      location: true,
      promoCode: true,
      assignments: { orderBy: { confirmedAt: "desc" }, include: { provider: true, payments: true, ratings: true, disputes: true } },
    },
  });
  if (!shift) notFound();
  const s = await getSettings();
  const tz = shift.location.timeZone;
  const live = shift.assignments.find((a) => ["CONFIRMED", "IN_PROGRESS", "COMPLETED", "DISPUTED"].includes(a.status));
  const visitView = live && +live.startsAt <= Date.now() ? await volume.visitViewForClinic(actor, live.id) : null;
  const sheet = live && s["timeclock.enabled"] && +live.startsAt - Date.now() < s["timeclock.earliestInMinutes"] * 60_000 ? await timeclock.timesheetForClinic(actor, live.id) : null;
  const selectable = ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING"].includes(shift.status);
  const cands = selectable ? await shiftCandidates(actor, id) : null;
  const track = await dispatch.dispatchStatus(id);
  const acceptedIds = new Set(track?.acceptedPending.map((a) => a.providerId) ?? []);
  const view = clinicView({
    clinicPriceCents: live?.clinicPriceCents ?? shift.clinicPriceCents,
    providerPayCents: 0,
    promoDiscountCents: live?.promoDiscountCents ?? shift.promoDiscountCents,
    mileageCents: live?.mileageCents ?? 0,
    lodgingCents: live?.lodgingApprovedCents ?? 0,
  });
  const hoursToStart = (+shift.startsAt - Date.now()) / 3_600_000;
  const replacement = await prisma.shift.findFirst({ where: { rescueOfShiftId: id }, select: { id: true } });
  const myFeedback = live?.status === "COMPLETED" ? await prisma.providerFeedback.findUnique({ where: { assignmentId: live.id } }) : null;
  const activeLive = live && (live.status === "CONFIRMED" || live.status === "IN_PROGRESS") && !live.arrivedAt && Date.now() < +shift.endsAt ? live : null;
  const fav = live ? await prisma.favorite.findFirst({ where: { fromType: "CLINIC", fromId: actor.clinicOrgId!, toType: "PROVIDER", toId: live.providerId } }) : null;
  const myRating = live?.ratings.find((r) => r.raterType === "CLINIC");
  const theirs = live?.ratings.find((r) => r.raterType === "PROVIDER" && r.revealedAt);
  // Multi-day booking: every day with who covers it, and providers who applied for several open days.
  const groupDays = shift.shiftGroupId
    ? await prisma.shift.findMany({
        where: { shiftGroupId: shift.shiftGroupId },
        orderBy: { startsAt: "asc" },
        select: { id: true, startsAt: true, endsAt: true, status: true, assignments: { where: { status: { in: ["CONFIRMED", "IN_PROGRESS", "COMPLETED"] } }, select: { provider: { select: { displayName: true } } } } },
      })
    : [];
  const multiApplicants = shift.shiftGroupId
    ? Object.values(
        (await prisma.application.findMany({ where: { status: "ACTIVE", shift: { shiftGroupId: shift.shiftGroupId } }, select: { providerId: true, provider: { select: { displayName: true } } } })).reduce<Record<string, { providerId: string; name: string; days: number }>>((m, x) => {
          (m[x.providerId] ??= { providerId: x.providerId, name: x.provider.displayName, days: 0 }).days++;
          return m;
        }, {}),
      ).filter((x) => x.days > 1)
    : [];
  const heldAtRate = shift.rateMode === "CLINIC" && !shift.releasedAt;
  const rateTerms = shift.rateTerms as { text?: string; acceptedByName?: string; acceptedAt?: string } | null;
  const pendingChange = await prisma.shiftChange.findFirst({ where: { shiftId: id, status: "PENDING" } });
  const lastAnswer = pendingChange ? null : await prisma.shiftChange.findFirst({ where: { shiftId: id, status: { in: ["ACCEPTED", "DECLINED", "EXPIRED"] }, respondedAt: { gt: new Date(Date.now() - 3 * 86_400_000) } }, orderBy: { respondedAt: "desc" } });
  const changeable = shiftChanges.canChange(shift) && !pendingChange;
  const dayNo = groupDays.findIndex((d) => d.id === shift.id) + 1;
  return (
    <>
      <PageHeader
        eyebrow={groupDays.length > 1 && dayNo ? `${shift.professionCode} · ${shift.location.name} · Day ${dayNo} of ${groupDays.length}` : `${shift.professionCode} · ${shift.location.name}`}
        title={dateLabel(shift.startsAt, tz, { weekday: "long", month: "long", day: "numeric" })}
        description={`${timeRange(shift.startsAt, shift.endsAt, tz)}${shift.minYearsExperience ? ` · ${shift.minYearsExperience}+ years' experience` : ""}`}
        actions={
          <div className="flex items-center gap-2">
            {changeable ? <LinkButton href={`/clinic/shifts/${shift.id}/change`} size="sm" variant="outline">Change shift</LinkButton> : null}
            <StatusBadge status={shift.status} />
          </div>
        }
      />
      {sp.changed === "applied" ? <Alert tone="success" className="mb-5" title="Shift updated">Anyone who applied has been told about the change.</Alert> : null}
      {sp.changed === "pending" && pendingChange ? <Alert tone="success" className="mb-5" title="Change sent">We've asked your provider to accept it. We'll let you know as soon as they answer.</Alert> : null}
      {pendingChange ? (
        <Card className="mb-5 border-amber-300 ring-2 ring-amber-100">
          <CardBody className="flex flex-wrap items-center justify-between gap-3 text-sm">
            <div>
              <div className="font-semibold">Waiting for your provider to accept your change</div>
              <div className="text-slate-600">
                New time: {timeRange((pendingChange.after as { shift: { startsAt: string } }).shift.startsAt, (pendingChange.after as { shift: { endsAt: string } }).shift.endsAt, tz)} on {dateLabel((pendingChange.after as { shift: { startsAt: string } }).shift.startsAt, tz)}. They have until {dateLabel(pendingChange.respondBy, tz, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}; until then the shift stays as booked. If they decline or don't answer, we refund your deposit and find someone for the new time.
              </div>
            </div>
            <ActionForm action={withdrawShiftChangeAction} confirm="Withdraw the change? The shift stays as booked.">
              <input type="hidden" name="changeId" value={pendingChange.id} />
              <SubmitButton size="sm" variant="outline">Withdraw change</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      ) : null}
      {shift.rateMode === "CLINIC" && shift.releasedAt && selectable ? <Alert tone="info" className="mb-5" title="Released to market">This shift was posted at your own rate and released to the market price on {dateLabel(shift.releasedAt, tz, { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. We&apos;re filling it the usual way.</Alert> : null}
      {lastAnswer?.status === "ACCEPTED" ? <Alert tone="success" className="mb-5">Your provider accepted your change.</Alert> : null}
      {lastAnswer && lastAnswer.status !== "ACCEPTED" && selectable ? (
        <Alert tone="info" className="mb-5" title={lastAnswer.status === "DECLINED" ? "Your provider couldn't make the change" : "Your provider didn't answer in time"}>
          They've been released and your deposit refunded. We're offering the shift with its new details to other providers now.
        </Alert>
      ) : null}
      {sp.posted ? <Alert tone="success" className="mb-5" title="Shift posted">We're notifying eligible providers now. Applicants will appear below.</Alert> : null}
      {sp.saved ? <Alert tone="info" className="mb-5">Draft saved.</Alert> : null}
      {sp.rebooked ? <Alert tone="success" className="mb-5" title="Booked again">We posted the shift and invited your provider. You&apos;ll hear from us as soon as they accept.</Alert> : null}
      {shift.emergencyAt && selectable ? (
        <Alert tone="warning" className="mb-5" title={shift.rescueOfShiftId ? "Emergency replacement — we're on it" : "We've had a cancellation — we're on it"}>
          No need to worry: we're finding a replacement urgently as we speak, texting every eligible provider nearby. We'll email you the moment your new provider is confirmed.
        </Alert>
      ) : null}
      {replacement ? (
        <Alert tone="info" className="mb-5" title="Your provider didn't show">
          You won't be charged for them. <Link href={`/clinic/shifts/${replacement.id}`} className="font-medium underline">See the replacement shift →</Link>
        </Alert>
      ) : null}
      {activeLive && hoursToStart <= 0.5 ? (
        <Card className="mb-5">
          <CardBody className="flex flex-wrap items-center justify-between gap-3">
            <div className="text-sm">
              <div className="font-semibold">Has {activeLive.provider.displayName} arrived?</div>
              <div className="text-slate-600">Let us know either way — if they haven't shown up, we'll send a replacement right away.</div>
            </div>
            <div className="flex gap-2">
              <ActionForm action={markArrivedAction}><input type="hidden" name="assignmentId" value={activeLive.id} /><SubmitButton size="sm">Provider arrived</SubmitButton></ActionForm>
              {hoursToStart <= 0.25 ? (
                <ActionForm action={reportNoShowAction} confirm={`Report that ${activeLive.provider.displayName} didn't show? We'll send an emergency replacement and you won't be charged for them.`}>
                  <input type="hidden" name="assignmentId" value={activeLive.id} />
                  <SubmitButton size="sm" variant="danger">My provider didn't show</SubmitButton>
                </ActionForm>
              ) : null}
            </div>
          </CardBody>
        </Card>
      ) : null}
      {live?.arrivedAt ? <p className="mb-5 text-sm text-emerald-700">✓ {live.provider.displayName} arrived.</p> : null}
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {groupDays.length > 1 ? (
            <Card>
              <CardHeader title={`Part of a ${groupDays.length}-day booking`} description="Each day is covered on its own, so if a provider can't make one day we find cover for just that day." />
              <CardBody className="divide-y divide-slate-100 p-0 text-sm">
                {groupDays.map((d, i) => (
                  <Link key={d.id} href={`/clinic/shifts/${d.id}`} className={`flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50 ${d.id === shift.id ? "bg-brand-50/50" : ""}`}>
                    <span><span className="text-slate-400">Day {i + 1} · </span>{dateLabel(d.startsAt, tz, { weekday: "short", month: "short", day: "numeric" })} · {timeRange(d.startsAt, d.endsAt, tz)}</span>
                    <span className="flex items-center gap-2">
                      {d.assignments[0] ? <span className="text-slate-600">{d.assignments[0].provider.displayName}</span> : null}
                      <StatusBadge status={d.status} />
                    </span>
                  </Link>
                ))}
              </CardBody>
              {multiApplicants.length ? (
                <CardBody className="space-y-2 border-t border-slate-100">
                  {multiApplicants.map((m) => (
                    <div key={m.providerId} className="flex flex-wrap items-center justify-between gap-2 text-sm">
                      <span><span className="font-medium">{m.name}</span> applied for {m.days} days</span>
                      <ActionForm action={confirmAllDaysAction} confirm={`Confirm ${m.name} for all ${m.days} days they applied for? A deposit is charged for each day.`}>
                        <input type="hidden" name="shiftId" value={shift.id} />
                        <input type="hidden" name="providerId" value={m.providerId} />
                        <SubmitButton size="sm">Confirm for all {m.days} days</SubmitButton>
                      </ActionForm>
                    </div>
                  ))}
                </CardBody>
              ) : null}
            </Card>
          ) : null}
          {track && (track.status === "ACTIVE" || (track.status === "EXHAUSTED" && selectable)) ? (
            <Card className={track.status === "ACTIVE" ? "border-brand-300 ring-2 ring-brand-100" : "border-amber-300"}>
              <CardBody className="space-y-3 py-5">
                {track.status === "ACTIVE" ? <AutoRefresh seconds={8} /> : null}
                <div className="flex items-center gap-3">
                  <span className="relative grid size-10 place-items-center rounded-full bg-brand-600 text-white">
                    <Radar className="size-5" />
                    {track.status === "ACTIVE" ? <span className="absolute inset-0 animate-ping rounded-full bg-accent-400 opacity-40" /> : null}
                  </span>
                  <div className="min-w-0 flex-1">
                    <div className="font-semibold">
                      {track.status === "EXHAUSTED"
                        ? "We haven't found coverage yet"
                        : track.stage === "ON_CALL_CHECK"
                          ? "Checking On Call providers…"
                          : track.stage === "STANDBY"
                            ? "Offering to standby providers first…"
                            : track.wave?.isBroadcast
                              ? "Offer sent to all remaining eligible providers"
                              : `Offer sent to ${track.wave?.size ?? 0} providers (wave ${track.wave?.number ?? 1})`}
                    </div>
                    <div className="text-sm text-slate-500">
                      {track.offersSent} asked · {track.accepted} accepted · {track.declined} declined
                      {track.status === "ACTIVE" && track.wave ? <> · <Countdown to={(track.wave.holdEndsAt ?? track.wave.windowEndsAt).toISOString()} prefix={track.accepted ? "confirming in" : "next step in"} /></> : null}
                    </div>
                  </div>
                </div>
                <p className="text-xs text-slate-500">The best-matched provider who accepts gets the shift — not whoever answers first. You can still pick an applicant or an accepted provider below at any time.</p>
                <div className="flex flex-wrap gap-2">
                  {track.status === "EXHAUSTED" && !shift.boosted ? (
                    <ActionForm action={boostAction} confirm={`Boost the rate by the urgent-boost percentage and search again with a wider radius?`}>
                      <input type="hidden" name="shiftId" value={shift.id} /><SubmitButton size="sm">Boost rate & search again</SubmitButton>
                    </ActionForm>
                  ) : null}
                  {track.status === "ACTIVE" ? (
                    <ActionForm action={cancelDispatchAction} confirm="Stop searching? The shift stays posted for applications.">
                      <input type="hidden" name="shiftId" value={shift.id} /><SubmitButton size="sm" variant="ghost">Stop searching</SubmitButton>
                    </ActionForm>
                  ) : null}
                </div>
              </CardBody>
            </Card>
          ) : heldAtRate && selectable ? (
            <Card className="border-amber-300 ring-2 ring-amber-100">
              <CardBody className="space-y-3 text-sm">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div>
                    <div className="font-semibold">Your rate: {money(shift.clinicPriceCents)} <span className="ml-1 rounded bg-amber-100 px-1.5 py-0.5 text-[11px] font-semibold uppercase tracking-wide text-amber-800">Clinic-set · beta</span></div>
                    <div className="text-slate-600">
                      Not filled automatically: choose from applicants below.{" "}
                      {shift.releaseOnUnfilled && shift.releaseAt
                        ? <>If no one is confirmed by <b>{dateLabel(shift.releaseAt, tz, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}</b>, we release it at the market price{shift.marketClinicPriceCents ? ` (about ${money(shift.marketClinicPriceCents)} today)` : ""}.</>
                        : <>You chose not to release it, so it may go unfilled.</>}
                    </div>
                  </div>
                  <ActionForm action={releaseClinicRateAction} confirm="Release this shift to the market price now? We'll start filling it the usual way.">
                    <input type="hidden" name="shiftId" value={shift.id} />
                    <SubmitButton variant="outline" size="sm">Release to market now</SubmitButton>
                  </ActionForm>
                </div>
                {rateTerms?.text ? (
                  <details className="rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">
                    <summary className="cursor-pointer font-medium text-slate-800">Your clinic-set rate terms{rateTerms.acceptedByName ? `, accepted by ${rateTerms.acceptedByName}` : ""}{rateTerms.acceptedAt ? ` on ${dateLabel(rateTerms.acceptedAt, tz, { month: "short", day: "numeric", year: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}</summary>
                    <div className="mt-2 whitespace-pre-line">{rateTerms.text}</div>
                  </details>
                ) : null}
              </CardBody>
            </Card>
          ) : selectable && shift.status !== "DRAFT" ? (
            <Card>
              <CardBody className="flex flex-wrap items-center justify-between gap-3">
                <div className="text-sm text-slate-600">Need someone fast? We'll check On Call providers, then offer the shift to the best-matched providers in small waves.</div>
                <ActionForm action={findSomeoneNowAction}><input type="hidden" name="shiftId" value={shift.id} /><SubmitButton><Radar className="size-4" />Find someone now</SubmitButton></ActionForm>
              </CardBody>
            </Card>
          ) : null}
          {shift.status === "DRAFT" ? (
            <Card><CardBody>
              <div className="flex flex-wrap items-center gap-2">
                <ActionForm action={postDraftAction}><input type="hidden" name="shiftId" value={shift.id} /><SubmitButton>Post this shift</SubmitButton></ActionForm>
                <LinkButton variant="outline" href={`/clinic/shifts/new?draft=${shift.id}`}>Edit draft</LinkButton>
              </div>
            </CardBody></Card>
          ) : null}
          {sheet ? (
            <Card id="timesheet" className={sheet.status === "SUBMITTED" ? "border-amber-300 ring-2 ring-amber-100" : undefined}>
              <CardHeader title="Timesheet" description={sheet.status === "SUBMITTED" ? "Check the times and sign off. Not right? Tell us and we'll sort it out before pay goes out." : "Punches from your provider's phone, stamped with our server's time."} action={<TimesheetStatus status={sheet.status} />} />
              <CardBody className="space-y-4">
                <TimesheetPanel v={sheet} />
                {sheet.status === "SUBMITTED" ? <SignOffForm approve={clinicApproveAction} report={clinicReportAction} hidden={{ assignmentId: sheet.assignmentId }} defaultName={user.name} /> : null}
              </CardBody>
            </Card>
          ) : null}
          {!["DRAFT", "CANCELLED"].includes(shift.status) ? (
            <a href={`/clinic/help/urgent?shift=${shift.id}`} className="flex items-center justify-between gap-3 rounded-2xl border border-red-200 bg-red-50 px-4 py-3 text-sm text-red-900 hover:border-red-300">
              <span><b>Problem with this shift?</b> Reach our team now. We&apos;ll call, text or email you within minutes.</span>
              <span className="shrink-0 font-semibold">Get help now →</span>
            </a>
          ) : null}
          {visitView && live ? (
            <Card id="visits" className={visitView.canRespond ? "border-amber-300 ring-2 ring-amber-100" : undefined}>
              <CardHeader title="Patient visits" description={visitView.canRespond ? "Check the provider's count. If you don't respond, it stands when the window closes." : "Counts only, never patient details."} />
              <CardBody><ClinicVisitPanel v={visitView} tz={shift.location.timeZone} hidden={{ assignmentId: live.id }} confirm={clinicConfirmVisitsAction} report={clinicReportVisitsAction} /></CardBody>
            </Card>
          ) : null}
          {live ? (
            <Card>
              <CardHeader title="Your provider" action={<StatusBadge status={live.status} />} />
              <CardBody className="space-y-3">
                <div className="flex items-center gap-3">
                  {live.provider.photoUrl ? <img src={`/api/files/${live.provider.photoUrl}`} alt="" className="size-12 rounded-full object-cover" /> : null}
                  <div>
                    <div className="font-semibold">{live.provider.displayName}</div>
                    <div className="text-sm text-slate-500">{live.provider.homeCity}, {live.provider.homeState} · {live.driveMinutes} min drive</div>
                  </div>
                </div>
                <TrustPanel providerId={live.providerId} professionCode={shift.professionCode} state={shift.location.state} tz={tz} />
                <div className="flex flex-wrap gap-2">
                  <ActionForm action={openThreadAction} successMessage={false}>
                    <input type="hidden" name="shiftId" value={shift.id} />
                    <input type="hidden" name="providerId" value={live.providerId} />
                    <SubmitButton size="sm" variant="outline"><MessageSquare className="size-4" />Message</SubmitButton>
                  </ActionForm>
                  {live.status === "COMPLETED" ? (
                    <ActionForm action={favoriteAction}>
                      <input type="hidden" name="providerId" value={live.providerId} />
                      <input type="hidden" name="on" value={fav ? "0" : "1"} />
                      <SubmitButton size="sm" variant="outline"><Heart className={`size-4 ${fav ? "fill-red-500 text-red-500" : ""}`} />{fav ? "Favorited" : "Add to favorites"}</SubmitButton>
                    </ActionForm>
                  ) : null}
                  {live.status === "COMPLETED" && !fav ? (
                    <ActionForm action={blockAction} confirm={`Block ${live.provider.displayName} from your future bookings? Only you will know.`}>
                      <input type="hidden" name="providerId" value={live.providerId} />
                      <SubmitButton size="sm" variant="ghost"><Ban className="size-4" />Block from future bookings</SubmitButton>
                    </ActionForm>
                  ) : null}
                </div>
                {live.status === "COMPLETED" ? (
                  <ActionForm action={bookAgainAction} id="book-again" className="space-y-2 rounded-xl border border-brand-100 bg-brand-50/50 p-3">
                    <input type="hidden" name="assignmentId" value={live.id} />
                    <div className="flex flex-wrap items-end gap-2">
                      <label className="text-xs text-slate-600">Book {live.provider.displayName} again on<Input name="date" type="date" required min={new Date(Date.now() + 86_400_000).toISOString().slice(0, 10)} className="mt-1 w-44" /></label>
                      <SubmitButton size="sm">Book again</SubmitButton>
                    </div>
                    <p className="text-xs text-slate-500">Same location and hours. We post the shift and invite {live.provider.displayName} first.</p>
                  </ActionForm>
                ) : null}
                {live.status === "CONFIRMED" ? (
                  <p className="text-sm text-slate-600">
                    {live.onMyWayAt ? "✓ Your provider is on the way." : live.reconfirmedAt ? "✓ Your provider has reconfirmed they're coming." : live.reconfirmRequestedAt ? "We've asked your provider to reconfirm; you'll hear from us if they don't." : null}
                  </p>
                ) : null}
                {live.payments.some((p) => p.status === "FAILED") ? <Alert tone="error" title="Deposit failed">Update your payment method in Billing to keep this booking.</Alert> : null}
              </CardBody>
            </Card>
          ) : null}
          {live?.status === "COMPLETED" ? (
            <Card>
              <CardHeader title={`Private feedback for ${live.provider.displayName} (optional)`} description="Only they will see this — it doesn't affect their rating, their profile or who we send you. A kind, specific note helps them grow." />
              <CardBody>
                <ActionForm action={privateFeedbackAction} className="space-y-2">
                  <input type="hidden" name="assignmentId" value={live.id} />
                  <Textarea name="body" defaultValue={myFeedback?.body ?? ""} maxLength={2000} placeholder="e.g. Patients loved your adjustments. Next time, a quicker note turnaround at the end of the day would help our front desk." />
                  <PhiNotice />
                  <SubmitButton size="sm" variant="outline">{myFeedback ? "Update feedback" : "Send privately"}</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
          {live?.status === "COMPLETED" ? (
            <Card>
              <CardHeader title="Rate your provider" description="Double-blind: revealed when both sides submit or after 14 days." />
              <CardBody>
                {myRating ? (
                  <p className="text-sm text-slate-600">You rated {myRating.stars}★.{theirs ? ` They rated your clinic ${theirs.stars}★.` : ""}</p>
                ) : (
                  <ActionForm action={ratingAction} className="space-y-3">
                    <input type="hidden" name="assignmentId" value={live.id} />
                    <div className="grid grid-cols-2 gap-3 sm:grid-cols-3">
                      {[["stars", "Overall"], ["punctuality", "Punctuality"], ["professionalism", "Professionalism"], ["clinicalSkill", "Clinical skill"], ["communication", "Communication"], ["patientFeedback", "Patient feedback"]].map(([n, l]) => (
                        <Field key={n} label={l}><Select name={n} defaultValue="5">{[5, 4, 3, 2, 1].map((v) => <option key={v} value={v}>{v}★</option>)}</Select></Field>
                      ))}
                    </div>
                    <Textarea name="comment" placeholder="Comments (optional)" maxLength={1000} />
                    <PhiNotice />
                    <SubmitButton>Submit rating</SubmitButton>
                  </ActionForm>
                )}
              </CardBody>
            </Card>
          ) : null}
          {cands ? (
            <>
              <Card>
                <CardHeader title={`Applicants (${cands.applicants.length})`} description={shift.selectionDeadline ? (+shift.selectionDeadline > Date.now() ? `Choose by ${dateLabel(shift.selectionDeadline, tz, { weekday: "short", month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })} (${relative(shift.selectionDeadline)}). If you don’t, we pick the best applicant for you or start inviting providers.` : "Choose now: we’ll pick the best applicant for you shortly.") : undefined} />
                <CardBody className="space-y-3">
                  {cands.applicants.length ? cands.applicants.map((c) => <CandidateCard key={c.providerId} c={c} shiftId={shift.id} applicant />) : <Empty title="No applicants yet">We've notified matching providers. You can also invite recommended providers below.</Empty>}
                  {cands.recommended.filter((c) => acceptedIds.has(c.providerId)).map((c) => <CandidateCard key={c.providerId} c={{ ...c, acceptedPending: true }} shiftId={shift.id} applicant={false} />)}
                </CardBody>
              </Card>
              <Card>
                <CardHeader title="Recommended" description="Eligible providers who haven't applied. Invite up to 3. If several accept, the best match gets the shift — not whoever answers first." />
                <CardBody className="space-y-3">
                  {cands.recommended.length ? cands.recommended.filter((c) => !acceptedIds.has(c.providerId)).map((c) => <CandidateCard key={c.providerId} c={c} shiftId={shift.id} applicant={false} />) : <p className="text-sm text-slate-500">No other eligible providers right now.</p>}
                  {cands.recommended.length ? (
                    <ActionForm action={inviteAction} id={`invite-${shift.id}`}>
                      <input type="hidden" name="shiftId" value={shift.id} />
                      <p className="mb-2 text-xs text-slate-500">Tick “Invite” on up to 3 providers, then:</p>
                      <SubmitButton variant="secondary">Send invitations</SubmitButton>
                    </ActionForm>
                  ) : null}
                </CardBody>
              </Card>
            </>
          ) : null}
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Price" />
            <CardBody className="space-y-2 text-sm">
              <div className="flex justify-between"><span>Coverage</span><span className="tabular-nums">{money(view.coverageCents)}</span></div>
              {view.discountCents ? <div className="flex justify-between text-emerald-700"><span>Promo {shift.promoCode?.code}</span><span>−{money(view.discountCents)}</span></div> : null}
              <div className="flex justify-between"><span>Mileage</span><span className="tabular-nums">{live ? money(view.mileageCents) : "Set at confirmation"}</span></div>
              {view.lodgingCents ? <div className="flex justify-between"><span>Lodging</span><span>{money(view.lodgingCents)}</span></div> : null}
              <div className="flex justify-between border-t border-slate-100 pt-2 font-semibold"><span>Total</span><span className="tabular-nums">{money(view.totalCents)}</span></div>
              {live?.payments.filter((p) => p.type !== "REFUND").map((p) => <div key={p.id} className="flex justify-between text-xs text-slate-500"><span>{p.type.toLowerCase()}</span><span>{money(p.amountCents, { exact: true })} · {p.status.toLowerCase()}</span></div>)}
            </CardBody>
          </Card>
          {live?.status === "COMPLETED" && Date.now() - +live.endsAt < s["payments.disputeWindowHours"] * 3_600_000 && !live.disputes.length ? (
            <Card>
              <CardHeader title="Report a problem" description="Available for 48 hours after the shift. Holds the provider's payment until resolved." />
              <CardBody>
                <ActionForm action={disputeAction}>
                  <input type="hidden" name="assignmentId" value={live.id} />
                  <Textarea name="reason" required placeholder="What happened?" />
                  <PhiNotice />
                  <SubmitButton variant="outline" className="mt-3 w-full">Open a dispute</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
          {["DRAFT", "OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING", "CONFIRMED"].includes(shift.status) ? (
            <Card>
              <CardHeader title="Cancel shift" />
              <CardBody>
                {live && hoursToStart < s["payments.clinicFreeCancelHours"] ? <Alert tone="warning" className="mb-3">Within {s["payments.clinicFreeCancelHours"]} hours of the start, the deposit is non-refundable and part of it compensates your provider.</Alert> : null}
                <ActionForm action={cancelShiftAction} confirm="Cancel this shift?">
                  <input type="hidden" name="shiftId" value={shift.id} />
                  <Textarea name="reason" placeholder="Reason (optional)" />
                  <SubmitButton variant="danger" className="mt-3 w-full">Cancel shift</SubmitButton>
                </ActionForm>
              </CardBody>
            </Card>
          ) : null}
        </div>
      </div>
    </>
  );
}
