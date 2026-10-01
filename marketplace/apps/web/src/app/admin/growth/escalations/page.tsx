import Link from "next/link";
import { growth } from "@cm/services";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { Empty, PageHeader } from "@/components/ui/misc";
import { dateTimeLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { escalationAction } from "../actions";
import { GrowthTabs } from "../ui";

export const metadata = { title: "Escalations" };
export const dynamic = "force-dynamic";

const entityLink = (type: string, id: string | null) =>
  !id ? null : type === "PROSPECT" ? `/admin/growth/prospects/${id}` : type === "CLINIC" ? `/admin/clinics/${id}` : type === "PROVIDER" ? `/admin/providers/${id}` : type === "SHIFT" ? `/admin/shifts/${id}` : null;

export default async function Escalations({ searchParams }: { searchParams: Promise<{ all?: string }> }) {
  const { actor } = await requireActor("admin");
  const all = (await searchParams).all === "1";
  const rows = await growth.escalations(actor, all);
  return (
    <>
      <PageHeader title="Escalations" description="Cases an agent handed to a person instead of improvising: legal, payment, safety or clinical-scope topics, interest and high intent, low confidence, questions the knowledge base doesn't cover, and open shifts with no eligible provider." actions={<Link href={all ? "/admin/growth/escalations" : "/admin/growth/escalations?all=1"} className={buttonClass("outline", "sm")}>{all ? "Open only" : "Include resolved"}</Link>} />
      <GrowthTabs current="/admin/growth/escalations" />
      {!rows.length ? <Empty title="No escalations." /> : (
        <div className="space-y-3">
          {rows.map((e) => {
            const href = entityLink(e.entityType, e.entityId);
            return (
              <Card key={e.id}>
                <CardBody>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{href ? <Link href={href} className="hover:text-brand-700">{e.entityLabel}</Link> : e.entityLabel}</div>
                      <div className="text-sm text-slate-700">{e.reason}</div>
                    </div>
                    <div className="flex gap-1.5"><Badge tone="amber">{humanize(e.reasonCode)}</Badge>{e.intentLevel ? <Badge tone="red">{e.intentLevel} intent</Badge> : null}<StatusBadge status={e.status} /></div>
                  </div>
                  {e.summary ? <p className="mt-3 whitespace-pre-wrap rounded-lg bg-slate-50 p-3 text-sm text-slate-700">{e.summary}</p> : null}
                  {e.recommendedAction ? <p className="mt-2 text-sm"><span className="font-medium">Recommended:</span> {e.recommendedAction}</p> : null}
                  <p className="mt-1 text-xs text-slate-500">{dateTimeLabel(e.createdAt)}{e.resolution ? ` · ${e.resolution}` : ""}</p>
                  {e.status !== "RESOLVED" ? (
                    <ActionForm action={escalationAction} className="mt-3 flex flex-wrap gap-2">
                      <input type="hidden" name="id" value={e.id} />
                      <Input name="resolution" placeholder="Resolution note (optional)" className="w-72" />
                      {e.status === "OPEN" ? <button name="status" value="IN_PROGRESS" className={buttonClass("outline", "sm")}>Working on it</button> : null}
                      <button name="status" value="RESOLVED" className={buttonClass("primary", "sm")}>Resolve</button>
                    </ActionForm>
                  ) : null}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
    </>
  );
}
