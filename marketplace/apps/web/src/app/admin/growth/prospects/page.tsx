import Link from "next/link";
import { growth } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateLabel, dateTimeLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { importProspectsAction, runProspectingAction, saveProspectAction } from "../actions";
import { Stat } from "@/components/ui/misc";
import { ProspectSwitch } from "./switch";
import { ResearchHealth } from "../panels";
import { GrowthTabs, SEGMENTS, STAGES } from "../ui";

export const metadata = { title: "Clinic prospects" };
export const dynamic = "force-dynamic";

const INTENTS = ["COLD", "WARM", "ENGAGED", "HIGH_INTENT", "ACTIVE_CUSTOMER", "REPEAT_CUSTOMER"];
const intentTone = (c: string) => (c === "HIGH_INTENT" ? "red" : c === "ENGAGED" ? "amber" : c.endsWith("CUSTOMER") ? "green" : c === "WARM" ? "blue" : "gray") as "red" | "amber" | "green" | "blue" | "gray";

export default async function Prospects({ searchParams }: { searchParams: Promise<{ q?: string; stage?: string; intent?: string; segment?: string; market?: string; research?: string; page?: string }> }) {
  const { actor } = await requireActor("admin");
  const f = await searchParams;
  const page = Math.max(0, Number(f.page ?? 0) || 0);
  const [{ rows, total }, st] = await Promise.all([
    growth.prospects(actor, { q: f.q, stage: f.stage, intent: f.intent, segment: f.segment, market: f.market, research: f.research, skip: page * 50 }),
    growth.prospecting(actor),
  ]);
  const r = st.research;
  const qs = (p: number) => new URLSearchParams({ ...Object.fromEntries(Object.entries(f).filter(([k, v]) => v && k !== "page")), page: String(p) }).toString();
  return (
    <>
      <PageHeader title="Prospecting · clinics" description="Practices found automatically in every prelaunch/live market: the public NPI registry gives every practice location and its chiropractors; AI web research then finds each practice's website, public business email and size, citing its sources. Public business information only. AI segment guesses are labeled as guesses." />
      <GrowthTabs current="/admin/growth/prospects" />
      <ProspectSwitch current="clinics" />
      <Card className="mb-6">
        <CardHeader
          title="Automatic discovery & web research"
          description={`Runs every 10 minutes (job “growthProspecting”) while the Clinic Prospecting agent is on. It builds the list even while clinic marketing is off. Research: ${st.researchProvider} · ${st.model} · up to the research budget each day.`}
          action={
            <ActionForm action={runProspectingAction} successMessage className="flex gap-2">
              <Input name="cities" placeholder="Cities (optional), e.g. Tampa, Naples" className="w-64" />
              <SubmitButton size="sm">Find clinics now</SubmitButton>
            </ActionForm>
          }
        />
        <CardBody className="space-y-3">
          <ResearchHealth side="clinics" failed={r.FAILED ?? 0} />
          {!st.aiReady ? <p className="text-sm text-amber-700">Web research is waiting for an AI key (OPENAI_API_KEY for the default gpt-6-luna; or set Settings → Growth → research provider). Discovery from the registry still runs.</p> : null}
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-7">
            <Stat label="From the registry" value={st.fromRegistry} hint={`${st.citiesSearched} of ${st.citiesTotal} cities searched`} />
            <Stat label="Waiting for research" value={(r.PENDING ?? 0) + (r.RUNNING ?? 0)} />
            <Stat label="Researched" value={r.DONE ?? 0} tone="green" />
            <Stat label="Not found online" value={r.NOT_FOUND ?? 0} />
            <Stat label="Research failed" value={r.FAILED ?? 0} tone={r.FAILED ? "amber" : "default"} />
            <Stat label="With business email" value={st.withEmail} tone="brand" hint={`${st.withWebsite} with a website`} />
            <Stat label="Research spend today" value={`$${(st.researchSpendTodayCents / 100).toFixed(2)}`} hint={`cap $${(st.researchBudgetCents / 100).toFixed(2)}`} />
          </div>
          <p className="text-xs text-slate-500">
            Last discovery: {st.lastDiscovery ? dateTimeLabel(st.lastDiscovery.at) : "never"} · Last research: {st.lastResearch ? dateTimeLabel(st.lastResearch.at) : "never"} · Cities, per-run limits, budget and model are in Settings → Growth.
          </p>
        </CardBody>
      </Card>
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={f.q} placeholder="Name, owner, email, city, ZIP" className="w-64" />
        <Select name="stage" defaultValue={f.stage ?? ""} className="w-48"><option value="">All stages</option>{STAGES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
        <Select name="intent" defaultValue={f.intent ?? ""} className="w-40"><option value="">All intent</option>{INTENTS.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
        <Select name="segment" defaultValue={f.segment ?? ""} className="w-40"><option value="">All segments</option>{SEGMENTS.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
        <Select name="research" defaultValue={f.research ?? ""} className="w-44"><option value="">Any research</option><option value="with_email">Has business email</option>{["PENDING", "DONE", "NOT_FOUND", "FAILED"].map((s) => <option key={s} value={s}>Research: {humanize(s)}</option>)}</Select>
        <button className={buttonClass("outline")}>Filter</button>
      </form>
      <Card>
        <CardHeader title={`${total} clinic${total === 1 ? "" : "s"}`} />
        <Table>
          <thead><tr><Th>Clinic</Th><Th>Location</Th><Th>Research</Th><Th>Segment</Th><Th>Stage</Th><Th>Intent</Th><Th>Outreach</Th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td><Link href={`/admin/growth/prospects/${p.id}`} className="font-medium text-slate-900 hover:text-brand-700">{p.clinicName}</Link><div className="text-xs text-slate-500">{p.ownerName ?? ""}{p.email ? ` · ${p.email}` : ""}</div></Td>
                <Td className="text-xs">{[p.city, p.zip].filter(Boolean).join(" ") || "—"}<div className="text-slate-400">{p.marketKey ?? "no market"}</div></Td>
                <Td className="text-xs"><StatusBadge status={p.researchStatus} />{p.website ? <div className="max-w-40 truncate text-slate-400">{p.website.replace(/^https?:\/\/(www\.)?/, "")}</div> : null}</Td>
                <Td className="text-xs">{humanize(p.segment)}<div className="text-slate-400">{p.segmentBasis === "AI" ? `AI guess · ${Math.round((p.segmentConfidence ?? 0) * 100)}%` : p.segmentBasis === "NONE" ? "not classified" : humanize(p.segmentBasis)}</div></Td>
                <Td><StatusBadge status={p.stage} /></Td>
                <Td><Badge tone={intentTone(p.intentCategory)}>{humanize(p.intentCategory)} · {p.intentScore}</Badge></Td>
                <Td className="text-xs">{p.doNotContact ? <Badge tone="red">Do not contact</Badge> : p.emailStatus !== "UNKNOWN" && p.emailStatus !== "VALID" ? <Badge tone="red">{humanize(p.emailStatus)}</Badge> : p.outreachPaused ? <Badge>Paused</Badge> : null}<div className="text-slate-400">step {p.outreachStep} · {p.lastContactedAt ? dateLabel(p.lastContactedAt) : "not contacted"}</div></Td>
              </tr>
            ))}
            {!rows.length ? <tr><Td colSpan={7} className="text-slate-500">No clinics match.</Td></tr> : null}
          </tbody>
        </Table>
        <CardBody className="flex gap-2">
          {page > 0 ? <Link className={buttonClass("outline", "sm")} href={`?${qs(page - 1)}`}>Previous</Link> : null}
          {(page + 1) * 50 < total ? <Link className={buttonClass("outline", "sm")} href={`?${qs(page + 1)}`}>Next</Link> : null}
        </CardBody>
      </Card>

      <div className="mt-6 grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Import clinics (CSV, optional)" description="Automatic discovery is the main source; use this for lists you already have. Header row required. Recognised: clinic_name (or name), owner_name, email, phone, website, address, city, county, state, zip, lat, lng, locations, doctors, practice_type, ownership, multidisciplinary, notes. Same email, or same name + ZIP, updates the existing row." />
          <CardBody>
            <ActionForm action={importProspectsAction} className="space-y-3" resetOnSuccess>
              <Field label="Source label" hint="Where this list came from, e.g. 'FL Board public directory, Sept 2026'."><Input name="source" /></Field>
              <Field label="CSV file"><Input name="file" type="file" accept=".csv,text/csv" /></Field>
              <Field label="…or paste CSV"><Textarea name="csv" className="min-h-28 font-mono text-xs" placeholder={"clinic_name,owner_name,email,phone,city,zip\nBayside Chiropractic,Dr. Ana Rivera,info@bayside.example,(813) 555-0100,Tampa,33602"} /></Field>
              <SubmitButton size="sm">Import</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Add a clinic" />
          <CardBody>
            <ActionForm action={saveProspectAction} className="grid gap-2 sm:grid-cols-2">
              <Input name="clinicName" placeholder="Clinic name" required className="sm:col-span-2" />
              <Input name="ownerName" placeholder="Owner / lead doctor" />
              <Input name="email" type="email" placeholder="Public business email" />
              <Input name="phone" placeholder="Business phone" />
              <Input name="website" placeholder="Website" />
              <Input name="city" placeholder="City" />
              <Input name="zip" placeholder="ZIP" />
              <Input name="providerCount" type="number" min={0} placeholder="Chiropractors" />
              <Input name="locationsCount" type="number" min={0} placeholder="Locations" />
              <Input name="source" placeholder="Source" className="sm:col-span-2" />
              <SubmitButton size="sm">Add clinic</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
