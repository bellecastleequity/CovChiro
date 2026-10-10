import Link from "next/link";
import { prisma } from "@cm/db";
import { growth, supply } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { InfoTip } from "@/components/ui/info-tip";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { saveMarketAction } from "../actions";
import { GrowthTabs, supplyTone } from "../ui";

export const metadata = { title: "Supply & demand" };
export const dynamic = "force-dynamic";

const GAP_LABEL: Record<string, string> = {
  NONE_NEARBY: "No providers nearby yet",
  BOOKED: "All booked",
  UNAVAILABLE: "Not available then",
  REQUIREMENTS: "Shift requirements",
  TOO_FEW: "Not enough providers",
};

export default async function Markets() {
  await requireActor("admin");
  const [rows, professions, demand] = await Promise.all([growth.marketSupply(), prisma.profession.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, displayName: true } }), supply.demandSummary(90)]);
  const gaps = rows.filter((r) => r.market.active && (r.supply === "CRITICAL" || r.supply === "LOW"));
  return (
    <>
      <PageHeader
        title="Supply & demand"
        description="Coverage-ready providers against each metro's demand. Supply status and readiness are recomputed hourly by the Supply Gap agent; recruitment works the neediest markets first. New markets are added automatically when a profession × state goes into prelaunch (Growth → Expansion)."
      />
      <GrowthTabs current="/admin/growth/markets" />
      {demand.length ? (
        <Card className="mb-6" id="turned-away">
          <CardHeader title="Clinics who couldn't post: no provider available (90 days)" description="Every refused posting is logged here: where clinics want providers before we have them. Recruit providers licensed in these states near these cities (Growth → Expansion). Clinics only see that no providers are currently available; their shift posts automatically (or they are texted and emailed) once one can take it." />
          <Table>
            <thead><tr><Th>Where</Th><Th>Profession</Th><Th>Clinics</Th><Th>Attempts</Th><Th>Posted later</Th><Th>Main reason</Th><Th>Last</Th></tr></thead>
            <tbody>
              {demand.slice(0, 50).map((d) => (
                <tr key={`${d.professionCode}-${d.state}-${d.city}`}>
                  <Td>{d.city}, {d.state}</Td>
                  <Td>{d.professionCode}</Td>
                  <Td className="tabular-nums">{d.clinics}</Td>
                  <Td className="tabular-nums">{d.attempts}</Td>
                  <Td className="tabular-nums">{d.posted}</Td>
                  <Td>{GAP_LABEL[d.topGap] ?? d.topGap}</Td>
                  <Td>{d.lastAt.toLocaleDateString("en-US", { timeZone: "America/New_York", month: "short", day: "numeric" })}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ) : null}
      {gaps.length ? (
        <div className="mb-6 grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {gaps.map((r) => (
            <Card key={r.market.id}>
              <CardHeader title={<>Supply gap · {r.market.name}</>} action={<Badge tone={supplyTone(r.supply)}>{r.priority}</Badge>} />
              <CardBody className="space-y-1 text-sm">
                <div className="flex justify-between"><span>Upcoming requests (30 days)</span><span className="tabular-nums">{r.upcomingRequests}</span></div>
                <div className="flex justify-between"><span>Coverage-ready nearby</span><span className="tabular-nums">{r.ready} / {r.market.targetProviders}</span></div>
                <div className="flex justify-between"><span>Provider prospects</span><span className="tabular-nums">{r.prospects.providers}</span></div>
                <div className="flex justify-between"><span>Contactable</span><span className="tabular-nums">{r.prospects.contactable}</span></div>
                <p className="pt-2 text-xs text-slate-600">Recommended: increase provider recruitment here{r.prospects.contactable ? "" : " (no verified contacts yet: contact discovery is working through the list)"}.</p>
                <Link href={`/admin/growth/markets/${r.market.key}`} className="text-sm font-medium text-brand-700">Inspect prospects →</Link>
              </CardBody>
            </Card>
          ))}
        </div>
      ) : null}
      <Card className="overflow-x-auto">
        <Table>
          <thead><tr>
            <Th>Market</Th><Th className="text-right">Ready</Th><Th className="text-right">≤25</Th><Th className="text-right">≤50</Th><Th className="text-right">≤75</Th><Th className="text-right">≤100</Th>
            <Th>Demand</Th><Th className="text-right">Fill 30d</Th><Th>Supply<InfoTip label="About supply status">CRITICAL / LOW / BUILDING / HEALTHY / LIQUID: coverage-ready providers in the radius against the market's target, made worse by shifts that went unfilled or upcoming demand far above supply.</InfoTip></Th><Th>Readiness</Th><Th className="text-right">Prospects</Th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.market.id} className="hover:bg-slate-50">
                <Td><Link href={`/admin/growth/markets/${r.market.key}`} className="font-medium hover:text-brand-700">{r.market.name}</Link><div className="text-xs text-slate-400">{r.market.professionCode} · {r.market.state} · {r.market.radiusMiles} mi · target {r.market.targetProviders}{r.market.active ? "" : " · paused"}</div></Td>
                <Td className="text-right font-semibold tabular-nums">{r.ready}</Td>
                {([25, 50, 75, 100] as const).map((d) => <Td key={d} className="text-right tabular-nums text-slate-600">{r.within[d]}</Td>)}
                <Td>{r.demand}<div className="text-xs text-slate-400">{r.upcomingRequests} upcoming · {r.clinics} clinics</div></Td>
                <Td className="text-right text-xs tabular-nums">{r.filled30 + r.unfilled30 ? `${r.filled30}/${r.filled30 + r.unfilled30}` : "—"}</Td>
                <Td><Badge tone={supplyTone(r.supply)}>{r.supply}</Badge></Td>
                <Td><Badge tone={supplyTone(r.readiness)}>{humanize(r.readiness)}</Badge></Td>
                <Td className="text-right text-xs tabular-nums">{r.prospects.providers} providers<div className="text-slate-400">{r.prospects.contactable} contactable · {r.prospects.clinics} clinics</div></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Add or edit a market" description="Same key updates an existing market." />
        <CardBody>
          <ActionForm action={saveMarketAction} className="grid gap-3 sm:grid-cols-4">
            <Field label="Key"><Input name="key" required placeholder="tampa" /></Field>
            <Field label="Name" className="sm:col-span-2"><Input name="name" required placeholder="Tampa Bay" /></Field>
            <Field label="Profession"><Select name="professionCode" defaultValue="DC">{professions.map((p) => <option key={p.code} value={p.code}>{p.displayName}</option>)}</Select></Field>
            <Field label="State"><Input name="state" defaultValue="FL" maxLength={2} /></Field>
            <Field label="Center latitude"><Input name="centerLat" required inputMode="decimal" /></Field>
            <Field label="Center longitude"><Input name="centerLng" required inputMode="decimal" /></Field>
            <Field label="Radius (miles)"><Input name="radiusMiles" type="number" defaultValue={60} /></Field>
            <Field label="Target coverage-ready providers"><Input name="targetProviders" type="number" defaultValue={5} /></Field>
            <Field label="Priority (lower first)"><Input name="priority" type="number" defaultValue={100} /></Field>
            <div className="flex items-end"><Checkbox name="active" label="Active (unticked = paused)" defaultChecked /></div>
            <div className="flex items-end"><SubmitButton size="sm">Save market</SubmitButton></div>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
