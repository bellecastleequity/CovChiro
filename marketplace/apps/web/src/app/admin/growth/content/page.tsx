import Link from "next/link";
import { growth } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { PageHeader, Stat, Table, Td, Th } from "@/components/ui/misc";
import { dateLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { repurposeAction } from "../actions";
import { GrowthTabs } from "../ui";

export const metadata = { title: "Content" };
export const dynamic = "force-dynamic";

export default async function Content() {
  await requireActor("admin");
  const c = await growth.contentStats();
  return (
    <>
      <PageHeader
        title="Content"
        description="Blog articles and what they lead to (last 90 days). The Content agent drafts; people review and publish (the publish check blocks guarantee/ROI language, contact or patient details and unsupported dollar figures, and flags legal citations for review). A published article can be reused as a knowledge-base answer (FAQ and chatbot), an email, or a social post."
        actions={<Link href="/admin/blog" className="text-sm font-medium text-brand-700">Write or review posts →</Link>}
      />
      <GrowthTabs current="/admin/growth/content" />
      <div className="mb-6 grid grid-cols-2 gap-3 md:grid-cols-4 xl:grid-cols-8">
        <Stat label="Published" value={c.counts.published} />
        <Stat label="Drafts" value={c.counts.drafts} tone={c.counts.drafts ? "amber" : "default"} />
        <Stat label="Article views" value={c.traffic.views} hint={`${c.traffic.readers} readers`} />
        <Stat label="Provider traffic" value={c.traffic.providerViews} />
        <Stat label="Clinic traffic" value={c.traffic.clinicViews} />
        <Stat label="CTA clicks" value={c.traffic.ctaClicks} />
        <Stat label="Registrations" value={c.outcomes.registrations} hint={`${c.outcomes.providerRegistrations} providers · ${c.outcomes.clinicRegistrations} clinics`} tone="brand" />
        <Stat label="Completed bookings" value={c.outcomes.completedBookings} hint={`${c.outcomes.coverageRequests} requests · ${c.outcomes.providerFirstShifts} provider first shifts`} tone="green" />
      </div>
      <Card>
        <CardHeader title="Articles" description="Registrations and bookings count readers who later signed up (same browser), not just clicks." />
        <Table>
          <thead><tr><Th>Article</Th><Th>Status</Th><Th>Audience</Th><Th className="text-right">Views</Th><Th className="text-right">CTA clicks</Th><Th>Reuse</Th></tr></thead>
          <tbody>
            {c.posts.length ? c.posts.map((p) => (
              <tr key={p.id} className="align-top hover:bg-slate-50">
                <Td><Link href={`/admin/blog/${p.id}`} className="font-medium hover:text-brand-700">{p.title}</Link><div className="text-xs text-slate-400">/blog/{p.slug}{p.publishedAt ? ` · ${dateLabel(p.publishedAt)}` : ""}{p.aiGenerated ? " · AI draft" : ""}</div></Td>
                <Td><Badge tone={p.status === "PUBLISHED" ? "green" : p.status === "DRAFT" ? "amber" : "gray"}>{humanize(p.status)}</Badge></Td>
                <Td className="text-xs">{humanize(p.audience)}</Td>
                <Td className="text-right tabular-nums">{p.views}</Td>
                <Td className="text-right tabular-nums">{p.ctaClicks}</Td>
                <Td>
                  {p.status === "PUBLISHED" ? (
                    <div className="flex flex-wrap gap-1">
                      {(["kb", "email", "social"] as const).map((t) => (
                        <ActionForm key={t} action={repurposeAction} successMessage>
                          <input type="hidden" name="postId" value={p.id} /><input type="hidden" name="target" value={t} />
                          <SubmitButton size="sm" variant="ghost">{t === "kb" ? "→ FAQ / chatbot" : t === "email" ? "→ Email" : "→ Social"}</SubmitButton>
                        </ActionForm>
                      ))}
                    </div>
                  ) : <span className="text-xs text-slate-400">Publish first</span>}
                </Td>
              </tr>
            )) : <tr><Td colSpan={6} className="text-slate-500">No posts yet. <Link href="/admin/blog" className="text-brand-700">Draft one</Link>.</Td></tr>}
          </tbody>
        </Table>
      </Card>
      <Card className="mt-6">
        <CardBody className="text-sm text-slate-600">
          Topic ideas come from the Content agent on the blog page (it uses the published FAQ and approved knowledge base). Good sources: questions in Leads / Conversations, sales objections, and markets showing a supply gap under Supply &amp; Demand.
        </CardBody>
      </Card>
    </>
  );
}
