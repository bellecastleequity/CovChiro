import { prisma } from "@cm/db";
import { growth, getSettings, siteFaq } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";
import { deleteKbAction, saveKbAction } from "../actions";
import { GrowthTabs } from "../ui";

export const metadata = { title: "Knowledge base" };
export const dynamic = "force-dynamic";

const TOPICS = ["pricing", "policy", "provider", "clinic", "payment", "credentialing", "geography", "onboarding", "marketing", "terms"];

function KbForm({ a, professions }: { a?: Awaited<ReturnType<typeof growth.kb>>[number]; professions: { code: string; displayName: string }[] }) {
  return (
    <ActionForm action={saveKbAction} className="grid gap-2 sm:grid-cols-2" resetOnSuccess={!a}>
      {a ? <input type="hidden" name="id" value={a.id} /> : null}
      <Field label="Topic"><Select name="topic" defaultValue={a?.topic ?? "clinic"}>{TOPICS.map((t) => <option key={t}>{t}</option>)}</Select></Field>
      <Field label="Audience"><Select name="audience" defaultValue={a?.audience ?? "ALL"}><option value="ALL">Everyone</option><option value="CLINIC">Clinics</option><option value="PROVIDER">Providers</option></Select></Field>
      <Field label="Profession" className="sm:col-span-2" hint="Questions from people in other professions never get this answer.">
        <Select name="professionCode" defaultValue={a?.professionCode ?? ""}><option value="">Every profession</option>{professions.map((p) => <option key={p.code} value={p.code}>{p.displayName}</option>)}</Select>
      </Field>
      <Field label="Question" className="sm:col-span-2"><Input name="question" defaultValue={a?.question} required /></Field>
      <Field label="Approved answer" className="sm:col-span-2"><Textarea name="answer" defaultValue={a?.answer} required /></Field>
      <Field label="Keywords (comma separated)" className="sm:col-span-2"><Input name="keywords" defaultValue={a?.keywords.join(", ")} /></Field>
      <Checkbox name="approved" label="Approved for AI answers" defaultChecked={a?.approved ?? false} />
      <Checkbox name="active" label="Active" defaultChecked={a?.active ?? true} />
      <div className="flex gap-2"><SubmitButton size="sm">{a ? "Save" : "Add article"}</SubmitButton></div>
    </ActionForm>
  );
}

export default async function Knowledge() {
  const { actor } = await requireActor("admin");
  const rows = await growth.kb(actor);
  const professions = await prisma.profession.findMany({ orderBy: { sortOrder: "asc" }, select: { code: true, displayName: true } });
  const faq = siteFaq(await getSettings());
  return (
    <>
      <PageHeader title="Knowledge base" description="The conversation agent answers only from approved articles here plus the published FAQ. It hands anything else to a person instead of guessing. Pricing answers should describe how pricing works, never quote a number the rate engine would set." />
      <GrowthTabs current="/admin/growth/knowledge" />
      <div className="space-y-4">
        {rows.map((a) => (
          <Card key={a.id}>
            <CardHeader title={a.question} action={<div className="flex gap-1"><Badge>{a.topic}</Badge><Badge tone={a.approved ? "green" : "amber"}>{a.approved ? "Approved" : "Draft"}</Badge>{a.active ? null : <Badge tone="red">Inactive</Badge>}</div>} />
            <CardBody>
              <details><summary className="cursor-pointer text-sm text-slate-600">{a.answer.slice(0, 160)}{a.answer.length > 160 ? "…" : ""} <span className="text-brand-700">Edit</span></summary>
                <div className="mt-3"><KbForm a={a} professions={professions} /></div>
                <ActionForm action={deleteKbAction} confirm="Delete this article?" className="mt-2"><input type="hidden" name="id" value={a.id} /><SubmitButton size="sm" variant="ghost">Delete</SubmitButton></ActionForm>
              </details>
            </CardBody>
          </Card>
        ))}
      </div>
      <Card className="mt-6"><CardHeader title="Add an article" /><CardBody><KbForm professions={professions} /></CardBody></Card>
      <Card className="mt-6">
        <CardHeader title={`Published FAQ (${faq.length}, always included)`} description="Edited in the code with the public FAQ page; values that are Settings are filled in live." />
        <CardBody className="space-y-2 text-sm">{faq.map(([q, a]) => <div key={q}><div className="font-medium">{q}</div><div className="text-slate-600">{a}</div></div>)}</CardBody>
      </Card>
    </>
  );
}
