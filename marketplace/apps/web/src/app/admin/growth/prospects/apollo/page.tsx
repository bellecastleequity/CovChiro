import Link from "next/link";
import { CA_PROVINCES, US_STATES } from "@cm/core";
import { prisma } from "@cm/db";
import { growth } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { Alert, PageHeader, Stat, Table, Td, Th } from "@/components/ui/misc";
import { dateTimeLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { importApolloAction, resumeApolloAction, searchApolloAction, testApolloAction } from "../../actions";
import { GrowthTabs } from "../../ui";
import { ProspectSwitch } from "../switch";

export const metadata = { title: "Apollo.io prospecting" };
export const dynamic = "force-dynamic";

const TERRITORIES = ["PR", "VI"];

export default async function ApolloProspecting({ searchParams }: { searchParams: Promise<{ search?: string }> }) {
  const { actor } = await requireActor("admin");
  const f = await searchParams;
  const [st, search, professions] = await Promise.all([
    growth.apolloStatus(),
    f.search ? growth.prospectSearch(actor, f.search) : Promise.resolve(null),
    prisma.profession.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" }, select: { code: true, displayName: true } }),
  ]);
  const usable = st.configured && st.enabled;
  const importable = search?.rows.filter((r) => !r.duplicate) ?? [];
  const people = search?.rows.filter((r) => r.person).length ?? 0;
  const s = await growth.importEstimate(1, true);
  return (
    <>
      <PageHeader
        title="Prospecting · Apollo.io"
        description="Apollo is one more source for the same prospect lists: people and clinics found here go into Providers / Clinics with the same stages, campaigns, outreach agents and compliance checks. An Apollo record is a lead, never proof of a license: providers are verified through onboarding before any shift."
      />
      <GrowthTabs current="/admin/growth/prospects" />
      <ProspectSwitch current="apollo" />
      {!st.configured ? (
        <Alert tone="warning" className="mb-6" title="Apollo isn't connected">Add <code>APOLLO_API_KEY</code> (a master API key from Apollo → Settings → Integrations → API) to the server's environment, restart the app, then turn on "Apollo.io: use Apollo as a prospecting source" in <Link href="/admin/settings#s-growth.apollo.enabled" className="underline">Settings</Link>.</Alert>
      ) : !st.enabled ? (
        <Alert tone="info" className="mb-6" title="Apollo is switched off">The key is set. Turn on "Apollo.io: use Apollo as a prospecting source" in <Link href="/admin/settings#s-growth.apollo.enabled" className="underline">Settings</Link> to search here.</Alert>
      ) : null}
      {st.pause ? (
        <Alert tone="warning" className="mb-6" title={`Apollo paused until ${dateTimeLabel(st.pause.until)}`}>
          <p>{humanize(st.pause.reason)}: {st.pause.error}</p>
          <ActionForm action={resumeApolloAction} className="mt-2"><SubmitButton size="sm" variant="outline">Resume now</SubmitButton></ActionForm>
        </Alert>
      ) : null}
      <div className="mb-6 grid gap-4 sm:grid-cols-2 lg:grid-cols-4">
        <Stat label="Credits today (estimated)" value={`${st.used.today} / ${st.caps.daily}`} />
        <Stat label="Credits this month (estimated)" value={`${st.used.month} / ${st.caps.monthly}`} />
        <Stat label="Provider prospects from Apollo" value={st.prospects.providers} />
        <Stat label="Clinic prospects from Apollo" value={st.prospects.clinics} />
      </div>
      <Card className="mb-6">
        <CardHeader title="Connection & automation" description={`Automatic discovery: ${st.autoDiscovery ? "on" : "off"} · email enrichment for agents: ${st.contactEnrichment ? "on" : "off"}. Credits are estimates from your settings; Apollo → Settings → Credits shows the confirmed balance.`} action={<Link href="/admin/settings#s-growth.apollo.enabled" className="text-sm font-medium text-brand-700">Apollo settings →</Link>} />
        <CardBody className="space-y-3 text-sm">
          <ActionForm action={testApolloAction}><SubmitButton size="sm" variant="outline" disabled={!st.configured}>Test the connection</SubmitButton></ActionForm>
          {st.byTask.length ? (
            <Table>
              <thead><tr><Th>This month</Th><Th>Side</Th><Th className="text-right">Calls</Th><Th className="text-right">Records</Th><Th className="text-right">Credits (est.)</Th></tr></thead>
              <tbody>{st.byTask.map((b) => <tr key={`${b.task}-${b.side}`}><Td>{humanize(b.task)}</Td><Td>{b.side === "SUPPLY" ? "Providers" : b.side === "DEMAND" ? "Clinics" : "—"}</Td><Td className="text-right tabular-nums">{b.calls}</Td><Td className="text-right tabular-nums">{b.records}</Td><Td className="text-right tabular-nums">{b.credits}</Td></tr>)}</tbody>
            </Table>
          ) : null}
          {st.recent.some((r) => !r.ok) ? <p className="text-xs text-red-700">Last error: {st.recent.find((r) => !r.ok)?.error}</p> : null}
        </CardBody>
      </Card>
      <Card className="mb-6">
        <CardHeader title="Search Apollo" description="Providers and clinic decision-makers come from Apollo's people search (no credits). Searching clinics as companies uses credits. Results are kept for a day so you can import what you pick without paying again." />
        <CardBody>
          <ActionForm action={searchApolloAction} className="grid gap-3 sm:grid-cols-6">
            <Field label="Looking for" className="sm:col-span-2">
              <Select name="sideTarget" defaultValue={search ? `${search.side}:${search.rows[0]?.kind === "organization" ? "organizations" : "people"}` : "SUPPLY:people"}>
                <option value="SUPPLY:people">Providers (supply)</option>
                <option value="DEMAND:people">Clinic owners and managers (demand)</option>
                <option value="DEMAND:organizations">Clinics as companies (demand, uses credits)</option>
              </Select>
            </Field>
            <Field label="Where">
              <Select name="region" defaultValue={search?.region ?? "FL"}>
                <optgroup label="U.S. states">{Object.entries(US_STATES).filter(([c]) => !TERRITORIES.includes(c)).map(([c, n]) => <option key={c} value={c}>{n}</option>)}</optgroup>
                <optgroup label="U.S. territories">{TERRITORIES.map((c) => <option key={c} value={c}>{US_STATES[c]}</option>)}</optgroup>
                <optgroup label="Canada">{Object.entries(CA_PROVINCES).map(([c, n]) => <option key={c} value={c}>{n}</option>)}</optgroup>
              </Select>
            </Field>
            <Field label="City (optional)"><Input name="city" defaultValue={search?.city ?? ""} placeholder="e.g. Orlando" /></Field>
            <Field label="Profession"><Select name="professionCode" defaultValue={search?.professionCode ?? "DC"}>{professions.map((p) => <option key={p.code} value={p.code}>{p.displayName}</option>)}</Select></Field>
            <Field label="Page"><Input name="page" type="number" min={1} max={500} defaultValue={1} /></Field>
            <div className="sm:col-span-6"><SubmitButton size="sm" disabled={!usable || !!st.pause}>Search</SubmitButton></div>
          </ActionForm>
        </CardBody>
      </Card>
      {f.search && !search ? <Alert tone="info" className="mb-6">That search has expired. Search again.</Alert> : null}
      {search ? (
        <Card>
          <CardHeader
            title={`${search.rows.length} result${search.rows.length === 1 ? "" : "s"} · ${search.side === "SUPPLY" ? "providers" : "clinics"} in ${search.city ? `${search.city}, ` : ""}${search.region}${search.total != null ? ` (Apollo has ${search.total.toLocaleString()} in total)` : ""}`}
            description={people ? "Search results hide surnames and emails. Import as is (free; agents can enrich later within your credit caps), or tick Enrich to reveal names and verified emails now. Emails are still checked by our own rules: a provider's own address or a solo owner's practice mailbox, a clinic's own domain, never suppressed addresses." : "Clinic companies: imported with their website, phone and address; decision-makers can be found later."}
          />
          <ActionForm action={importApolloAction} className="space-y-3">
            <input type="hidden" name="searchId" value={search.id} />
            <Table>
              <thead><tr><Th></Th><Th>{search.side === "SUPPLY" ? "Person" : "Clinic / contact"}</Th><Th>Title</Th><Th>Where</Th><Th>Already here?</Th></tr></thead>
              <tbody>
                {search.rows.map((r) => (
                  <tr key={r.key}>
                    <Td><input type="checkbox" name="key" value={r.key} defaultChecked={!r.duplicate} aria-label="Import this row" className="size-4" /></Td>
                    <Td>{r.person ? <>{r.person.firstName} {r.person.lastName ?? "·····"}{r.person.organizationName ? <div className="text-xs text-slate-500">{r.person.organizationName}</div> : null}</> : <>{r.organization!.name}{r.organization!.website ? <div className="text-xs text-slate-500">{r.organization!.website}</div> : null}</>}</Td>
                    <Td className="text-sm">{r.person?.title ?? "—"}</Td>
                    <Td className="text-sm">{[r.person?.city ?? r.organization?.city, r.person?.region ?? r.organization?.region].filter(Boolean).join(", ") || "—"}</Td>
                    <Td>{r.duplicate ? <Badge tone="amber">{r.duplicate}</Badge> : <span className="text-xs text-slate-400">New</span>}</Td>
                  </tr>
                ))}
              </tbody>
            </Table>
            <div className="space-y-2 px-5 pb-5 text-sm">
              {people ? <Checkbox name="enrich" label={`Enrich the ticked people now: names and verified emails (about ${s} credit${s === 1 ? "" : "s"} each, estimated)`} /> : null}
              {people ? <Checkbox name="approved" label={`I approve a large job (above ${st.caps.largeJob} credits)`} /> : null}
              <p className="text-xs text-slate-500">{importable.length} of {search.rows.length} are new. Re-importing an existing record only fills in what's missing.</p>
              <SubmitButton size="sm">Import ticked rows</SubmitButton>
            </div>
          </ActionForm>
        </Card>
      ) : null}
    </>
  );
}
