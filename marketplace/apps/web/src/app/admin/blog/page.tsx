import Link from "next/link";
import { Sparkles } from "lucide-react";
import { getSettings, blog } from "@cm/services";
import { BlogTopicIdeas } from "@/components/admin/blog-topic-ideas";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Empty, PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateTimeLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { draftAction, newPostAction, suggestAction } from "./actions";

export const metadata = { title: "Blog" };
export const dynamic = "force-dynamic";

const AUD: Record<string, string> = { CLINIC: "Clinics", PROVIDER: "Providers", ALL: "Everyone" };

export default async function AdminBlog() {
  const { actor } = await requireActor("admin");
  const [posts, s] = await Promise.all([blog.listPosts(actor), getSettings()]);
  return (
    <>
      <PageHeader
        title="Blog"
        description="AI writes drafts from our approved FAQ and knowledge base; you review, edit and publish. Nothing is published automatically, and a post can't go live until it passes the content checks."
        actions={<Link href="/blog" className="text-sm font-medium text-brand-700" target="_blank">View the blog →</Link>}
      />
      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Write a draft with AI" description={`Uses ${s["blog.aiProvider"]} · ${s["blog.aiModel"]} (Settings → Blog). Takes up to two minutes.`} />
          <CardBody>
            <ActionForm action={draftAction} successMessage={false} className="grid gap-3">
              <Field label="Topic or question"><Input name="topic" required placeholder="e.g. How to plan coverage for a CE weekend" /></Field>
              <div className="grid gap-3 sm:grid-cols-2">
                <Field label="Written for">
                  <Select name="audience" defaultValue="CLINIC"><option value="CLINIC">Clinics</option><option value="PROVIDER">Providers</option><option value="ALL">Both</option></Select>
                </Field>
                <Field label="Search phrases (optional)"><Input name="keywords" placeholder="covering chiropractor, fill-in doctor" /></Field>
              </div>
              <Field label="Notes for the writer (optional)"><Textarea name="notes" placeholder="Angle, points to include, things to avoid" className="min-h-20" /></Field>
              <div><SubmitButton pendingText="Writing… (up to 2 min)"><Sparkles className="size-4" />Write draft</SubmitButton></div>
            </ActionForm>
          </CardBody>
        </Card>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Need ideas?" description="Topics that answer real questions and don't repeat existing posts." />
            <CardBody><BlogTopicIdeas suggest={suggestAction} draft={draftAction} /></CardBody>
          </Card>
          <Card>
            <CardHeader title="Write one yourself" />
            <CardBody>
              <ActionForm action={newPostAction} successMessage={false} className="flex flex-wrap items-end gap-2">
                <Field label="Title" className="min-w-0 flex-1"><Input name="title" required /></Field>
                <SubmitButton variant="outline">Start a blank post</SubmitButton>
              </ActionForm>
              <p className="mt-3 text-xs text-slate-500">
                Automatic drafts: {s["blog.autoDraftsPerWeek"] ? `${s["blog.autoDraftsPerWeek"]} per week, from the topic queue in Settings → Blog. You'll get a notification to review each one.` : "off (Settings → Blog)."}
              </p>
            </CardBody>
          </Card>
        </div>
      </div>
      <Card className="mt-6">
        <CardHeader title={`Posts (${posts.length})`} />
        {posts.length ? (
          <Table>
            <thead><tr><Th>Title</Th><Th>Status</Th><Th>For</Th><Th>Updated</Th><Th>Published</Th></tr></thead>
            <tbody>
              {posts.map((p) => (
                <tr key={p.id} className="hover:bg-slate-50">
                  <Td>
                    <Link href={`/admin/blog/${p.id}`} className="font-medium text-slate-900 hover:text-brand-700">{p.title}</Link>
                    <div className="mt-0.5 flex flex-wrap gap-1 text-xs text-slate-500">/blog/{p.slug}{p.aiGenerated ? <Badge tone="blue">AI draft{p.createdById ? "" : " · automatic"}</Badge> : null}</div>
                  </Td>
                  <Td><StatusBadge status={p.status} /></Td>
                  <Td>{AUD[p.audience] ?? p.audience}</Td>
                  <Td className="whitespace-nowrap">{dateTimeLabel(p.updatedAt)}</Td>
                  <Td className="whitespace-nowrap">{dateTimeLabel(p.publishedAt)}</Td>
                </tr>
              ))}
            </tbody>
          </Table>
        ) : (
          <CardBody><Empty title="No posts yet">Write your first draft above.</Empty></CardBody>
        )}
      </Card>
    </>
  );
}
