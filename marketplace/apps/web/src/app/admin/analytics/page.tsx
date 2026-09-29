import { analyticsSummary } from "@cm/services";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { PageHeader, Stat, Table, Td, Th } from "@/components/ui/misc";
import { humanize, money, pct } from "@/lib/format";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Analytics" };

function Bars({ data }: { data: { day: string; views: number; visitors: number }[] }) {
  const max = Math.max(1, ...data.map((d) => d.views));
  return (
    <div className="flex h-40 items-end gap-1" role="img" aria-label="Daily page views">
      {data.map((d) => (
        <div key={d.day} className="group relative flex-1">
          <div className="rounded-t bg-brand-500/80" style={{ height: `${(d.views / max) * 150}px` }} />
          <div className="pointer-events-none absolute bottom-full left-1/2 mb-1 hidden -translate-x-1/2 whitespace-nowrap rounded bg-slate-900 px-2 py-1 text-[10px] text-white group-hover:block">{d.day}: {d.views} views · {d.visitors} visitors</div>
        </div>
      ))}
    </div>
  );
}

function Funnel({ steps }: { steps: [string, number][] }) {
  const top = Math.max(1, steps[0][1]);
  return (
    <div className="space-y-2">
      {steps.map(([label, n], i) => (
        <div key={label}>
          <div className="flex justify-between text-sm"><span>{label}</span><span className="tabular-nums font-medium">{n}{i ? <span className="ml-2 text-xs text-slate-400">{pct(steps[i - 1][1] ? n / steps[i - 1][1] : null)}</span> : null}</span></div>
          <div className="mt-1 h-2 rounded-full bg-slate-100"><div className="h-2 rounded-full bg-brand-500" style={{ width: `${(n / top) * 100}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

export default async function Analytics({ searchParams }: { searchParams: Promise<{ from?: string; to?: string }> }) {
  const { actor } = await requireActor("admin");
  const f = await searchParams;
  const to = f.to ? new Date(`${f.to}T23:59:59`) : new Date();
  const from = f.from ? new Date(`${f.from}T00:00:00`) : new Date(Date.now() - 30 * 86_400_000);
  const a = await analyticsSummary(actor, { from, to });
  const m = a.marketplace;
  return (
    <>
      <PageHeader title="Analytics" description="First-party, cookieless-style tracking (anonymous visitor id, no IPs) plus marketplace performance." />
      <form className="mb-5 flex flex-wrap items-end gap-2">
        <Input type="date" name="from" defaultValue={from.toISOString().slice(0, 10)} className="w-40" />
        <Input type="date" name="to" defaultValue={to.toISOString().slice(0, 10)} className="w-40" />
        <button className={buttonClass("outline")}>Apply</button>
      </form>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-4">
        <Stat label="Visitors" value={a.traffic.visitors} hint={`${a.traffic.views} page views`} />
        <Stat label="Leads" value={a.leads.total} hint={`${pct(a.leads.conversionRate)} converted`} />
        <Stat label="Revenue" value={money(m.revenueCents)} hint={`margin ${money(m.marginCents)}`} tone="green" />
        <Stat label="Fill rate" value={pct(m.fillRate)} hint={`${m.filled}/${m.posted} · ${m.unfilled} unfilled`} />
      </div>
      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2"><CardHeader title="Traffic" /><CardBody>{a.traffic.daily.length ? <Bars data={a.traffic.daily} /> : <p className="text-sm text-slate-500">No page views in this range.</p>}</CardBody></Card>
        <Card><CardHeader title="Funnel" /><CardBody><Funnel steps={[["Visitors", a.funnel.visitors], ["Leads", a.funnel.leads], ["Sign-ups", a.funnel.signups], ["Shifts posted", a.funnel.shiftsPosted], ["Shifts filled", a.funnel.shiftsFilled]]} /></CardBody></Card>
        <Card><CardHeader title="Top pages" /><CardBody className="space-y-1 text-sm">{a.traffic.topPages.map((p) => <div key={p.path} className="flex justify-between"><span className="truncate">{p.path}</span><span className="tabular-nums">{p.views}</span></div>)}</CardBody></Card>
        <Card><CardHeader title="Referrers" /><CardBody className="space-y-1 text-sm">{a.traffic.referrers.map((r) => <div key={r.host} className="flex justify-between"><span>{r.host}</span><span>{r.views}</span></div>)}{!a.traffic.referrers.length ? <p className="text-slate-500">None</p> : null}</CardBody></Card>
        <Card><CardHeader title="Campaigns (UTM)" /><CardBody className="space-y-1 text-sm">{a.traffic.utm.map((u) => <div key={`${u.source}-${u.campaign}`} className="flex justify-between"><span>{u.source}{u.campaign ? ` / ${u.campaign}` : ""}</span><span>{u.events}</span></div>)}{!a.traffic.utm.length ? <p className="text-slate-500">None</p> : null}</CardBody></Card>
        <Card className="lg:col-span-2">
          <CardHeader title="By profession & state" />
          <Table>
            <thead><tr><Th>Profession</Th><Th className="text-right">Shifts</Th><Th className="text-right">Revenue</Th><Th className="text-right">Margin</Th></tr></thead>
            <tbody>{m.byProfession.map((p) => <tr key={p.professionCode}><Td>{p.professionCode}</Td><Td className="text-right">{p.shifts}</Td><Td className="text-right">{money(p.revenueCents)}</Td><Td className="text-right">{money(p.marginCents)}</Td></tr>)}</tbody>
          </Table>
          <Table>
            <thead><tr><Th>State</Th><Th className="text-right">Shifts</Th><Th className="text-right">Revenue</Th><Th className="text-right">Margin</Th></tr></thead>
            <tbody>{m.byState.map((p) => <tr key={p.state}><Td>{p.state}</Td><Td className="text-right">{p.shifts}</Td><Td className="text-right">{money(p.revenueCents)}</Td><Td className="text-right">{money(p.marginCents)}</Td></tr>)}</tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Leads" />
          <CardBody className="space-y-1 text-sm">
            {Object.entries(a.leads.bySource).map(([k, v]) => <div key={k} className="flex justify-between"><span>{k}</span><span>{v}</span></div>)}
            <hr className="my-2 border-slate-100" />
            {Object.entries(a.leads.byStatus).map(([k, v]) => <div key={k} className="flex justify-between"><span>{humanize(k)}</span><span>{v}</span></div>)}
          </CardBody>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader title="Smart Dispatch" description="Match quality = filled provider's match score ÷ best eligible match when the dispatch started." />
          <CardBody className="space-y-4 text-sm">
            <div className="grid grid-cols-2 gap-3 sm:grid-cols-5">
              {([
                ["Dispatches", `${a.dispatch.filled}/${a.dispatch.started} filled`],
                ["Exhausted", String(a.dispatch.exhausted)],
                ["Median match quality", pct(a.dispatch.medianMatchQuality)],
                ["Offers per fill", a.dispatch.offersPerFill?.toFixed(1) ?? "—"],
                ["On Call providers", `${a.dispatch.onCallProviders} · ${pct(a.dispatch.onCallFillShare)} of fills`],
              ] as const).map(([l, v]) => <div key={l}><div className="text-xs text-slate-500">{l}</div><div className="text-lg font-semibold">{v}</div></div>)}
            </div>
            <div className="grid gap-6 sm:grid-cols-2">
              <Table>
                <thead><tr><Th>Tier</Th><Th className="text-right">Filled</Th><Th className="text-right">Median time to fill</Th></tr></thead>
                <tbody>{a.dispatch.byTier.map((t) => <tr key={t.tier}><Td>{humanize(t.tier)}</Td><Td className="text-right">{t.filled}/{t.started}</Td><Td className="text-right">{t.medianMinutesToFill == null ? "—" : `${Math.round(t.medianMinutesToFill)} min`}</Td></tr>)}</tbody>
              </Table>
              <Table>
                <thead><tr><Th>Filled via</Th><Th className="text-right">Count</Th><Th className="text-right">Share</Th></tr></thead>
                <tbody>
                  {a.dispatch.byPath.map((p) => <tr key={p.path}><Td>{humanize(p.path)}</Td><Td className="text-right">{p.count}</Td><Td className="text-right">{pct(p.share)}</Td></tr>)}
                  {!a.dispatch.byPath.length ? <tr><Td className="text-slate-500">No fills yet</Td><Td /><Td /></tr> : null}
                </tbody>
              </Table>
            </div>
          </CardBody>
        </Card>
        <Card className="lg:col-span-3">
          <CardHeader title="Money" />
          <CardBody className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-5">
            {[["Clinic revenue", m.revenueCents], ["Provider pay", m.providerPayCents], ["Margin", m.marginCents], ["Promo discounts", m.discountsCents], ["Pass-through travel", m.passThroughCents]].map(([l, v]) => <div key={l as string}><div className="text-xs text-slate-500">{l}</div><div className="text-lg font-semibold">{money(v as number)}</div></div>)}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
