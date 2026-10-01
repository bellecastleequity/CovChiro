import Link from "next/link";
import { notFound } from "next/navigation";
import { prisma } from "@cm/db";
import { growth } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { dateTimeLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { promptStatusAction, savePromptAction } from "../../actions";
import { GrowthTabs } from "../../ui";
import { PromptPreview } from "./preview";

export const metadata = { title: "Prompt" };
export const dynamic = "force-dynamic";

export default async function PromptDetail({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor("admin");
  await growth.prompts(actor);
  const p = await prisma.promptTemplate.findUnique({ where: { id: (await params).id } });
  if (!p) notFound();
  const versions = await prisma.promptTemplate.findMany({ where: { key: p.key, professionCode: p.professionCode }, orderBy: { version: "desc" }, select: { id: true, version: true, status: true, active: true, abWeight: true } });
  const op = (value: string, label: string, variant: "primary" | "outline" | "danger" = "outline") => <button name="op" value={value} className={buttonClass(variant, "sm")}>{label}</button>;
  return (
    <>
      <PageHeader eyebrow={<Link href="/admin/growth/prompts" className="hover:underline">Prompts</Link>} title={`${p.key} v${p.version}`} description={p.purpose} />
      <GrowthTabs current="/admin/growth/prompts" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        <Badge tone={p.status === "APPROVED" ? "green" : p.status === "DRAFT" ? "amber" : "gray"}>{humanize(p.status)}</Badge>
        {p.active ? <Badge tone="brand">Active · weight {p.abWeight}</Badge> : <Badge>Inactive</Badge>}
        <span className="text-xs text-slate-500">{humanize(p.agent)} · created {dateTimeLabel(p.createdAt)}{p.approvedAt ? ` · approved ${dateTimeLabel(p.approvedAt)}` : ""}</span>
        <span className="ml-auto flex gap-1 text-xs">{versions.map((v) => <Link key={v.id} href={`/admin/growth/prompts/${v.id}`} className={`rounded-full px-2 py-0.5 ring-1 ${v.id === p.id ? "bg-brand-600 text-white ring-brand-600" : "ring-slate-200"}`}>v{v.version}{v.active ? " ●" : ""}</Link>)}</span>
      </div>
      <Card className="mb-6">
        <CardBody>
          <ActionForm action={promptStatusAction} className="flex flex-wrap items-center gap-2">
            <input type="hidden" name="id" value={p.id} />
            {p.status === "DRAFT" ? op("approve", "Approve this version", "primary") : null}
            {p.status === "APPROVED" && !p.active ? <>{op("activate", "Activate (replace current)", "primary")}{op("activate_ab", "Activate as A/B test")}</> : null}
            {p.active ? op("deactivate", "Deactivate") : null}
            {p.status !== "RETIRED" ? op("retire", "Retire", "danger") : null}
            {p.active ? <span className="flex items-center gap-2"><Input name="weight" type="number" min={0} defaultValue={p.abWeight} className="w-24" />{op("weight", "Set A/B weight")}</span> : null}
          </ActionForm>
        </CardBody>
      </Card>
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="This version" description={`Allowed variables: ${p.allowedVars.join(", ")}`} />
          <CardBody className="space-y-3 text-sm">
            <div><div className="text-xs font-medium text-slate-500">Subject</div><div className="font-medium">{p.subjectTemplate ?? "—"}</div></div>
            <div><div className="text-xs font-medium text-slate-500">Approved message</div><p className="whitespace-pre-wrap text-slate-700">{p.body}</p></div>
            <div><div className="text-xs font-medium text-slate-500">AI personalization instructions</div><p className="whitespace-pre-wrap text-slate-700">{p.instructions ?? "None: sent word for word, no AI."}</p></div>
            <PromptPreview id={p.id} hasInstructions={!!p.instructions} />
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Edit → new draft version" description="Approved versions are never edited in place." />
          <CardBody>
            <ActionForm action={savePromptAction} className="space-y-3">
              <input type="hidden" name="key" value={p.key} /><input type="hidden" name="professionCode" value={p.professionCode ?? ""} /><input type="hidden" name="agent" value={p.agent} /><input type="hidden" name="abWeight" value={p.abWeight} />
              <Field label="Purpose"><Input name="purpose" defaultValue={p.purpose} required /></Field>
              <Field label="Allowed variables"><Input name="allowedVars" defaultValue={p.allowedVars.join(", ")} /></Field>
              <Field label="Subject"><Input name="subjectTemplate" defaultValue={p.subjectTemplate ?? ""} /></Field>
              <Field label="Approved message"><Textarea name="body" defaultValue={p.body} required className="min-h-56" /></Field>
              <Field label="AI personalization instructions"><Textarea name="instructions" defaultValue={p.instructions ?? ""} /></Field>
              <Field label="Change note"><Input name="notes" /></Field>
              <SubmitButton size="sm">Save as v{versions[0].version + 1} (draft)</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
