import Link from "next/link";
import { notFound } from "next/navigation";
import { ExternalLink } from "lucide-react";
import { readingMinutes, wordCount } from "@cm/core";
import { blog } from "@cm/services";
import { Markdown } from "@/components/blog/markdown";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Alert, PageHeader } from "@/components/ui/misc";
import { dateTimeLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { deletePostAction, publishPostAction, savePostAction, statusPostAction } from "../actions";

export const metadata = { title: "Edit post" };
export const dynamic = "force-dynamic";

export default async function EditPost({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ drafted?: string }> }) {
  const { actor } = await requireActor("admin");
  const { id } = await params;
  const { drafted } = await searchParams;
  const found = await blog.getPost(actor, id).catch(() => null);
  if (!found) notFound();
  const { post: p, check } = found;
  const live = p.status === "PUBLISHED";
  return (
    <>
      <Link href="/admin/blog" className="mb-4 inline-block text-sm font-medium text-slate-500 hover:text-slate-900">← All posts</Link>
      <PageHeader back={{ href: "/admin/blog", label: "Blog" }}
        eyebrow={<span className="flex items-center gap-2"><StatusBadge status={p.status} />{p.aiGenerated ? `AI draft · ${p.aiModel ?? ""}` : "Written by hand"}</span>}
        title={p.title}
        description={`${wordCount(p.body)} words · ${readingMinutes(p.body)} min read · updated ${dateTimeLabel(p.updatedAt)}${p.publishedAt ? ` · published ${dateTimeLabel(p.publishedAt)}` : ""}`}
        actions={live ? <Link href={`/blog/${p.slug}`} target="_blank" className="inline-flex items-center gap-1.5 text-sm font-medium text-brand-700"><ExternalLink className="size-4" />View live</Link> : null}
      />
      {drafted ? <Alert tone="success" className="mb-4" title="Draft written">Read it carefully: check every fact against how we actually work, then edit and publish. The checks below catch the obvious problems, not every mistake.</Alert> : null}
      {p.brief ? <p className="mb-4 text-sm text-slate-500">Written from: “{p.brief}”</p> : null}
      <div className="mb-6 space-y-2">
        {check.errors.length ? (
          <Alert tone="error" title={`Fix before publishing (${check.errors.length})`}><ul className="list-disc space-y-1 pl-5">{check.errors.map((e) => <li key={e}>{e}</li>)}</ul></Alert>
        ) : (
          <Alert tone="success" title="Passes the publish checks" />
        )}
        {check.warnings.length ? <Alert tone="warning" title="Worth a look"><ul className="list-disc space-y-1 pl-5">{check.warnings.map((e) => <li key={e}>{e}</li>)}</ul></Alert> : null}
      </div>
      <div className="grid gap-6 xl:grid-cols-2">
        <Card>
          <CardHeader title="Edit" description="Save before publishing. Formatting: ## Heading, ### Subheading, - bullet, 1. numbered, **bold**, *italic*, [link text](/for-clinics), > quote." />
          <CardBody>
            <ActionForm action={savePostAction} className="grid gap-3">
              <input type="hidden" name="id" value={p.id} />
              <Field label="Title" hint={`${p.title.length} characters (aim for 60 or fewer)`}><Input name="title" defaultValue={p.title} required /></Field>
              <Field label="Web address" hint="Changing it on a live post breaks existing links."><Input name="slug" defaultValue={p.slug} /></Field>
              <Field label="Meta description" hint={`${p.description.length} characters (aim for 120–155). Shown in Google results.`}><Textarea name="description" defaultValue={p.description} className="min-h-16" /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Written for">
                  <Select name="audience" defaultValue={p.audience}><option value="CLINIC">Clinics</option><option value="PROVIDER">Providers</option><option value="ALL">Both</option></Select>
                </Field>
                <Field label="Search phrases"><Input name="keywords" defaultValue={p.keywords.join(", ")} /></Field>
              </div>
              <Field label="Article"><Textarea name="body" defaultValue={p.body} className="min-h-[480px] font-mono text-[13px] leading-6" /></Field>
              <div><SubmitButton>Save</SubmitButton></div>
            </ActionForm>
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Publish" />
            <CardBody className="flex flex-wrap gap-2">
              {live ? (
                <ActionForm action={statusPostAction} confirm="Take this post off the blog?"><input type="hidden" name="id" value={p.id} /><input type="hidden" name="status" value="DRAFT" /><SubmitButton variant="outline">Unpublish</SubmitButton></ActionForm>
              ) : (
                <ActionForm action={publishPostAction} confirm="Publish this post on the public blog?"><input type="hidden" name="id" value={p.id} /><SubmitButton disabled={check.errors.length > 0}>Publish</SubmitButton></ActionForm>
              )}
              {p.status !== "ARCHIVED" && !live ? (
                <ActionForm action={statusPostAction}><input type="hidden" name="id" value={p.id} /><input type="hidden" name="status" value="ARCHIVED" /><SubmitButton variant="ghost">Archive</SubmitButton></ActionForm>
              ) : null}
              {!live ? (
                <ActionForm action={deletePostAction} confirm="Delete this post permanently?"><input type="hidden" name="id" value={p.id} /><SubmitButton variant="ghost">Delete</SubmitButton></ActionForm>
              ) : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Preview" description="As saved." />
            <CardBody className="max-h-[900px] overflow-y-auto">
              <h1 className="text-2xl font-semibold">{p.title}</h1>
              <p className="mt-2 text-slate-600">{p.description}</p>
              {p.body ? <Markdown source={p.body} /> : <p className="mt-4 text-sm text-slate-500">No article text yet.</p>}
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
