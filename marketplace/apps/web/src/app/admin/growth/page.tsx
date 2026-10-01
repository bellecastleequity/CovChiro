import { growth } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, PageHeader, Stat, Table, Td, Th } from "@/components/ui/misc";
import { dateTimeLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { agentAction, pauseAction, runNowAction } from "./actions";
import { FunnelBars, GrowthTabs, pctLabel, usd } from "./ui";

export const metadata = { title: "Growth control center" };
export const dynamic = "force-dynamic";

export default async function GrowthOverview() {
  const { actor } = await requireActor("admin");
  const o = await growth.overview(actor);
  const k = o.kpis;
  const stale = !o.lastTick || Date.now() - +new Date(o.lastTick.at) > 2 * 3_600_000;
  return (
    <>
      <PageHeader
        eyebrow="AI growth, marketing & marketplace activation"
        title="Growth control center"
        description="Software decides who is contacted, when, and whether they're eligible. AI only writes, classifies and summarizes inside those decisions. Everything an agent does is logged."
        actions={
          <ActionForm action={pauseAction} successMessage={false} confirm={o.settings.paused ? undefined : "Pause every automated growth email and text now?"}>
            <input type="hidden" name="paused" value={o.settings.paused ? "false" : "true"} />
            <SubmitButton variant={o.settings.paused ? "primary" : "danger"} size="lg">{o.settings.paused ? "Resume outbound automation" : "PAUSE OUTBOUND AUTOMATION"}</SubmitButton>
          </ActionForm>
        }
      />
      <GrowthTabs current="/admin/growth" badges={{ "/admin/growth/approvals": o.counts.pendingApprovals, "/admin/growth/escalations": o.counts.openEscalations }} />

      <div className="mb-6 space-y-3">
        {o.settings.paused ? <Alert tone="warning" title="Outbound automation is paused">Agents keep classifying and scoring; queued messages wait and nothing automated is sent. Messages you write or approve still go out.</Alert> : null}
        {!o.settings.postalAddress ? <Alert tone="error" title="Marketing email is blocked">Add the postal address required in commercial email (Settings → Growth → postal address). Credential, onboarding and recovery emails are not affected.</Alert> : null}
        {stale ? <Alert tone="warning" title="Growth agents haven't run recently">They run inside the worker / once-a-minute cron (job “growthAgents”, every 15 minutes). Last run: {o.lastTick ? dateTimeLabel(o.lastTick.at) : "never"}.</Alert> : null}
      </div>

      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-6">
        <Stat label="Pending approvals" value={o.counts.pendingApprovals} tone={o.counts.pendingApprovals ? "amber" : "default"} />
        <Stat label="Open escalations" value={o.counts.openEscalations} tone={o.counts.openEscalations ? "red" : "default"} />
        <Stat label="High-intent clinics" value={o.counts.highIntent} tone="brand" />
        <Stat label="Sent today" value={o.counts.sentToday} hint={`${o.counts.blockedToday} blocked by compliance`} />
        <Stat label="AI spend today" value={usd(Math.round(o.aiSpend.todayCents))} hint={`cap ${usd(o.settings.dailyBudgetCents)}`} />
        <Stat label="AI spend this month" value={usd(Math.round(o.aiSpend.monthCents))} hint={`cap ${usd(o.settings.monthlyBudgetCents)}`} />
      </div>

      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Clinic funnel" description="Each step includes everyone who got further." /><CardBody><FunnelBars steps={o.funnels.clinic} /></CardBody></Card>
        <Card><CardHeader title="Provider funnel" description={`Launch profession and state (Settings → Growth).`} /><CardBody><FunnelBars steps={o.funnels.provider} /></CardBody></Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Agents" description="Each agent does one job. Turning on Clinic Outreach is the campaign launch. In review mode its drafts wait in Approvals." />
        <div className="divide-y divide-slate-100">
          {o.agents.map((a) => (
            <ActionForm key={a.key} action={agentAction} successMessage={false} className="flex items-center justify-between gap-4 px-5 py-3" confirm={a.key === "clinicOutreach" && !a.on ? `Launch clinic outreach? Mode: ${o.settings.outreachMode === "auto" ? "AUTO — emails send when compliance passes" : "review — drafts wait for your approval"}.` : undefined}>
              <input type="hidden" name="key" value={a.key} />
              <input type="hidden" name="on" value={a.on ? "false" : "true"} />
              <div>
                <div className="text-sm font-medium">{a.label} {a.on ? <Badge tone="green">On</Badge> : <Badge>Off</Badge>}{a.key === "clinicOutreach" ? <Badge tone="brand" className="ml-1">{o.settings.outreachMode} mode</Badge> : null}</div>
                <div className="text-xs text-slate-500">{a.description}</div>
              </div>
              <SubmitButton size="sm" variant="outline">{a.on ? "Turn off" : "Turn on"}</SubmitButton>
            </ActionForm>
          ))}
        </div>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Supply" />
          <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Registered" value={k.supply.registeredProviders} />
            <Stat label="Coverage-ready" value={k.supply.coverageReadyProviders} tone="green" />
            <Stat label="Active (90 days)" value={k.supply.activeProviders90d} />
            <Stat label="Activation rate" value={pctLabel(k.supply.activationRatePct)} />
            <Stat label="First-shift conversion" value={pctLabel(k.supply.firstShiftConversionPct)} />
            <Stat label="Repeat-provider rate" value={pctLabel(k.supply.repeatProviderRatePct)} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Demand" />
          <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Clinic prospects" value={k.demand.clinicProspects} />
            <Stat label="Registered clinics" value={k.demand.registeredClinics} />
            <Stat label="Requesting clinics" value={k.demand.requestingClinics} />
            <Stat label="First-time (30 days)" value={k.demand.firstTimeClinics30d} />
            <Stat label="Repeat clinics" value={k.demand.repeatClinics} />
            <Stat label="Unposted requests" value={k.marketing.unpostedDrafts} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Marketplace" />
          <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Coverage requests" value={k.marketplace.coverageRequests} />
            <Stat label="Fill rate" value={pctLabel(k.marketplace.fillRatePct)} hint={`${k.marketplace.filledShifts} filled · ${k.marketplace.unfilledShifts} unfilled`} />
            <Stat label="Hours to fill (avg)" value={k.marketplace.avgHoursToFill ?? "—"} />
            <Stat label="Cancellation rate" value={pctLabel(k.marketplace.cancellationRatePct)} />
            <Stat label="Repeat booking rate" value={pctLabel(k.marketplace.repeatBookingRatePct)} />
            <Stat label="Avg booking value" value={usd(k.marketplace.averageBookingValueCents)} />
            <Stat label="Gross volume" value={usd(k.marketplace.grossVolumeCents)} />
            <Stat label="Platform take" value={usd(k.marketplace.platformTakeCents)} />
            <Stat label="Provider pay" value={usd(k.marketplace.providerPayoutCents)} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Marketing" description="CAC = campaign spend you've entered ÷ conversions." />
          <CardBody className="grid grid-cols-2 gap-3 sm:grid-cols-3">
            <Stat label="Clinic CAC" value={usd(k.marketing.clinicCacCents)} />
            <Stat label="Provider CAC" value={usd(k.marketing.providerCacCents)} hint="per coverage-ready provider" />
            <Stat label="AI spend (30 days)" value={usd(k.marketing.aiSpend30dCents)} />
          </CardBody>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="AI usage this month" description="Cheap models for classification, larger ones for writing; every call is logged with tokens and cost." />
          <Table>
            <thead><tr><Th>Agent</Th><Th>Task</Th><Th>Model</Th><Th className="text-right">Calls</Th><Th className="text-right">Tokens in / out</Th><Th className="text-right">Cost</Th></tr></thead>
            <tbody>
              {o.aiSpend.usage.length ? o.aiSpend.usage.map((u) => (
                <tr key={`${u.agent}${u.task}${u.model}`}><Td>{humanize(u.agent)}</Td><Td>{u.task}</Td><Td className="font-mono text-xs">{u.model}</Td><Td className="text-right tabular-nums">{u.calls}</Td><Td className="text-right tabular-nums">{u.inputTokens.toLocaleString()} / {u.outputTokens.toLocaleString()}</Td><Td className="text-right tabular-nums">{usd(Math.round(u.costCents))}</Td></tr>
              )) : <tr><Td colSpan={6} className="text-slate-500">No AI calls this month.</Td></tr>}
            </tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Compliance blocks (7 days)" description="Messages software refused to send, and why." action={<ActionForm action={runNowAction} successMessage><SubmitButton size="sm" variant="outline">Run agents now</SubmitButton></ActionForm>} />
          <Table>
            <thead><tr><Th>Reason</Th><Th className="text-right">Messages</Th></tr></thead>
            <tbody>
              {o.blockReasons.length ? o.blockReasons.map((b) => <tr key={b.reason}><Td>{humanize(b.reason)}</Td><Td className="text-right tabular-nums">{b.n}</Td></tr>) : <tr><Td colSpan={2} className="text-slate-500">Nothing blocked.</Td></tr>}
            </tbody>
          </Table>
          <CardBody className="text-xs text-slate-500">Last agent run: {o.lastTick ? dateTimeLabel(o.lastTick.at) : "never"}</CardBody>
        </Card>
      </div>
    </>
  );
}
