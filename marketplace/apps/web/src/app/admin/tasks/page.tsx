import { admin } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Empty, PageHeader } from "@/components/ui/misc";
import { humanize, relative } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { resolveTaskAction } from "../actions";

const LINK: Record<string, (id: string) => string> = {
  Assignment: () => "/admin/shifts",
  Provider: (id) => `/admin/providers/${id}`,
  Dispute: () => "/admin/payments",
  LodgingReceipt: () => "/admin/payments",
  License: () => "/admin/verification",
  RateRegion: () => "/admin/rates",
  MessageThread: (id) => `/admin/messages/${id}`,
};

export default async function Tasks() {
  const { actor } = await requireActor("admin");
  const tasks = await admin.openTasks(actor);
  return (
    <>
      <PageHeader title="Tasks" description="Items the system flagged for a human." />
      {tasks.length ? (
        <Card className="divide-y divide-slate-100">
          {tasks.map((t) => (
            <div key={t.id} className="flex flex-wrap items-center justify-between gap-3 px-5 py-3 text-sm">
              <div>
                <Badge tone="amber">{humanize(t.kind)}</Badge>{" "}
                {t.entityType && LINK[t.entityType] ? <a className="font-medium hover:text-brand-700" href={LINK[t.entityType](t.entityId ?? "")}>{t.title}</a> : <span className="font-medium">{t.title}</span>}
                <div className="text-xs text-slate-400">{relative(t.createdAt)}</div>
              </div>
              <ActionForm action={resolveTaskAction} successMessage={false}><input type="hidden" name="taskId" value={t.id} /><SubmitButton size="sm" variant="outline">Resolve</SubmitButton></ActionForm>
            </div>
          ))}
        </Card>
      ) : <Empty title="No open tasks" />}
    </>
  );
}
