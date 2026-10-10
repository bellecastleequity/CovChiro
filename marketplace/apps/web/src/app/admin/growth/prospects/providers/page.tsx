import Link from "next/link";
import { prisma } from "@cm/db";
import { growth } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { importProviderProspectsAction, runContactDiscoveryAction, runProspectingAction } from "../../actions";
import { GrowthTabs, usd } from "../../ui";
import { ProspectSwitch } from "../switch";
import { ResearchHealth } from "../../panels";

export const metadata = { title: "Provider prospects" };
export const dynamic = "force-dynamic";

const STATUSES: [string, string][] = [
  ["new", "New prospects"], ["researching", "Researching"], ["practice_found", "Practice found"], ["contact_found", "Contact found"], ["contact_verified", "Contact verified"],
  ["no_contact", "No contact found"], ["ambiguous", "Ambiguous match"], ["needs_review", "Needs review"], ["ready", "Ready for recruitment"], ["contacted", "Contacted"], ["registered", "Registered"], ["suppressed", "Suppressed"],
];
const contactTone = (s: string) => (s === "VERIFIED" ? "green" : s === "FOUND" ? "blue" : s === "INVALID" ? "red" : "gray") as "green" | "blue" | "red" | "gray";

export default async function ProviderProspects({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; state?: string; profession?: string; market?: string; page?: string }> }) {
  const { actor } = await requireActor("admin");
  const f = await searchParams;
  const page = Math.max(0, Number(f.page ?? 0) || 0);
  const [{ rows, total, counts }, professions, markets] = await Promise.all([
    growth.providerProspects(actor, { ...f, skip: page * 100 }),
    prisma.profession.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, displayName: true } }),
    prisma.growthMarket.findMany({ orderBy: { name: "asc" }, select: { key: true, name: true } }),
  ]);
  const failed = await prisma.providerProspect.count({ where: { researchStatus: "FAILED", providerId: null } });
  const qs = (patch: Record<string, string | undefined>) => new URLSearchParams(Object.fromEntries(Object.entries({ ...f, page: undefined, ...patch }).filter(([, v]) => v)) as Record<string, string>).toString();
  return (
    <>
      <PageHeader
        title="Prospecting · providers"
        description="Licensed providers who aren't on the platform yet, found in the public NPI registry in every prelaunch/live market. Contact Discovery looks for a published professional email that reaches the provider themselves (never a group practice's shared inbox or personal free-mail), cites where it found it, and checks the domain takes mail."
        actions={
          <div className="flex gap-2">
            <ActionForm action={runProspectingAction} successMessage><SubmitButton size="sm" variant="outline">Run discovery now</SubmitButton></ActionForm>
            <ActionForm action={runContactDiscoveryAction} successMessage><SubmitButton size="sm">Find contacts now</SubmitButton></ActionForm>
          </div>
        }
      />
      <GrowthTabs current="/admin/growth/prospects" />
      <ProspectSwitch current="providers" />
      <div className="mb-4"><ResearchHealth side="providers" failed={failed} /></div>
      <div className="mb-4 flex flex-wrap gap-2 text-xs">
        <Link href={`?${qs({ status: undefined })}`} className={`rounded-full px-3 py-1 ring-1 ${!f.status ? "bg-brand-600 text-white ring-brand-600" : "ring-slate-200"}`}>All</Link>
        {STATUSES.map(([k, label]) => <Link key={k} href={`?${qs({ status: k })}`} className={`rounded-full px-3 py-1 ring-1 ${f.status === k ? "bg-brand-600 text-white ring-brand-600" : "ring-slate-200"}`}>{label} · {counts[k] ?? 0}</Link>)}
      </div>
      <form className="mb-4 flex flex-wrap gap-2">
        {f.status ? <input type="hidden" name="status" value={f.status} /> : null}
        <Input name="q" defaultValue={f.q} placeholder="Name, NPI, email, city, ZIP" className="w-64" />
        <Select name="profession" defaultValue={f.profession ?? ""} className="w-48"><option value="">All professions</option>{professions.map((p) => <option key={p.code} value={p.code}>{p.displayName}</option>)}</Select>
        <Input name="state" defaultValue={f.state} placeholder="State" maxLength={2} className="w-20" />
        <Select name="market" defaultValue={f.market ?? ""} className="w-56"><option value="">All metros</option>{markets.map((m) => <option key={m.key} value={m.key}>{m.name}</option>)}</Select>
        <button className={buttonClass("outline")}>Filter</button>
      </form>
      <Card>
        <CardHeader title={`${total} provider prospect${total === 1 ? "" : "s"}`} />
        <Table>
          <thead><tr><Th>Provider</Th><Th>Practice</Th><Th>Research</Th><Th>Contact</Th><Th className="text-right">Cost</Th><Th>Last researched</Th><Th>Next action</Th></tr></thead>
          <tbody>
            {rows.length ? rows.map((p) => (
              <tr key={p.id} className="align-top hover:bg-slate-50">
                <Td><Link href={`/admin/growth/prospects/providers/${p.id}`} className="font-medium hover:text-brand-700">{p.displayName}</Link><div className="text-xs text-slate-400">{p.professionCode} · {p.npi ? `NPI ${p.npi}` : "no NPI match"}{p.title ? ` · ${p.title}` : ""} · {[p.city, p.state].filter(Boolean).join(", ")}</div><div className="text-[11px] text-slate-400">Source: {p.source}</div></Td>
                <Td className="text-xs">{humanize(p.practiceRole)} · {p.providersAtPractice} here{p.website ? <div className="max-w-[12rem] truncate text-slate-400">{p.website}</div> : null}</Td>
                <Td><Badge tone={p.researchStatus === "DONE" ? "green" : p.researchStatus === "AMBIGUOUS" ? "amber" : p.researchStatus === "FAILED" ? "red" : "gray"}>{humanize(p.researchStatus)}</Badge>{p.researchConfidence != null ? <div className="text-xs text-slate-400">match {Math.round(p.researchConfidence * 100)}%</div> : null}{p.needsReview ? <div className="text-xs text-amber-700">{p.reviewReason ?? "Needs review"}</div> : null}</Td>
                <Td className="text-xs">{p.email ?? "—"} <Badge tone={contactTone(p.contactStatus)}>{humanize(p.contactStatus)}</Badge>{p.emailOrigin ? <div className="text-slate-400">via {p.emailOrigin}</div> : null}</Td>
                <Td className="text-right text-xs tabular-nums">{p.researchCostMicroUsd ? usd(Math.round(p.researchCostMicroUsd / 10_000)) : "—"}</Td>
                <Td className="text-xs">{p.researchedAt ? dateLabel(p.researchedAt) : "—"}</Td>
                <Td className="text-xs">{growth.providerProspectNextAction(p)}</Td>
              </tr>
            )) : <tr><Td colSpan={7} className="text-slate-500">No provider prospects{f.status ? " in this view" : " yet. They appear as discovery searches prelaunch/live markets (Growth → Expansion)"}.</Td></tr>}
          </tbody>
        </Table>
      </Card>
      {total > (page + 1) * 100 ? <div className="mt-4"><Link href={`?${qs({ page: String(page + 1) })}`} className={buttonClass("outline")}>Next page</Link></div> : null}
      <Card id="import" className="mt-6">
        <CardHeader title="Import providers (CSV)" description="For lists you already have. Header row required. Recognised: npi, first_name, last_name, credential, email, website, address, city, state, zip, practice_role (owner / associate), providers_at_practice. Each row is matched to the NPI registry (by NPI, or by first + last name + state when only one provider of this profession matches); anyone already on the platform is skipped. Emails are kept only when they're the provider's own address or a solo owner's practice mailbox (never a group's shared inbox or Gmail/Yahoo), then checked. Recruitment emails go out only in Prelaunch/Live states (Growth → Expansion) while provider outreach is on." />
        <CardBody>
          <ActionForm action={importProviderProspectsAction} className="grid gap-3 lg:grid-cols-2" resetOnSuccess>
            <div className="space-y-3">
              <Field label="Source label" hint="Where this list came from, e.g. 'State association directory, Oct 2026'."><Input name="source" /></Field>
              <Field label="Profession"><Select name="professionCode" defaultValue="DC">{professions.map((p) => <option key={p.code} value={p.code}>{p.displayName}</option>)}</Select></Field>
              <Field label="CSV file"><Input name="file" type="file" accept=".csv,text/csv" /></Field>
            </div>
            <div className="space-y-3">
              <Field label="…or paste CSV"><Textarea name="csv" className="min-h-32 font-mono text-xs" placeholder={"npi,first_name,last_name,email,state\n1234567893,Ana,Rivera,ana@riverachiro.example,FL"} /></Field>
              <SubmitButton size="sm">Import providers</SubmitButton>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
