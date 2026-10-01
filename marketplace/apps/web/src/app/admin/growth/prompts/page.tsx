import Link from "next/link";
import { prisma } from "@cm/db";
import { growth } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { savePromptAction } from "../actions";
import { GrowthTabs } from "../ui";

export const metadata = { title: "Prompts" };
export const dynamic = "force-dynamic";

export default async function Prompts() {
  const { actor } = await requireActor("admin");
  const rows = await growth.prompts(actor);
  const professions = await prisma.profession.findMany({ orderBy: { sortOrder: "asc" } });
  return (
    <>
      <PageHeader title="Prompts" description="Every agent message starts from an approved, active version here. Editing creates a new draft version; approve it, then activate it either alone or alongside the current version as an A/B test (split by weight). Code checks AI personalization: it must keep the same links, add no new links, phone numbers, dollar amounts or guarantee language, and stay a sensible length. Otherwise the approved text is sent word for word." />
      <GrowthTabs current="/admin/growth/prompts" />
      <Card>
        <Table>
          <thead><tr><Th>Prompt</Th><Th>Agent</Th><Th>Status</Th><Th className="text-right">Weight</Th><Th>Outcomes</Th><Th>Approved</Th></tr></thead>
          <tbody>
            {rows.map((p) => (
              <tr key={p.id} className="hover:bg-slate-50">
                <Td><Link href={`/admin/growth/prompts/${p.id}`} className="font-mono text-sm font-medium hover:text-brand-700">{p.key} v{p.version}</Link> <Badge tone={p.professionCode ? "blue" : "gray"}>{p.professionCode ?? "Any profession"}</Badge><div className="text-xs text-slate-500">{p.purpose}</div></Td>
                <Td className="text-xs">{humanize(p.agent)}</Td>
                <Td><div className="flex flex-wrap gap-1"><Badge tone={p.status === "APPROVED" ? "green" : p.status === "DRAFT" ? "amber" : "gray"}>{humanize(p.status)}</Badge>{p.active ? <Badge tone="brand">Active</Badge> : null}{p.instructions ? <Badge>AI</Badge> : null}</div></Td>
                <Td className="text-right tabular-nums">{p.abWeight}</Td>
                <Td className="text-xs tabular-nums">{p.performance ? `${p.performance.sent} sent · ${p.performance.engaged + p.performance.coverageReady} engaged/ready · ${p.performance.booked + p.performance.firstShift} booked/1st shift` : "—"}</Td>
                <Td className="text-xs">{p.approvedAt ? dateLabel(p.approvedAt) : "—"}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
      <Card className="mt-6">
        <CardHeader title="New prompt key" description="Saved as a draft. Use {{variable}} placeholders; only the allowed variables are ever filled in." />
        <CardBody>
          <ActionForm action={savePromptAction} className="grid gap-3 sm:grid-cols-2">
            <Field label="Key"><Input name="key" required placeholder="CLINIC_CE_SEASON" /></Field>
            <Field label="Profession" hint="A version for one profession wins over an any-profession one.">
              <Select name="professionCode" defaultValue="">
                <option value="">Any profession</option>
                {professions.map((x) => <option key={x.code} value={x.code}>{x.displayName}</option>)}
              </Select>
            </Field>
            <Field label="Agent"><Select name="agent">{growth.AGENTS && Object.entries(growth.AGENTS).map(([k, [l]]) => <option key={k} value={k}>{l}</option>)}</Select></Field>
            <Field label="Purpose" className="sm:col-span-2"><Input name="purpose" required /></Field>
            <Field label="Allowed variables (comma separated)" className="sm:col-span-2"><Input name="allowedVars" defaultValue="greeting_name, clinic_name, city, calculator_url, brand" /></Field>
            <Field label="Subject" className="sm:col-span-2"><Input name="subjectTemplate" /></Field>
            <Field label="Approved message" className="sm:col-span-2"><Textarea name="body" required className="min-h-48" /></Field>
            <Field label="AI personalization instructions (blank = always send verbatim)" className="sm:col-span-2"><Textarea name="instructions" /></Field>
            <input type="hidden" name="abWeight" value="100" />
            <div><SubmitButton size="sm">Save draft</SubmitButton></div>
          </ActionForm>
        </CardBody>
      </Card>
    </>
  );
}
