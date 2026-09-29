import Link from "next/link";
import { ArrowRight, CalendarDays, Inbox, ShieldCheck, Wallet, Zap } from "lucide-react";
import { prisma } from "@cm/db";
import { earningsFor, getSettings, oncall, providerProfile } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, Checklist, Empty, PageHeader, Stat } from "@/components/ui/misc";
import { StatusBadge } from "@/components/ui/badge";
import { dateLabel, money, relative, timeRange } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { CanTake } from "./can-take";
import { onCallToggleAction } from "./actions";

export default async function ProviderHome() {
  const { actor, user } = await requireActor("provider");
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
    { label: "Confirm your email", done: c.emailVerified, hint: "Check your inbox for the confirmation link." },
    { label: "Complete your profile, phone & home base", done: c.profile && c.homeBase, href: "/provider/profile" },
    { label: "Add a profile photo", done: c.photo, href: "/provider/profile" },
    { label: "Add your NPI", done: c.npi, href: "/provider/profile" },
    ...checklist.perProfession.flatMap((p) => [
      { label: `${p.displayName}: verified state license`, done: p.license, href: "/provider/credentials", hint: p.licensePending ? "Submitted — verification in progress." : undefined },
      { label: `${p.displayName}: malpractice coverage`, done: p.malpractice, href: "/provider/credentials" },
    ]),
    { label: "Set up payouts (Stripe)", done: c.payouts, href: "/provider/payouts" },
    { label: "Sign the Provider Platform Agreement", done: c.agreement, href: "/provider/profile#agreement" },
  ];
  const remaining = items.filter((i) => !i.done).length;
  return (
    <>
      <PageHeader eyebrow={`Hi, ${user.name.split(" ")[0]}`} title="Your coverage hub" description={<>You can take: <CanTake canTake={canTake} /></>} actions={<LinkButton href="/provider/shifts">Find shifts <ArrowRight className="size-4" /></LinkButton>} />
      {provider.status !== "ACTIVE" || remaining ? (
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
          <CardHeader title={<span className="flex items-center gap-2"><Inbox className="size-4 text-brand-600" /> Invitations waiting on you</span>} />
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
        <CardHeader title={<span className="flex items-center gap-2"><CalendarDays className="size-4 text-brand-600" /> Upcoming</span>} action={<Link href="/provider/assignments" className="text-sm font-medium text-brand-700">All shifts</Link>} />
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
          <ShieldCheck className="size-5 text-brand-600" />
          <div className="text-sm"><div className="font-medium">Credentials</div><div className="text-slate-500">Licenses, malpractice, skills</div></div>
        </Link>
        <Link href="/provider/earnings" className="flex items-center gap-3 rounded-2xl border border-slate-200 bg-white p-4 hover:border-brand-300">
          <Wallet className="size-5 text-brand-600" />
          <div className="text-sm"><div className="font-medium">Earnings</div><div className="text-slate-500">Pay history and upcoming payments</div></div>
        </Link>
      </div>
    </>
  );
}
