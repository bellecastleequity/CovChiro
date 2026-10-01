import { growth } from "@cm/services";
import { ActionForm } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Empty, PageHeader } from "@/components/ui/misc";
import { dateTimeLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { approvalAction } from "../actions";
import { GrowthTabs } from "../ui";

export const metadata = { title: "Approvals" };
export const dynamic = "force-dynamic";

export default async function Approvals() {
  const { actor } = await requireActor("admin");
  const rows = await growth.approvals(actor);
  return (
    <>
      <PageHeader title="Approvals" description="Drafts waiting for a person: outreach in review mode and every reply to a prospect. Approving sends it now, still subject to suppression and do-not-contact. Rejecting discards it and pauses outreach to that clinic." />
      <GrowthTabs current="/admin/growth/approvals" />
      {!rows.length ? <Empty title="Nothing waiting for approval." /> : (
        <div className="space-y-4">
          {rows.map((m) => (
            <Card key={m.id}>
              <CardBody>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
                  <div><div className="font-semibold">{m.label}</div><div className="text-xs text-slate-500">To {m.toAddress} · drafted {dateTimeLabel(m.createdAt)}</div></div>
                  <div className="flex gap-1.5"><Badge tone="brand">{m.promptKey} v{m.promptVersion}</Badge><Badge>{humanize(m.agent ?? "")}</Badge><Badge tone={m.purpose === "COMMERCIAL" ? "amber" : "gray"}>{humanize(m.purpose)}</Badge></div>
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
