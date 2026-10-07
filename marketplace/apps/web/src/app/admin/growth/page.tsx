import Link from "next/link";
import { growth } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, PageHeader, Stat, Table, Td, Th } from "@/components/ui/misc";
import { dateTimeLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { runNowAction } from "./actions";
import { ActivityFeed, OutboundSwitches, PauseButton } from "./panels";
import { FunnelBars, GrowthTabs, pctLabel, supplyTone, usd } from "./ui";

export const metadata = { title: "Growth command center" };
export const dynamic = "force-dynamic";

function Attention({ href, label, value, tone }: { href: string; label: string; value: React.ReactNode; tone: "red" | "amber" | "blue" | "gray" | "green" | "brand" }) {
  return (
    <Link href={href} className="flex items-center justify-between gap-3 px-5 py-2.5 text-sm hover:bg-slate-50">
      <span>{label}</span>
      <Badge tone={tone}>{value}</Badge>
    </Link>
  );
}

export default async function GrowthOverview() {
  const { actor } = await requireActor("admin");
  const [o, today, attention] = await Promise.all([growth.overview(actor), growth.todayNumbers(), growth.needsAttention()]);
  const k = o.kpis;
  const stale = !o.lastTick || Date.now() - +new Date(o.lastTick.at) > 2 * 3_600_000;
  const anything = attention.markets.length + attention.providerLeads + attention.highIntent + attention.credentials + attention.agentErrors + attention.approvals + attention.review;
  return (
    <>
      <PageHeader
        eyebrow="AI acquisition & marketplace liquidity"
        title="Growth command center"
        description="Provider supply and clinic demand in one place. Agents run on the server on their own schedule; this page controls and observes them. Software decides who is contacted and when; AI only writes, classifies and summarizes. Success is measured in completed shifts."
        actions={<div className="flex flex-wrap gap-2"><Link href="/admin/growth/prospects#add" className={buttonClass("outline", "sm")}>Add a clinic</Link><PauseButton paused={o.settings.paused} /></div>}
      />
      <GrowthTabs current="/admin/growth" badges={{ "/admin/growth/approvals": o.counts.pendingApprovals, "/admin/growth/escalations": o.counts.openEscalations }} />

      <div className="mb-6 space-y-3">
        {o.settings.paused ? <Alert tone="warning" title="Outbound automation is paused">Discovery, research and scoring keep running; queued messages wait and nothing automated is sent. Messages you write or approve still go out.</Alert> : null}
        {!o.settings.postalAddress ? <Alert tone="error" title="Marketing email is blocked">Add the postal address required in commercial email (Settings → Growth → postal address). Credential, onboarding and recovery emails are not affected.</Alert> : null}
        {stale ? <Alert tone="warning" title="Growth agents haven't run recently">They run in the worker / once-a-minute cron (job “growthAgents”, every 15 minutes). Last run: {o.lastTick ? dateTimeLabel(o.lastTick.at) : "never"}.</Alert> : null}
      </div>

      <div className="grid gap-6 lg:grid-cols-3">
        <Card className="lg:col-span-2">
          <CardHeader title="Today" description="Since midnight Eastern." />
          <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-4">
            <Stat label="Provider prospects found" value={today.providerProspects} />
            <Stat label="Clinic prospects found" value={today.clinicProspects} />
            <Stat label="Providers contacted" value={today.providersContacted} />
            <Stat label="Clinics contacted" value={today.clinicsContacted} />
            <Stat label="Provider replies" value={today.providerReplies} />
            <Stat label="Clinic replies" value={today.clinicReplies} />
            <Stat label="Provider registrations" value={today.providerRegs} tone="brand" />
            <Stat label="Clinic registrations" value={today.clinicRegs} tone="brand" />
            <Stat label="Coverage-ready providers" value={`+${today.readyToday}`} tone="green" />
            <Stat label="New coverage requests" value={today.newRequests} />
            <Stat label="First shifts completed" value={today.firstShifts} tone="green" />
            <Stat label="AI spend today" value={usd(Math.round(o.aiSpend.todayCents))} hint={`cap ${usd(o.settings.dailyBudgetCents)}`} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Needs attention" description={anything ? undefined : "Nothing waiting on a person."} />
          <div className="divide-y divide-slate-100">
            {attention.markets.map((m) => <Attention key={m.key} href="/admin/growth/markets" label={`${m.name} provider supply`} value={m.status} tone={supplyTone(m.status)} />)}
            {attention.providerLeads ? <Attention href="/admin/growth/escalations" label={`${attention.providerLeads} provider repl${attention.providerLeads === 1 ? "y" : "ies"}`} value="Need review" tone="amber" /> : null}
            {attention.highIntent ? <Attention href="/admin/growth/sales" label={`${attention.highIntent} clinic lead${attention.highIntent === 1 ? "" : "s"}`} value="High intent" tone="brand" /> : null}
            {attention.approvals ? <Attention href="/admin/growth/approvals" label={`${attention.approvals} draft${attention.approvals === 1 ? "" : "s"}`} value="Need approval" tone="amber" /> : null}
            {attention.credentials ? <Attention href="/admin/verification" label={`${attention.credentials} credential${attention.credentials === 1 ? "" : "s"}`} value="Need review" tone="amber" /> : null}
            {attention.review ? <Attention href="/admin/growth/prospects/providers?status=needs_review" label={`${attention.review} provider prospect${attention.review === 1 ? "" : "s"}`} value="Check match" tone="blue" /> : null}
            {attention.agentErrors ? <Attention href="/admin/growth/activity?errors=1" label={`${attention.agentErrors} agent error${attention.agentErrors === 1 ? "" : "s"} (24h)`} value="Review" tone="red" /> : null}
          </div>
        </Card>
      </div>

      <div className="mt-6"><OutboundSwitches /></div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Provider funnel" description="Discovered in the registry through repeat provider." action={<Link href="/admin/growth/providers" className="text-sm text-brand-700">Filter →</Link>} /><CardBody><FunnelBars steps={(await growth.providerFunnel()).steps} /></CardBody></Card>
        <Card><CardHeader title="Clinic funnel" description="Each step includes everyone who got further." action={<Link href="/admin/growth/clinics" className="text-sm text-brand-700">Details →</Link>} /><CardBody><FunnelBars steps={o.funnels.clinic} /></CardBody></Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <div className="lg:col-span-2"><ActivityFeed title="Growth activity" limit={20} /></div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Marketplace" />
            <CardBody className="grid grid-cols-2 gap-3">
              <Stat label="Coverage-ready" value={k.supply.coverageReadyProviders} tone="green" hint={`of ${k.supply.registeredProviders} registered`} />
              <Stat label="Fill rate" value={pctLabel(k.marketplace.fillRatePct)} hint={`${k.marketplace.filledShifts} filled · ${k.marketplace.unfilledShifts} unfilled`} />
              <Stat label="Requesting clinics" value={k.demand.requestingClinics} hint={`${k.demand.repeatClinics} repeat`} />
              <Stat label="Platform take" value={usd(k.marketplace.platformTakeCents)} />
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Compliance blocks (7 days)" action={<ActionForm action={runNowAction} successMessage><SubmitButton size="sm" variant="outline">Run agents now</SubmitButton></ActionForm>} />
            <Table>
              <tbody>
                {o.blockReasons.length ? o.blockReasons.map((b) => <tr key={b.reason}><Td>{humanize(b.reason)}</Td><Td className="text-right tabular-nums">{b.n}</Td></tr>) : <tr><Td className="text-slate-500">Nothing blocked.</Td></tr>}
              </tbody>
            </Table>
            <CardBody className="text-xs text-slate-500">Last agent run: {o.lastTick ? dateTimeLabel(o.lastTick.at) : "never"}</CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
