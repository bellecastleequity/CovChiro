import Link from "next/link";
import { hoursLabel } from "@cm/core";
import { timeclock } from "@cm/services";
import { Card } from "@/components/ui/card";
import { Empty, PageHeader } from "@/components/ui/misc";
import { dateLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Timesheets" };
export const dynamic = "force-dynamic";

export default async function Timesheets() {
  const { actor } = await requireActor("clinic");
  const rows = await timeclock.pendingForClinic(actor);
  return (
    <>
      <PageHeader title="Timesheets to sign off" description="Each day your provider punches in, out for lunch, back in and out for the day. Check the times and sign off; anything not right goes to a review before pay is released. Timesheets you don't answer are approved automatically." />
      {rows.length ? (
        <Card>
          <ul className="divide-y divide-slate-100">
            {rows.map((t) => {
              const tz = t.assignment.shift.location.timeZone;
              const time = (d: Date | null) => (d ? d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" }) : "—");
              return (
                <li key={t.id}>
                  <Link href={`/clinic/shifts/${t.assignment.shiftId}#timesheet`} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 hover:bg-slate-50">
                    <span>
                      <span className="font-medium text-slate-900">{t.assignment.provider.displayName}</span>
                      <span className="block text-xs text-slate-500">{t.assignment.shift.location.name} · {dateLabel(t.assignment.startsAt, tz)} · in {time(t.firstIn)}, out {time(t.lastOut)} · worked {hoursLabel(t.workedMinutes)}</span>
                      {t.flags.length ? <span className="block text-xs text-amber-700">{t.flags.join("; ")}</span> : null}
                    </span>
                    <span className="text-sm font-medium text-brand-700">Review &amp; sign off →</span>
                  </Link>
                </li>
              );
            })}
          </ul>
        </Card>
      ) : <Empty title="All caught up.">New timesheets appear here when your provider punches out.</Empty>}
    </>
  );
}
