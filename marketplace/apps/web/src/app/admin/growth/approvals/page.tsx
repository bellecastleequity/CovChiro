import { growth } from "@cm/services";
import { ActionForm } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Alert, Empty, PageHeader } from "@/components/ui/misc";
import { dateTimeLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { approvalAction, bulkApprovalAction } from "../actions";
import { GrowthTabs } from "../ui";
import { BulkSelect } from "@/components/admin/bulk-select";

export const metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

export default async function Approvals() {
  const { actor } = await requireActor("admin");
  const [rows, queue] = await Promise.all([growth.approvals(actor), growth.approvalQueue(actor)]);
  const KIND = { clinic: "Clinic outreach", provider: "Provider outreach", reply: "Reply" } as const;
  return (
    <>
      <PageHeader title="Approvals" description="Drafts waiting for a person: outreach in review mode and every reply to a prospect. Approving sends it now, still subject to suppression and do-not-contact. Rejecting discards it and pauses outreach to that clinic." />
      <GrowthTabs current="/admin/growth/approvals" />
      {queue.queued ? (
        <Alert tone={queue.heldReason ? "warning" : "info"} className="mb-4">
          {queue.queued} approved email{queue.queued === 1 ? " is" : "s are"} sending, a batch every minute.{queue.heldReason ? ` On hold right now: ${queue.heldReason}. They'll go out automatically once that clears.` : ""}
        </Alert>
      ) : null}
      {rows.length ? (
        <BulkSelect
          formId="bulk-approve"
          action={bulkApprovalAction}
          noun="draft"
          groups={[{ key: "clinic", label: "clinic outreach" }, { key: "provider", label: "provider outreach" }, { key: "reply", label: "replies" }]}
          actions={[
            { value: "approve", label: "Approve all clinic outreach", verb: "Approve and send", allOf: "clinic" },
            { value: "approve", label: "Approve selected", verb: "Approve and send" },
            { value: "reject", label: "Reject selected", verb: "Reject", variant: "outline" },
          ]}
        />
      ) : null}
      {!rows.length ? <Empty title="Nothing waiting for approval." /> : (
        <div className="space-y-4">
          {rows.map((m) => (
            <Card key={m.id}>
              <CardBody>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <label className="flex cursor-pointer items-start gap-3">
                    <input type="checkbox" name="ids" value={m.id} form="bulk-approve" data-group={m.kind} className="mt-1 size-4 accent-brand-600" aria-label={`Select ${m.label}`} />
                    <div><div className="font-semibold">{m.label}</div><div className="text-xs text-slate-500">To {m.toAddress} · drafted {dateTimeLabel(m.createdAt)}</div></div>
                  </label>
                  <div className="flex flex-wrap gap-1.5"><Badge tone={m.kind === "reply" ? "amber" : "green"}>{KIND[m.kind]}</Badge><Badge tone="brand">{m.promptKey} v{m.promptVersion}</Badge><Badge>{humanize(m.agent ?? "")}</Badge><Badge tone={m.purpose === "COMMERCIAL" ? "amber" : "gray"}>{humanize(m.purpose)}</Badge></div>
                </div>
                <ActionForm action={approvalAction} className="space-y-3">
                  <input type="hidden" name="id" value={m.id} />
                  <Field label="Subject"><Input name="subject" defaultValue={m.subject ?? ""} /></Field>
                  <Field label="Message"><Textarea name="body" defaultValue={m.body ?? ""} className="min-h-56" /></Field>
                  <div className="flex gap-2">
                    <button name="decision" value="approve" className={buttonClass("primary", "sm")}>Approve &amp; send</button>
                    <button name="decision" value="reject" className={buttonClass("outline", "sm")}>Reject</button>
                  </div>
                </ActionForm>
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
