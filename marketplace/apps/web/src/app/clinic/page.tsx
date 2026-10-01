import { GroundFloor } from "@/components/referrals/refer-page";
import Link from "next/link";
import { ArrowRight, CalendarDays, PlusCircle, Users } from "lucide-react";
import { prisma } from "@cm/db";
import { clinicProfile, getSettings, timeclock } from "@cm/services";
import { StatusBadge } from "@/components/ui/badge";
import { LinkButton } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, Checklist, Empty, PageHeader, Stat } from "@/components/ui/misc";
import { dateLabel, money, relative, timeRange, firstName } from "@/lib/format";
import { requireActor } from "@/lib/session";

export default async function ClinicHome({ searchParams }: { searchParams: Promise<{ code?: string; welcome?: string }> }) {
  const { actor, user } = await requireActor("clinic");
  const { code, welcome } = await searchParams;
  const rs = await getSettings();
  const sheets = await timeclock.pendingForClinic(actor);
  const { org, checklist } = await clinicProfile(actor);
  const now = new Date();
  const [open, upcoming, spent] = await Promise.all([
    prisma.shift.findMany({
      where: { location: { clinicOrgId: org.id }, status: { in: ["OPEN", "FAVORITES_ONLY", "SELECTING", "CASCADING", "DRAFT"] }, startsAt: { gt: now } },
      include: { location: true, _count: { select: { applications: { where: { status: "ACTIVE" } } } } },
      orderBy: { startsAt: "asc" },
    }),
    prisma.assignment.findMany({ where: { shift: { location: { clinicOrgId: org.id } }, status: { in: ["CONFIRMED", "IN_PROGRESS"] } }, include: { provider: true, shift: { include: { location: true } } }, orderBy: { startsAt: "asc" }, take: 6 }),
    prisma.payment.aggregate({ where: { clinicOrgId: org.id, status: "SUCCEEDED", type: { not: "REFUND" }, createdAt: { gte: new Date(now.getFullYear(), 0, 1) } }, _sum: { amountCents: true } }),
  ]);
  const emailVerified = !!user.emailVerifiedAt;
  const needsSetup = !emailVerified || !checklist.location || !checklist.paymentMethod || !checklist.agreement;
  return (
    <>
      <PageHeader eyebrow={org.displayName} title={`Welcome${org.status === "ONBOARDING" ? "" : " back"}, ${firstName(user.name)}`} actions={<LinkButton href="/clinic/shifts/new"><PlusCircle className="size-4" />Post a shift</LinkButton>} />
      {rs["referrals.enabled"] ? <GroundFloor kind="clinic" referrerRewardCents={rs["referrals.referrerRewardCents"]} friendRewardCents={rs["referrals.refereeRewardCents"]} justJoined={welcome === "1" || Date.now() - +user.createdAt < 14 * 86_400_000} /> : null}
      {sheets.length ? (
        <Alert tone="warning" className="mb-6" title={`${sheets.length} timesheet${sheets.length === 1 ? "" : "s"} to sign off`}>
          Check your provider&apos;s punches and sign off, or tell us if something&apos;s not right. <Link href="/clinic/timesheets" className="font-medium underline">Review timesheets →</Link>
        </Alert>
      ) : null}
      {code ? <Alert tone="success" className="mb-6" title={`Your code ${code} is ready`}>Enter it on the pricing step when you post your first shift.</Alert> : null}
      {needsSetup ? (
        <Card className="mb-6">
          <CardHeader title="Finish setup to post shifts" />
          <CardBody>
            <Checklist
              items={[
                { label: "Confirm your email", done: emailVerified, hint: `We sent a link to ${user.email}. Not there? Check spam, or tap “Resend confirmation email” at the top of the page.` },
                { label: "Add your clinic location", done: checklist.location, href: "/clinic/locations" },
                { label: "Add a payment method (card or bank)", done: checklist.paymentMethod, href: "/clinic/billing" },
                { label: "Sign the Clinic Platform Agreement", done: checklist.agreement, href: "/clinic/settings#agreement" },
              ]}
            />
          </CardBody>
        </Card>
      ) : null}
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Open requests" value={open.filter((s) => s.status !== "DRAFT").length} />
        <Stat label="New applicants" value={open.reduce((x, s) => x + s._count.applications, 0)} tone="brand" />
        <Stat label="Confirmed upcoming" value={upcoming.length} tone="green" />
        <Stat label="Spent this year" value={money(spent._sum.amountCents ?? 0)} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Needs your attention" action={<Link href="/clinic/shifts" className="text-sm font-medium text-brand-700">All shifts</Link>} />
          {open.length ? (
            <div className="divide-y divide-slate-100">
              {open.map((s) => (
                <Link key={s.id} href={`/clinic/shifts/${s.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                  <div>
                    <div className="text-sm font-medium">{dateLabel(s.startsAt, s.location.timeZone)} · {s.professionCode}</div>
                    <div className="text-xs text-slate-500">
                      {s.location.name}
                      {s.selectionDeadline && s.status !== "DRAFT" ? ` · pick by ${relative(s.selectionDeadline)}` : ""}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {s._count.applications ? <span className="flex items-center gap-1 rounded-full bg-brand-50 px-2 py-0.5 text-xs font-medium text-brand-700"><Users className="size-3" />{s._count.applications}</span> : null}
                    <StatusBadge status={s.status} />
                  </div>
                </Link>
              ))}
            </div>
          ) : (
            <CardBody><Empty title="No open requests" icon={<CalendarDays className="size-6" />} action={<LinkButton href="/clinic/shifts/new" size="sm">Post a shift</LinkButton>} /></CardBody>
          )}
        </Card>
        <Card>
          <CardHeader title="Upcoming coverage" />
          {upcoming.length ? (
            <div className="divide-y divide-slate-100">
              {upcoming.map((a) => (
                <Link key={a.id} href={`/clinic/shifts/${a.shiftId}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                  <div>
                    <div className="text-sm font-medium">{a.provider.displayName}</div>
                    <div className="text-xs text-slate-500">{dateLabel(a.startsAt, a.shift.location.timeZone)} · {timeRange(a.startsAt, a.endsAt, a.shift.location.timeZone)} · {a.shift.location.name}</div>
                  </div>
                  <ArrowRight className="size-4 text-slate-400" />
                </Link>
              ))}
            </div>
          ) : (
            <CardBody><p className="text-sm text-slate-500">Confirmed providers will appear here.</p></CardBody>
          )}
        </Card>
      </div>
    </>
  );
}
