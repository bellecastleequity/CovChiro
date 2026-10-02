import { GroundFloor } from "@/components/referrals/refer-page";
import Link from "next/link";
import { greetingName } from "@cm/core";
import { ArrowRight, CalendarDays, Inbox, ShieldCheck, Wallet, Zap } from "lucide-react";
import { prisma } from "@cm/db";
import { earningsFor, getSettings, oncall, prelicensure, providerProfile, shiftRecruit, timeclock, volume } from "@cm/services";
import { markAvailableForRecruitAction } from "@/app/recruit-actions";
import { visitsAction } from "@/app/timeclock-actions";
import { ProviderVisitCard } from "@/components/timeclock/visit-count";
import { ClockCard } from "@/components/timeclock/clock-card";
import { ReadinessCard } from "@/components/provider/readiness-card";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, Checklist, Empty, PageHeader, Stat } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/badge";
import { dateLabel, money, relative, timeRange, firstName } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { CanTake } from "./can-take";
import { onCallToggleAction } from "./actions";

export default async function ProviderHome({ searchParams }: { searchParams: Promise<{ welcome?: string }> }) {
  const { actor, user } = await requireActor("provider");
  const { welcome } = await searchParams;
  const rs = await getSettings();
  const clock = actor.providerId ? await timeclock.currentShiftForClock(actor.providerId) : null;
  const recruited = await shiftRecruit.myClaims(actor).catch(() => []);
  // After punching out, ask for the day's visit count right here (volume-priced shifts).
  const visitView = clock && clock.status !== "OPEN" ? await volume.visitViewForProvider(actor, clock.assignmentId) : null;
  const [{ provider, checklist, canTake }, earnings, upcoming, offers, apps, settings] = await Promise.all([
    providerProfile(actor),
    earningsFor(actor.providerId!),
    prisma.assignment.findMany({ where: { providerId: actor.providerId!, status: { in: ["CONFIRMED", "IN_PROGRESS"] } }, include: { shift: { include: { location: { include: { clinicOrg: true } } } } }, orderBy: { startsAt: "asc" }, take: 5 }),
    prisma.offer.findMany({ where: { providerId: actor.providerId!, status: { in: ["PENDING", "ACCEPTED_PENDING"] }, expiresAt: { gt: new Date() } }, include: { shift: { include: { location: true } } }, orderBy: { expiresAt: "asc" } }),
    prisma.application.count({ where: { providerId: actor.providerId!, status: "ACTIVE" } }),
    getSettings(),
  ]);
  const onCall = settings["features.onCallEnabled"] && provider.status === "ACTIVE" ? await oncall.onCallOverview(actor) : null;
  const c = checklist.common;
  const items = [
    { label: "Confirm your email", done: c.emailVerified, hint: `We sent a link to ${user.email}. Not there? Check spam, or tap “Resend confirmation email” at the top of the page.` },
    { label: "Complete your profile, phone & home base", done: c.profile && c.homeBase, href: "/provider/profile" },
    { label: "Add a profile photo", done: c.photo, href: "/provider/profile" },
    { label: "Add your NPI", done: c.npi, href: "/provider/profile" },
    ...checklist.perProfession.flatMap((p) => [
      { label: `${p.displayName}: verified license`, done: p.license, href: "/provider/credentials", hint: p.licensePending ? "Submitted — verification in progress." : undefined },
      { label: `${p.displayName}: malpractice coverage`, done: p.malpractice, href: "/provider/credentials" },
    ]),
    { label: "Set up payouts (Stripe)", done: c.payouts, href: "/provider/payouts" },
    { label: "Sign the Provider Platform Agreement", done: c.agreement, href: "/provider/profile#agreement" },
  ];
  const remaining = items.filter((i) => !i.done).length;
  // Student path: readiness card instead of the setup checklist; profile-type
  // steps move under "After you're licensed" (credentials are still required).
  const readiness = provider.preLicensure ? await prelicensure.readinessSummary(provider.id) : null;
  const laterSteps = [
    { label: "Complete your profile & home base", done: c.profile && c.homeBase, href: "/provider/profile" },
    { label: "Add a profile photo", done: c.photo, href: "/provider/profile" },
    { label: "Add your NPI", done: c.npi, href: "/provider/profile" },
    { label: "Set up payouts (Stripe)", done: c.payouts, href: "/provider/payouts" },
    { label: "Sign the Provider Platform Agreement", done: c.agreement, href: "/provider/profile#agreement" },
  ];
  return (
    <>
      <PageHeader
        eyebrow={
          <span className="flex items-center gap-2">
            {provider.photoUrl ? <img src={`/api/files/${provider.photoUrl}`} alt="" className="size-8 rounded-full object-cover ring-2 ring-white" /> : null}
            <span>Hi, {greetingName(user.name, provider.professions.map((p) => p.professionCode)) || firstName(user.name)}</span>
          </span>
        } title="Your coverage hub" description={<>You can take: <CanTake canTake={canTake} /></>} actions={<LinkButton href="/provider/shifts">Find shifts <ArrowRight className="size-4" /></LinkButton>} />
      {clock ? <div className="mb-6"><ClockCard v={clock} title="Today's time clock" /></div> : null}
      {visitView?.canSubmit ? <div className="mb-6"><ProviderVisitCard v={visitView} assignmentId={clock!.assignmentId} tz={clock!.timeZone} action={visitsAction} /></div> : null}
      {recruited.length ? (
        <Card id="recruited" className="mb-6 border-accent-300 ring-2 ring-accent-100">
          <CardHeader title={recruited.length === 1 ? "A shift was sent to you" : "Shifts sent to you"} description="Open to other providers too, so finish any steps soon." />
          <CardBody className="space-y-4">
            {recruited.map((r) => (
              <div key={r.claimId} className="rounded-xl border border-slate-200 p-4">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div>
                    <div className="font-semibold text-slate-900">{r.profession} · {dateLabel(r.when, r.timeZone, { weekday: "short", month: "short", day: "numeric" })}</div>
                    <div className="text-sm text-slate-600">{timeRange(r.when, r.endsAt, r.timeZone)} · {r.city}, {r.state} · {money(r.payCents)}</div>
                  </div>
                  {r.state_ === "BOOKED" ? <span className="rounded-full bg-emerald-50 px-2.5 py-1 text-xs font-medium text-emerald-800">Booked</span> : r.state_ === "CLOSED" ? <span className="rounded-full bg-slate-100 px-2.5 py-1 text-xs font-medium text-slate-600">Filled or closed</span> : r.state_ === "INVITED" ? <span className="rounded-full bg-brand-50 px-2.5 py-1 text-xs font-medium text-brand-800">Ready to accept</span> : <span className="rounded-full bg-amber-50 px-2.5 py-1 text-xs font-medium text-amber-900">A few steps left</span>}
                </div>
                {r.state_ === "INVITED" ? (
                  <div className="mt-3"><LinkButton href="/provider/offers" size="sm">{r.offerStatus === "ACCEPTED_PENDING" ? "You accepted: see status" : "Review and accept"}</LinkButton></div>
                ) : r.state_ === "BOOKED" && r.assignmentId ? (
                  <div className="mt-3"><LinkButton href={`/provider/assignments/${r.assignmentId}`} size="sm" variant="outline">Open the shift</LinkButton></div>
                ) : r.state_ === "WAITING" ? (
                  <ul className="mt-3 space-y-2 text-sm">
                    {r.steps.map((st) => (
                      <li key={st.label} className="flex flex-wrap items-center justify-between gap-2">
                        <span className="text-slate-700">• {st.label}</span>
                        {st.href ? <Link href={st.href} className="font-medium text-brand-700 underline">Do it now</Link> : st.label.startsWith("Mark yourself available") ? (
                          <ActionForm action={markAvailableForRecruitAction}><input type="hidden" name="claimId" value={r.claimId} /><SubmitButton size="sm" variant="outline">I&apos;m available</SubmitButton></ActionForm>
                        ) : null}
                      </li>
                    ))}
                    <li className="text-xs text-slate-500">Once everything is verified, the shift appears in Offers for you to accept. We&apos;ll text and email you.</li>
                  </ul>
                ) : null}
              </div>
            ))}
          </CardBody>
        </Card>
      ) : null}
      <Card className="mb-6 border-brand-200 bg-brand-50/40">
        <CardBody className="flex flex-wrap items-center justify-between gap-3">
          <div className="min-w-0 flex-1 basis-64">
            <div className="font-semibold text-slate-900">Provider training</div>
            <p className="text-sm text-slate-600">About 30 minutes. Start with the two that protect your bookings and pay: what to do before and after every shift.</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <LinkButton href="/provider/academy/before-the-shift" size="sm">Before the shift</LinkButton>
            <LinkButton href="/provider/academy/after-the-shift" size="sm" variant="outline">After the shift</LinkButton>
            <LinkButton href="/provider/academy" size="sm" variant="ghost">All lessons</LinkButton>
          </div>
        </CardBody>
      </Card>
      {rs["referrals.enabled"] ? <GroundFloor kind="provider" referrerRewardCents={rs["referrals.referrerRewardCents"]} friendRewardCents={rs["referrals.refereeRewardCents"]} justJoined={welcome === "1" || Date.now() - +user.createdAt < 14 * 86_400_000} /> : null}
      {readiness ? (
        <ReadinessCard
          summary={readiness}
          emailVerified={c.emailVerified}
          contactDone={!!provider.user.phone && !!(provider.homeZip || provider.homeLat !== null)}
          graduationDone={!!provider.graduationDate && !!provider.school}
          laterSteps={laterSteps}
        />
      ) : provider.status !== "ACTIVE" || remaining ? (
        <Card className="mb-6">
          <CardHeader title="Finish setting up" description={`${remaining} step${remaining === 1 ? "" : "s"} left before you can apply to shifts.`} />
          <CardBody>
            <Checklist items={items} />
          </CardBody>
        </Card>
      ) : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Upcoming shifts" value={upcoming.length} />
        <Stat label="Open applications" value={apps} />
        <Stat label="Pending pay" value={money(earnings.summary.upcomingCents + earnings.summary.scheduledCents + earnings.summary.readyCents)} tone="brand" />
        <Stat label="Paid this year" value={money(earnings.summary.paidYtdCents)} tone="green" />
      </div>
      {onCall ? (
        <Card className={`mt-6 ${onCall.onCallNow ? "border-brand-300 ring-2 ring-brand-100" : ""}`}>
          <CardBody className="flex flex-wrap items-center justify-between gap-4">
            <div className="flex items-center gap-3">
              <span className={`grid size-10 place-items-center rounded-xl ${onCall.onCallNow ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-400"}`}><Zap className="size-5" /></span>
              <div>
                <div className="font-semibold">{onCall.onCallNow ? "You're On Call" : "On Call is off"}</div>
                <div className="text-sm text-slate-500">{onCall.rules[0] ? onCall.rules[0].summary : "Get booked instantly for shifts that match your rules."}</div>
              </div>
            </div>
            <div className="flex gap-2">
              {onCall.onCallNow ? (
                <ActionForm action={onCallToggleAction}><input type="hidden" name="mode" value="pause-today" /><SubmitButton variant="outline" size="sm">Pause for today</SubmitButton></ActionForm>
              ) : onCall.rules.length && onCall.eligibility.ok ? (
                <ActionForm action={onCallToggleAction}><input type="hidden" name="mode" value="on" /><SubmitButton size="sm">Go On Call</SubmitButton></ActionForm>
              ) : null}
              <LinkButton href="/provider/oncall" variant="ghost" size="sm">{onCall.rules.length ? "Rules" : "Set up"}</LinkButton>
            </div>
          </CardBody>
        </Card>
      ) : null}
      {offers.length ? (
        <Card className="mt-6">
          <CardHeader title={<span className="flex items-center gap-2"><Inbox className="size-4 text-accent-600" /> Invitations waiting on you</span>} />
          <div className="divide-y divide-slate-100">
            {offers.map((o) => (
              <Link key={o.id} href="/provider/offers" className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                <div>
                  <div className="text-sm font-medium">{dateLabel(o.shift.startsAt, o.shift.location.timeZone)} · {o.shift.location.city}, {o.shift.state}</div>
                  <div className="text-xs text-amber-700">Respond {relative(o.expiresAt)}</div>
                </div>
                <ArrowRight className="size-4 text-slate-400" />
              </Link>
            ))}
          </div>
        </Card>
      ) : null}
      <Card className="mt-6">
        <CardHeader title={<span className="flex items-center gap-2"><CalendarDays className="size-4 text-accent-600" /> Upcoming</span>} action={<Link href="/provider/assignments" className="text-sm font-medium text-brand-700">All shifts</Link>} />
        {upcoming.length ? (
          <div className="divide-y divide-slate-100">
            {upcoming.map((a) => (
              <Link key={a.id} href={`/provider/assignments/${a.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                <div className="min-w-0">
                  <div className="text-sm font-medium">{a.shift.location.clinicOrg.displayName}</div>
                  <div className="text-xs text-slate-500">
                    {dateLabel(a.startsAt, a.shift.location.timeZone)} · {timeRange(a.startsAt, a.endsAt, a.shift.location.timeZone)} · {a.shift.location.city}
                  </div>
                </div>
                <div className="text-right">
                  <div className="text-sm font-semibold tabular-nums">{money(a.providerTotalCents)}</div>
                  <StatusBadge status={a.status} />
                </div>
              </Link>
            ))}
          </div>
        ) : (
          <CardBody>
            <Empty title="No upcoming shifts" icon={<CalendarDays className="size-6" />} action={<LinkButton href="/provider/shifts" size="sm">Browse shifts</LinkButton>}>
              Shifts you're confirmed for will show up here.
            </Empty>
          </CardBody>
        )}
      </Card>
      {!c.payouts ? (
        <Alert tone="warning" className="mt-6" title="Payouts aren't set up yet">
          <Link href="/provider/payouts" className="underline">Connect your bank through Stripe</Link> so you can be paid.
        </Alert>
      ) : null}
      <div className="mt-6 grid gap-3 sm:grid-cols-2">
        <Link href="/provider/credentials" className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 hover:border-brand-300">
          <ShieldCheck className="size-5 text-accent-600" />
          <div className="text-sm"><div className="font-medium">Credentials</div><div className="text-slate-500">Licenses, malpractice, skills</div></div>
        </Link>
        <Link href="/provider/earnings" className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 hover:border-brand-300">
          <Wallet className="size-5 text-accent-600" />
          <div className="text-sm"><div className="font-medium">Earnings</div><div className="text-slate-500">Pay history and upcoming payments</div></div>
        </Link>
      </div>
    </>
  );
}
