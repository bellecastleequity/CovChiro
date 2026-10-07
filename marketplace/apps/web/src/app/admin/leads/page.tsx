import { regionName } from "@cm/core";
import Link from "next/link";
import { Download } from "lucide-react";
import { leads } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { StatusBadge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input, Select } from "@/components/ui/form";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateTimeLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { createLeadAction } from "../actions";

const STATUSES = ["NEW", "NURTURING", "CONTACTED", "CONVERTED", "UNSUBSCRIBED", "EXPIRED", "SUPERSEDED", "LOST"];

export default async function Leads({ searchParams }: { searchParams: Promise<{ q?: string; status?: string; audience?: string; source?: string; spam?: string }> }) {
  const { actor } = await requireActor("admin");
  const f = await searchParams;
  const { rows, counts, spam } = await leads.listLeads(actor, { q: f.q, status: (f.status || undefined) as never, audience: (f.audience || undefined) as never, source: f.source || undefined, spam: f.spam === "1" });
  const qs = new URLSearchParams(Object.entries(f).filter(([, v]) => v) as [string, string][]).toString();
  return (
    <>
      <PageHeader title="Leads" description="Welcome-offer sign-ups, campaign landing pages, profession waitlists and contact inquiries." actions={<a href={`/api/exports/leads?${qs}`} className={buttonClass("outline", "sm")}><Download className="size-4" />Export CSV</a>} />
      <div className="mb-4 flex flex-wrap gap-2">
        {STATUSES.map((s) => (
          <Link key={s} href={`/admin/leads?status=${s}`} className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${f.status === s ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-600 ring-slate-200"}`}>{humanize(s)} · {counts[s] ?? 0}</Link>
        ))}
        <Link href={f.spam === "1" ? "/admin/leads" : "/admin/leads?spam=1"} className={`rounded-full px-3 py-1 text-xs font-medium ring-1 ${f.spam === "1" ? "bg-slate-700 text-white ring-slate-700" : "bg-white text-slate-600 ring-slate-200"}`}>Spam · {spam}</Link>
        {f.status || f.spam ? <Link href="/admin/leads" className="px-2 py-1 text-xs text-slate-500">Clear</Link> : null}
      </div>
      <form className="mb-4 flex flex-wrap gap-2">
        <Input name="q" defaultValue={f.q} placeholder="Name, email, organization" className="w-64" />
        <Select name="audience" defaultValue={f.audience ?? ""} className="w-36"><option value="">All audiences</option><option value="CLINIC">Clinics</option><option value="PROVIDER">Providers</option></Select>
        <Select name="source" defaultValue={f.source ?? ""} className="w-36"><option value="">All sources</option>{["popup", "landing", "waitlist", "contact", "manual"].map((s) => <option key={s}>{s}</option>)}</Select>
        {f.status ? <input type="hidden" name="status" value={f.status} /> : null}
        <button className={buttonClass("outline")}>Filter</button>
      </form>
      <Card>
        <Table>
          <thead><tr><Th>Lead</Th><Th>Source</Th><Th>Code</Th><Th>Emails</Th><Th>Status</Th><Th>Created</Th></tr></thead>
          <tbody>
            {rows.map((l) => (
              <tr key={l.id} className="hover:bg-slate-50">
                <Td><Link href={`/admin/leads/${l.id}`} className="font-medium text-slate-900 hover:text-brand-700">{l.name}</Link><div className="text-xs text-slate-500">{l.email}{l.organization ? ` · ${l.organization}` : ""}</div></Td>
                <Td className="text-xs">{l.source}{l.campaignCode && !l.campaignCode.includes(":") ? ` · ${l.campaignCode}` : ""}{l.professionCode ? ` · ${l.professionCode}` : ""}{l.state ? ` · ${regionName(l.state)}` : ""}<div className="text-slate-400">{l.audience.toLowerCase()}{l.utmSource ? ` · utm ${l.utmSource}` : ""}</div></Td>
                <Td className="font-mono text-xs">{l.promoCode ?? "—"}</Td>
                <Td>{l.dripStep}</Td>
                <Td>{l.spamCategory ? <span className="text-xs text-slate-500">{l.spamCategory === "solicitation" ? "Sales pitch" : "Spam"}<div className="max-w-48 truncate" title={l.spamReasons.join(", ")}>{l.spamReasons.join(", ")}</div></span> : <StatusBadge status={l.status} />}</Td>
                <Td className="text-xs">{dateTimeLabel(l.createdAt)}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Add a lead" description="From a phone call, event or referral." />
        <CardBody>
          <ActionForm action={createLeadAction} className="grid gap-2 sm:grid-cols-3">
            <Input name="name" placeholder="Name" required />
            <Input name="email" type="email" placeholder="Email" required />
            <Select name="audience"><option value="CLINIC">Clinic</option><option value="PROVIDER">Provider</option></Select>
            <Input name="organization" placeholder="Organization" />
            <Input name="phone" placeholder="Phone" />
            <Input name="state" placeholder="State (FL)" maxLength={2} />
            <Input name="note" placeholder="Note" className="sm:col-span-2" />
            <SubmitButton size="sm">Add lead</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
