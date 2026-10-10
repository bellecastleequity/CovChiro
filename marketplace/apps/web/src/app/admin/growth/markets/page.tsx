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
import { saveMarketAction, setMarketPriorityAction } from "../actions";
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

const SIDE = { SUPPLY: "Providers first", DEMAND: "Clinics first" } as const;
const SOURCE: Record<string, string> = { market: "set for this market", recommendation: "following the recommendation", state: "state / province setting", country: "country setting", default: "default" };
const JURISDICTIONS = [["", "All regions"], ["US_STATE", "U.S. states"], ["US_TERRITORY", "Puerto Rico & USVI"], ["CANADA", "Canada"]] as const;

export default async function Markets({ searchParams }: { searchParams: Promise<{ j?: string; state?: string; profession?: string; source?: string; all?: string }> }) {
  const { actor } = await requireActor("admin");
  const f = await searchParams;
  const jurisdiction = (["US_STATE", "US_TERRITORY", "CANADA"].includes(f.j ?? "") ? f.j : "") as "" | "US_STATE" | "US_TERRITORY" | "CANADA";
  const [rows, professions, demand, geo] = await Promise.all([
    growth.marketSupply(), prisma.profession.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, displayName: true } }), supply.demandSummary(90),
    growth.geographyReport(actor, { jurisdiction, state: f.state || undefined, profession: f.profession || undefined, source: f.source || undefined }),
  ]);
  const regionRows = geo.rows.filter((r) => f.all === "1" || f.state || r.active);
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
            <Th>Demand</Th><Th className="text-right">Fill 30d</Th><Th>Works first<InfoTip label="About acquisition priority">Which side of the marketplace this market recruits first. Both sides always keep running; the first side gets the larger share of searches, credits and outreach (Growth settings). Florida defaults to clinics first, everywhere else to providers first. The recommendation comes from real numbers (unfilled shifts, open requests, ready providers, booking clinics).</InfoTip></Th><Th>Supply<InfoTip label="About supply status">CRITICAL / LOW / BUILDING / HEALTHY / LIQUID: coverage-ready providers in the radius against the market's target, made worse by shifts that went unfilled or upcoming demand far above supply.</InfoTip></Th><Th>Readiness</Th><Th className="text-right">Prospects</Th>
          </tr></thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.market.id} className="hover:bg-slate-50">
                <Td><Link href={`/admin/growth/markets/${r.market.key}`} className="font-medium hover:text-brand-700">{r.market.name}</Link><div className="text-xs text-slate-400">{r.market.professionCode} · {r.market.state} · {r.market.radiusMiles} mi · target {r.market.targetProviders}{r.market.active ? "" : " · paused"}</div></Td>
                <Td className="text-right font-semibold tabular-nums">{r.ready}</Td>
                {([25, 50, 75, 100] as const).map((d) => <Td key={d} className="text-right tabular-nums text-slate-600">{r.within[d]}</Td>)}
                <Td>{r.demand}<div className="text-xs text-slate-400">{r.upcomingRequests} upcoming · {r.clinics} clinics</div></Td>
                <Td className="text-right text-xs tabular-nums">{r.filled30 + r.unfilled30 ? `${r.filled30}/${r.filled30 + r.unfilled30}` : "—"}</Td>
                <Td className="min-w-52">
                  <ActionForm action={setMarketPriorityAction} successMessage={false} className="flex items-center gap-1">
                    <input type="hidden" name="key" value={r.market.key} />
                    <Select name="side" defaultValue={r.market.acquisitionPriority ?? ""} aria-label="Works first" className="h-8 py-0 text-xs">
                      <option value="">Auto: {SIDE[r.acquisition.primary]}</option>
                      <option value="SUPPLY">{SIDE.SUPPLY}</option>
                      <option value="DEMAND">{SIDE.DEMAND}</option>
                    </Select>
                    <SubmitButton size="sm" variant="ghost">Save</SubmitButton>
                  </ActionForm>
                  <div className="mt-1 text-[11px] text-slate-400">{SOURCE[r.acquisition.source]}</div>
                  {r.recommendation.kind === "IMBALANCE" ? <div className={r.recommendation.differsFromPriority ? "mt-1 text-[11px] text-amber-700" : "mt-1 text-[11px] text-slate-500"}>Recommends {SIDE[r.recommendation.side].toLowerCase()}: {r.recommendation.reason}</div> : null}
                </Td>
                <Td><Badge tone={supplyTone(r.supply)}>{r.supply}</Badge></Td>
                <Td><Badge tone={supplyTone(r.readiness)}>{humanize(r.readiness)}</Badge></Td>
                <Td className="text-right text-xs tabular-nums">{r.prospects.providers} providers<div className="text-slate-400">{r.prospects.contactable} contactable · {r.prospects.clinics} clinics</div></Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card className="mt-6" id="regions">
        <CardHeader
          title="By region: supply and demand"
          description="Every U.S. state, Puerto Rico, the USVI and each Canadian province. Prospects are kept apart from accounts: registered providers vs providers with a verified license (and active), posted shifts vs clinics who couldn't post. Canada is prospecting and waitlist only."
        />
        <CardBody className="space-y-4">
          <form className="flex flex-wrap items-end gap-2" action="#regions">
            <Field label="Region"><Select name="j" defaultValue={jurisdiction}>{JURISDICTIONS.map(([v, l]) => <option key={v} value={v}>{l}</option>)}</Select></Field>
            <Field label="State / province"><Input name="state" defaultValue={f.state ?? ""} maxLength={2} className="w-20" placeholder="Any" /></Field>
            <Field label="Profession"><Select name="profession" defaultValue={f.profession ?? ""}><option value="">All</option>{professions.map((p) => <option key={p.code} value={p.code}>{p.displayName}</option>)}</Select></Field>
            <Field label="Prospect source"><Select name="source" defaultValue={f.source ?? ""}><option value="">All</option>{[...new Set([...geo.sources.providers, ...geo.sources.clinics].map((x) => x.source))].map((x) => <option key={x} value={x}>{x}</option>)}</Select></Field>
            <div className="pb-2"><Checkbox name="all" value="1" label="Show regions with no activity" defaultChecked={f.all === "1"} /></div>
            <button className="mb-0.5 h-10 rounded-xl bg-brand-600 px-4 text-sm font-medium text-white">Show</button>
          </form>
          <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            {geo.totals.map((t) => (
              <div key={t.jurisdiction} className="rounded-xl border border-slate-200 p-3 text-xs">
                <div className="mb-1 text-sm font-semibold">{t.jurisdiction === "ALL" ? "All regions" : JURISDICTIONS.find(([v]) => v === t.jurisdiction)?.[1]}</div>
                <div>Supply: {t.providerProspects} prospects · {t.providers} registered · {t.verified} verified & active</div>
                <div>Demand: {t.clinicProspects} prospects · {t.clinics} clinics · {t.activeClinics} active · {t.openShifts} open shifts · {t.unfilled30} unfilled (30d)</div>
              </div>
            ))}
          </div>
          <div className="text-xs text-slate-500">
            Sources: providers {geo.sources.providers.map((x) => `${x.source} ${x.n}`).join(" · ") || "none yet"}; clinics {geo.sources.clinics.map((x) => `${x.source} ${x.n}`).join(" · ") || "none yet"}.
            {geo.apolloCreditsMonth.length ? ` Apollo credits this month (estimated): ${geo.apolloCreditsMonth.map((x) => `${x.side === "SUPPLY" ? "providers" : x.side === "DEMAND" ? "clinics" : "other"} ${x.credits}`).join(", ")}.` : ""}
          </div>
        </CardBody>
        <Table>
          <thead><tr>
            <Th>Region</Th><Th>Growth target</Th><Th>Works first</Th>
            <Th className="text-right">Provider prospects</Th><Th className="text-right">Contacted</Th><Th className="text-right">Registered</Th><Th className="text-right">Verified & active</Th>
            <Th className="text-right">Clinic prospects</Th><Th className="text-right">Contacted</Th><Th className="text-right">Clinics</Th><Th className="text-right">Active (90d)</Th><Th className="text-right">Open shifts</Th><Th className="text-right">Unfilled 30d</Th><Th className="text-right">Couldn&apos;t post</Th><Th>Needs</Th>
          </tr></thead>
          <tbody>
            {regionRows.length ? regionRows.map((r) => (
              <tr key={r.region} className="hover:bg-slate-50">
                <Td><span className="font-medium">{r.name}</span><div className="text-xs text-slate-400">{r.region}{r.conversion.providers != null || r.conversion.clinics != null ? ` · conversion ${r.conversion.providers ?? "—"}% providers / ${r.conversion.clinics ?? "—"}% clinics` : ""}</div></Td>
                <Td className="text-xs">{humanize(r.target)}</Td>
                <Td className="text-xs">{SIDE[r.priority.primary]}<div className="text-slate-400">{SOURCE[r.priority.source]}</div></Td>
                <Td className="text-right tabular-nums">{r.supply.prospects}</Td><Td className="text-right tabular-nums">{r.supply.contacted}</Td><Td className="text-right tabular-nums">{r.supply.providers}</Td><Td className="text-right font-semibold tabular-nums">{r.supply.verified}</Td>
                <Td className="text-right tabular-nums">{r.demand.prospects}</Td><Td className="text-right tabular-nums">{r.demand.contacted}</Td><Td className="text-right tabular-nums">{r.demand.clinics}</Td><Td className="text-right font-semibold tabular-nums">{r.demand.activeClinics}</Td>
                <Td className="text-right tabular-nums">{r.demand.openShifts}</Td><Td className="text-right tabular-nums">{r.demand.unfilled30}</Td><Td className="text-right tabular-nums">{r.demand.couldntPost}</Td>
                <Td>{r.needs === "PROVIDERS" ? <Badge tone="amber">More providers</Badge> : r.needs === "CLINICS" ? <Badge tone="blue">More clinics</Badge> : <span className="text-xs text-slate-400">—</span>}</Td>
              </tr>
            )) : <tr><Td colSpan={15} className="text-slate-500">No activity in these regions yet. Tick &quot;Show regions with no activity&quot; to see all of them.</Td></tr>}
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
