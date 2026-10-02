import Link from "next/link";
import { notFound } from "next/navigation";
import { ArrowLeft } from "lucide-react";
import { prisma } from "@cm/db";
import { support } from "@cm/services";
import { adminSupportReplyAction, adminSupportStatusAction } from "@/app/help-actions";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { dateLabel, relative } from "@/lib/format";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Support request" };
export const dynamic = "force-dynamic";

export default async function AdminSupportRequest({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor("admin");
  const r = await support.adminGet(actor, (await params).id).catch(() => null);
  if (!r) notFound();
  const [org, prov, shift] = await Promise.all([
    r.clinicOrgId ? prisma.clinicOrg.findUnique({ where: { id: r.clinicOrgId }, select: { id: true, displayName: true } }) : null,
    r.providerId ? prisma.provider.findUnique({ where: { id: r.providerId }, select: { id: true, displayName: true } }) : null,
    r.shiftId ? prisma.shift.findUnique({ where: { id: r.shiftId }, include: { location: { select: { name: true, timeZone: true } } } }) : null,
  ]);
  return (
    <div className="mx-auto max-w-3xl">
      <Link href="/admin/support" className="mb-4 inline-flex items-center gap-1.5 text-sm font-medium text-slate-500 hover:text-slate-900"><ArrowLeft className="size-4" />Support</Link>
      <PageHeader title={r.subject} description={`${r.topic} · opened ${dateLabel(r.createdAt)}`} actions={<Badge tone={r.status === "OPEN" ? "amber" : r.status === "ANSWERED" ? "green" : "gray"}>{r.status}</Badge>} />
      <Card className="mb-4">
        <CardBody className="space-y-1 text-sm">
          <div><b>{r.user.name}</b> · {r.user.email}{r.user.phone ? ` · ${r.user.phone}` : ""}</div>
          {org ? <div>Clinic: <Link href={`/admin/clinics/${org.id}`} className="text-brand-700 underline">{org.displayName}</Link></div> : null}
          {prov ? <div>Provider: <Link href={`/admin/providers/${prov.id}`} className="text-brand-700 underline">{prov.displayName}</Link></div> : null}
          {shift ? <div>Shift: <Link href={`/admin/shifts/${shift.id}`} className="text-brand-700 underline">{dateLabel(shift.startsAt, shift.location.timeZone)} · {shift.location.name}</Link></div> : null}
        </CardBody>
      </Card>
      <div className="space-y-3">
        {r.messages.map((m) => (
          <div key={m.id} className={m.fromStaff ? "ml-8 rounded-2xl border border-brand-200 bg-brand-50/60 p-4" : "mr-8 rounded-2xl border border-slate-200 bg-white p-4"}>
            <div className="mb-1 text-xs font-medium text-slate-500">{m.fromStaff ? `${(m.authorUserId && r.authors[m.authorUserId]) || "Our team"} (staff)` : r.user.name} · {relative(m.createdAt)}</div>
            <p className="whitespace-pre-line text-sm text-slate-800">{m.body}</p>
          </div>
        ))}
      </div>
      <Card className="mt-6">
        <CardHeader title="Reply" description="They see it in the app and by email." />
        <CardBody className="space-y-3">
          <ActionForm action={adminSupportReplyAction} className="space-y-3" resetOnSuccess>
            <input type="hidden" name="id" value={r.id} />
            <Field label="Message"><Textarea name="body" required rows={5} /></Field>
            <div className="flex flex-wrap gap-2">
              <SubmitButton>Send reply</SubmitButton>
              <button name="close" value="1" className="rounded-xl border border-slate-300 px-4 text-sm font-medium text-slate-700 hover:bg-slate-50">Send and close</button>
            </div>
          </ActionForm>
          <ActionForm action={adminSupportStatusAction} className="flex flex-wrap gap-2">
            <input type="hidden" name="id" value={r.id} />
            <input type="hidden" name="status" value={r.status !== "CLOSED" ? "CLOSED" : "OPEN"} />
            <SubmitButton variant="ghost" size="sm">{r.status !== "CLOSED" ? "Close without replying" : "Reopen"}</SubmitButton>
          </ActionForm>
        </CardBody>
      </Card>
    </div>
  );
}
