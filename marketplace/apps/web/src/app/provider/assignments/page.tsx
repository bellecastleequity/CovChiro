import { CalendarSync } from "@/components/account/calendar-sync";
import Link from "next/link";
import { CalendarDays } from "lucide-react";
import { prisma } from "@cm/db";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Empty, PageHeader } from "@/components/ui/misc";
import { dateLabel, money, timeRange } from "@/lib/format";
import { requireActor } from "@/lib/session";

export const metadata = { title: "My shifts" };

export default async function MyShifts() {
  const { actor, user } = await requireActor("provider");
  const [assignments, apps] = await Promise.all([
    prisma.assignment.findMany({ where: { providerId: actor.providerId! }, include: { shift: { include: { location: { include: { clinicOrg: true } } } } }, orderBy: { startsAt: "desc" }, take: 100 }),
    prisma.application.findMany({ where: { providerId: actor.providerId!, status: "ACTIVE" }, include: { shift: { include: { location: { include: { clinicOrg: true } } } } }, orderBy: { createdAt: "desc" } }),
  ]);
  const now = new Date();
  const upcoming = assignments.filter((a) => a.endsAt > now && ["CONFIRMED", "IN_PROGRESS"].includes(a.status)).reverse();
  const past = assignments.filter((a) => !upcoming.includes(a));
  const Row = ({ a }: { a: (typeof assignments)[number] }) => (
    <Link href={`/provider/assignments/${a.id}`} className="flex items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
      <div className="min-w-0">
        <div className="text-sm font-medium">{a.shift.location.clinicOrg.displayName}</div>
        <div className="text-xs text-slate-500">{dateLabel(a.startsAt, a.shift.location.timeZone)} · {timeRange(a.startsAt, a.endsAt, a.shift.location.timeZone)} · {a.professionCode}</div>
      </div>
      <div className="flex items-center gap-3">
        <span className="text-sm font-semibold tabular-nums">{money(a.providerTotalCents)}</span>
        <StatusBadge status={a.status} />
      </div>
    </Link>
  );
  return (
    <>
      <PageHeader title="My shifts" />
      <CalendarSync userId={user.id} who="provider" />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Upcoming" />
          {upcoming.length ? <div className="divide-y divide-slate-100">{upcoming.map((a) => <Row key={a.id} a={a} />)}</div> : <div className="p-5"><Empty title="Nothing scheduled" icon={<CalendarDays className="size-6" />} /></div>}
        </Card>
        <Card>
          <CardHeader title="Applications" description="Waiting on the clinic's decision." />
          {apps.length ? (
            <div className="divide-y divide-slate-100">
              {apps.map((a) => (
                <Link key={a.id} href={`/provider/shifts/${a.shiftId}`} className="flex items-center justify-between px-5 py-3 text-sm hover:bg-slate-50">
                  <span>{a.shift.location.clinicOrg.displayName} · {dateLabel(a.shift.startsAt, a.shift.location.timeZone)}</span>
                  <StatusBadge status="PENDING" label="Applied" />
                </Link>
              ))}
            </div>
          ) : <p className="px-5 py-4 text-sm text-slate-500">No open applications.</p>}
        </Card>
        {past.length ? (
          <Card>
            <CardHeader title="Past & cancelled" />
            <div className="divide-y divide-slate-100">{past.map((a) => <Row key={a.id} a={a} />)}</div>
          </Card>
        ) : null}
      </div>
    </>
  );
}
