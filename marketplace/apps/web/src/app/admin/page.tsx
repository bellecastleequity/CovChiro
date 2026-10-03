import Link from "next/link";
import { admin, analyticsSummary, clinicRate, getSettings } from "@cm/services";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader, Stat } from "@/components/ui/misc";
import { dateLabel, money, pct, relative } from "@/lib/format";
import { requireActor } from "@/lib/session";

export default async function AdminHome() {
  const { actor } = await requireActor("admin");
  const now = new Date();
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const [d, a] = await Promise.all([admin.adminDashboard(actor), analyticsSummary(actor, { from: monthStart, to: now })]);
  const m = a.marketplace;
  const [rs, cr] = await Promise.all([getSettings(), clinicRate.clinicRateStats(actor, 90)]);
  return (
    <>
      <PageHeader title="Dashboard" description={`Month to date · ${now.toLocaleDateString("en-US", { month: "long", year: "numeric" })}`} />
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Revenue" value={money(m.revenueCents)} hint={`${m.filled} shifts filled`} />
        <Stat label="Margin" value={money(m.marginCents)} tone="green" hint={`after ${money(m.discountsCents)} promo discounts`} />
        <Stat label="Fill rate" value={pct(m.fillRate)} hint={m.medianHoursToFill !== null ? `median ${m.medianHoursToFill.toFixed(1)}h to fill` : undefined} />
        <Stat label="Provider pay owed" value={money(m.pendingPayoutsCents)} tone="brand" hint="not yet paid" />
        <Stat label="Pending verifications" value={d.pendingVerifications} tone={d.pendingVerifications ? "amber" : "default"} />
        <Stat label="Open tasks" value={d.tasks} tone={d.tasks ? "amber" : "default"} />
        <Stat label="Open disputes" value={d.disputes} tone={d.disputes ? "red" : "default"} />
        <Stat label="Active providers / clinics" value={`${m.activeProviders} / ${m.activeClinics}`} />
      </div>
      {rs["clinicRate.enabled"] || cr.posted ? (
        <Card className="mt-6">
          <CardHeader
            title="Clinic-set rate (beta), last 90 days"
            description={`${rs["clinicRate.enabled"] ? "On" : "Off"} · floor ${rs["clinicRate.minPercent"]}% · release ${rs["clinicRate.releaseHours"]}h before start. Change in Settings → Clinic-set rate (beta).`}
            action={<Link href="/admin/settings" className="text-sm font-medium text-brand-700">Settings</Link>}
          />
          <CardBody className="grid grid-cols-2 gap-3 lg:grid-cols-4">
            <Stat label="Posted at clinic rate" value={cr.posted} hint={`${cr.choseRelease} chose release`} />
            <Stat label="Filled at clinic rate" value={cr.filledAtClinicRate} tone="green" hint={`margin ${money(cr.marginAtClinicRateCents)}`} />
            <Stat label="Released, then filled" value={cr.releasedThenFilled} hint={`${cr.released} released`} />
            <Stat label="Unfilled / still open" value={`${cr.unfilled} / ${cr.open}`} tone={cr.unfilled ? "amber" : "default"} hint={cr.avgClinicRatePercent ? `avg price ${cr.avgClinicRatePercent}% of market` : undefined} />
          </CardBody>
        </Card>
      ) : null}
      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Unfilled in the next 72 hours" />
          <div className="divide-y divide-slate-100">
            {d.urgentUnfilled.length ? d.urgentUnfilled.map((s) => (
              <Link key={s.id} href={`/admin/shifts/${s.id}`} className="flex items-center justify-between gap-3 px-5 py-3 text-sm hover:bg-slate-50">
                <div><div className="font-medium">{s.location.clinicOrg.displayName} · {s.professionCode}</div><div className="text-xs text-slate-500">{dateLabel(s.startsAt, s.location.timeZone)} ({relative(s.startsAt)}) · {s._count.applications} applicants</div></div>
                <StatusBadge status={s.status} />
              </Link>
            )) : <p className="px-5 py-4 text-sm text-slate-500">Nothing urgent. 🎉</p>}
          </div>
        </Card>
        <Card>
          <CardHeader title="Open shifts by state & profession" />
          <CardBody>
            {d.openByState.length ? (
              <div className="grid grid-cols-2 gap-2 sm:grid-cols-3">
                {d.openByState.map((o) => <div key={`${o.state}-${o.professionCode}`} className="rounded-xl bg-slate-50 p-3 text-sm"><div className="font-semibold">{o.state} · {o.professionCode}</div><div className="text-slate-500">{o._count} open</div></div>)}
              </div>
            ) : <p className="text-sm text-slate-500">No open shifts.</p>}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
