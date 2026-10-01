import Link from "next/link";
import { growth } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { PageHeader, Stat, Table, Td, Th } from "@/components/ui/misc";
import { dateLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { costAction } from "../actions";
import { FunnelBars, GrowthTabs, usd } from "../ui";

export const metadata = { title: "Growth analytics" };
export const dynamic = "force-dynamic";

const COST_LABEL: Record<string, string> = {
  SEARCH_API: "Search APIs", BUSINESS_DATA: "Business data", EMAIL_ENRICHMENT: "Email enrichment", EMAIL_VERIFICATION: "Email verification", EMAIL_DELIVERY: "Email delivery",
  SMS: "SMS", ADVERTISING: "Advertising", AI_OTHER: "AI (outside this app)", REFERRAL_INCENTIVES: "Referral incentives", OTHER: "Other",
};

function Money({ rows }: { rows: { key: string; cents: number }[] }) {
  return (
    <Table>
      <tbody>
        {rows.length ? rows.map((r) => <tr key={r.key}><Td>{r.key}</Td><Td className="text-right tabular-nums">{usd(Math.round(r.cents))}</Td></tr>) : <tr><Td className="text-slate-500">Nothing this month.</Td></tr>}
      </tbody>
    </Table>
  );
}

export default async function GrowthAnalytics() {
  await requireActor("admin");
  const [funnel, clinic, attr, econ, ai] = await Promise.all([growth.providerFunnel(), growth.clinicFunnel(), growth.attributionDetail(), growth.economics(), growth.aiCosts()]);
  const e = econ;
  const month = new Date().toISOString().slice(0, 7);
  return (
    <>
      <PageHeader title="Analytics" description="Marketing activity tied to marketplace outcomes. The primary measure is completed shifts and the platform revenue they produce, not opens or clicks." />
      <GrowthTabs current="/admin/growth/analytics" />

      <div className="grid gap-6 lg:grid-cols-2">
        <Card><CardHeader title="Provider: prospect → repeat" /><CardBody><FunnelBars steps={funnel.steps} /></CardBody></Card>
        <Card><CardHeader title="Clinic: prospect → repeat booking" /><CardBody><FunnelBars steps={clinic} /></CardBody></Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Growth economics" description="All-time. Total = AI (logged per call) + data and acquisition costs entered below + campaign spend. Provider-side and clinic-side costs are split by the audience you choose when entering them; AI is split evenly." />
        <CardBody className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-6">
          <Stat label="Total acquisition cost" value={usd(e.totals.totalCents)} hint={`AI ${usd(e.totals.aiCents)} · data ${usd(e.totals.enteredCents)} · campaigns ${usd(e.totals.campaignSpendCents)}`} />
          <Stat label="Cost / prospect" value={usd(e.per.prospect)} hint={`${e.outcomes.prospects} prospects`} />
          <Stat label="Cost / contactable" value={usd(e.per.contactable)} hint={`${e.outcomes.contactable} contactable`} />
          <Stat label="Cost / registration" value={usd(e.per.registration)} hint={`${e.outcomes.registrations} acquired registrations`} />
          <Stat label="Cost / coverage-ready provider" value={usd(e.per.coverageReady)} hint={`${e.outcomes.coverageReady} acquired`} />
          <Stat label="Cost / first-shift provider" value={usd(e.per.firstShiftProvider)} hint={`${e.outcomes.firstShift} acquired`} />
          <Stat label="Cost / active clinic" value={usd(e.per.activeClinic)} hint={`${e.outcomes.activeClinics} with a completed shift`} />
          <Stat label="Cost / first coverage request" value={usd(e.per.firstRequest)} hint={`${e.outcomes.firstRequests} clinics have posted`} />
          <Stat label="Customer acquisition cost" value={usd(e.per.cac)} hint="per coverage-ready provider or active clinic" />
          <Stat label="Completed shifts" value={e.outcomes.completedShifts} tone="green" />
          <Stat label="Platform revenue (completed)" value={usd(e.outcomes.platformRevenueCents)} tone="green" />
        </CardBody>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Providers by source" description="Through to completed shifts (transactions) and the platform revenue from them." />
          <Table>
            <thead><tr><Th>Source</Th><Th className="text-right">Registered</Th><Th className="text-right">Ready</Th><Th className="text-right">1st shift</Th><Th className="text-right">Shifts</Th><Th className="text-right">Revenue</Th></tr></thead>
            <tbody>{attr.providerBySource.map((r) => <tr key={r.key}><Td>{humanize(r.key)}</Td><Td className="text-right tabular-nums">{r.registered}</Td><Td className="text-right tabular-nums">{r.coverageReady}</Td><Td className="text-right tabular-nums">{r.firstShift}</Td><Td className="text-right font-semibold tabular-nums">{r.completedShifts}</Td><Td className="text-right tabular-nums">{usd(r.revenueCents)}</Td></tr>)}</tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Clinics by source" />
          <Table>
            <thead><tr><Th>Source</Th><Th className="text-right">Accounts</Th><Th className="text-right">Requesting</Th><Th className="text-right">Completed</Th><Th className="text-right">Repeat</Th><Th className="text-right">Revenue</Th></tr></thead>
            <tbody>{attr.clinicBySource.map((r) => <tr key={r.key}><Td>{humanize(r.key)}</Td><Td className="text-right tabular-nums">{r.accounts}</Td><Td className="text-right tabular-nums">{r.requesting}</Td><Td className="text-right font-semibold tabular-nums">{r.completedShifts}</Td><Td className="text-right tabular-nums">{r.repeat}</Td><Td className="text-right tabular-nums">{usd(r.revenueCents)}</Td></tr>)}</tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Providers by campaign" />
          <Table>
            <thead><tr><Th>Campaign</Th><Th className="text-right">Registered</Th><Th className="text-right">Ready</Th><Th className="text-right">1st shift</Th><Th className="text-right">Shifts</Th></tr></thead>
            <tbody>{attr.providerByCampaign.length ? attr.providerByCampaign.map((r) => <tr key={r.key}><Td className="font-mono text-xs">{r.key}</Td><Td className="text-right tabular-nums">{r.registered}</Td><Td className="text-right tabular-nums">{r.coverageReady}</Td><Td className="text-right tabular-nums">{r.firstShift}</Td><Td className="text-right tabular-nums">{r.completedShifts}</Td></tr>) : <tr><Td colSpan={5} className="text-slate-500">No campaign registrations yet.</Td></tr>}</tbody>
          </Table>
        </Card>
        <Card>
          <CardHeader title="Recruited provider journeys" description="Source → first touch → registration → coverage-ready → first shift." />
          <Table>
            <thead><tr><Th>Provider</Th><Th>First touch</Th><Th>Registered</Th><Th>Ready</Th><Th>1st shift</Th></tr></thead>
            <tbody>
              {attr.journeys.length ? attr.journeys.map((j) => (
                <tr key={j.id}><Td><Link href={`/admin/providers/${j.providerId}`} className="hover:text-brand-700">{j.name}</Link><div className="text-xs text-slate-400">{j.source}{j.campaign ? ` · ${j.campaign}` : ""}</div></Td>
                  <Td className="text-xs">{j.firstTouch ? humanize(j.firstTouch) : "—"}{j.firstTouchAt ? <div className="text-slate-400">{dateLabel(j.firstTouchAt)}</div> : null}</Td>
                  <Td className="text-xs">{j.registeredAt ? dateLabel(j.registeredAt) : "—"}</Td><Td className="text-xs">{j.coverageReadyAt ? dateLabel(j.coverageReadyAt) : "—"}</Td><Td className="text-xs">{j.firstShiftAt ? dateLabel(j.firstShiftAt) : "—"}</Td></tr>
              )) : <tr><Td colSpan={5} className="text-slate-500">No recruited providers have registered yet.</Td></tr>}
            </tbody>
          </Table>
        </Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-3">
        <Card>
          <CardHeader title="AI costs — this month" description={`${ai.calls} calls · total ${usd(Math.round(ai.total))}`} />
          <Money rows={ai.byCategory} />
        </Card>
        <Card><CardHeader title="AI by agent" /><Money rows={ai.byAgent.map((r) => ({ ...r, key: humanize(r.key) }))} /></Card>
        <Card><CardHeader title="AI by provider · model" /><Money rows={[...ai.byProvider.map((r) => ({ ...r, key: `${r.key} (provider)` })), ...ai.byModel]} /></Card>
      </div>

      <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_2fr]">
        <Card>
          <CardHeader title="Add a data / acquisition cost" description="Kept separate from AI so token cost isn't confused with total acquisition cost." />
          <CardBody>
            <ActionForm action={costAction} className="space-y-3" resetOnSuccess>
              <input type="hidden" name="op" value="add" />
              <div className="grid grid-cols-2 gap-2">
                <Field label="Month"><Input name="month" type="month" defaultValue={month} required /></Field>
                <Field label="Amount ($)"><Input name="amount" inputMode="decimal" required /></Field>
              </div>
              <Field label="Category"><Select name="category">{Object.entries(COST_LABEL).map(([k, v]) => <option key={k} value={k}>{v}</option>)}</Select></Field>
              <Field label="For"><Select name="audience"><option value="BOTH">Both sides</option><option value="PROVIDER">Provider acquisition</option><option value="CLINIC">Clinic acquisition</option></Select></Field>
              <Field label="Campaign code (optional)"><Input name="campaignCode" /></Field>
              <Field label="Notes"><Input name="notes" /></Field>
              <SubmitButton size="sm">Add cost</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Data acquisition costs" />
          <Table>
            <thead><tr><Th>Month</Th><Th>Category</Th><Th>For</Th><Th>Campaign</Th><Th className="text-right">Amount</Th><Th /></tr></thead>
            <tbody>
              {e.costs.length ? e.costs.map((c) => (
                <tr key={c.id}><Td className="text-xs">{c.month.toISOString().slice(0, 7)}</Td><Td>{COST_LABEL[c.category] ?? c.category}{c.notes ? <div className="text-xs text-slate-400">{c.notes}</div> : null}</Td><Td className="text-xs">{humanize(c.audience)}</Td><Td className="font-mono text-xs">{c.campaignCode ?? "—"}</Td><Td className="text-right tabular-nums">{usd(c.amountCents)}</Td>
                  <Td><ActionForm action={costAction} successMessage={false} confirm="Delete this cost?"><input type="hidden" name="op" value="delete" /><input type="hidden" name="id" value={c.id} /><button className="text-xs text-slate-400 hover:text-red-600">Delete</button></ActionForm></Td></tr>
              )) : <tr><Td colSpan={6} className="text-slate-500">No costs entered. Email delivery, SMS, advertising and the like go here.</Td></tr>}
            </tbody>
          </Table>
        </Card>
      </div>
    </>
  );
}
