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

export const metadata = { title: "Leads & conversations" };
export const dynamic = "force-dynamic";

const entityLink = (type: string, id: string | null) =>
  !id ? null : type === "PROVIDER_PROSPECT" ? `/admin/growth/prospects/providers/${id}` : type === "MARKET" ? `/admin/growth/markets/${id}` : type === "PROSPECT" ? `/admin/growth/prospects/${id}` : type === "CLINIC" ? `/admin/clinics/${id}` : type === "PROVIDER" ? `/admin/providers/${id}` : type === "SHIFT" ? `/admin/shifts/${id}` : null;

const SIDES: Record<string, string[]> = { providers: ["PROVIDER_PROSPECT", "PROVIDER"], clinics: ["PROSPECT", "CLINIC"], markets: ["MARKET", "SHIFT"] };

export default async function Escalations({ searchParams }: { searchParams: Promise<{ all?: string; side?: string }> }) {
  const { actor } = await requireActor("admin");
  const sp = await searchParams;
  const all = sp.all === "1";
  const rows = (await growth.escalations(actor, all)).filter((e) => !sp.side || (SIDES[sp.side] ?? []).includes(e.entityType)).sort((a, b) => Number(b.intentLevel === "HIGH") - Number(a.intentLevel === "HIGH"));
  const chip = (side: string | undefined, label: string) => <Link key={label} href={`/admin/growth/escalations?${new URLSearchParams({ ...(side ? { side } : {}), ...(all ? { all: "1" } : {}) })}`} className={`rounded-full px-3 py-1 text-xs ring-1 ${sp.side === side ? "bg-brand-600 text-white ring-brand-600" : "ring-slate-200"}`}>{label}</Link>;
  return (
    <>
      <PageHeader title="Leads / Conversations" description="High-intent leads and conversations an agent handed to a person instead of improvising: interested providers and clinics, questions the knowledge base doesn't cover, legal, payment, safety or clinical-scope topics, markets short of providers, and open shifts with no eligible provider. High intent first." actions={<Link href={all ? "/admin/growth/escalations" : "/admin/growth/escalations?all=1"} className={buttonClass("outline", "sm")}>{all ? "Open only" : "Include resolved"}</Link>} />
      <GrowthTabs current="/admin/growth/escalations" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {chip(undefined, "All")}{chip("providers", "Provider leads")}{chip("clinics", "Clinic leads")}{chip("markets", "Markets & shifts")}
        <span className="ml-2 text-xs text-slate-500">Also: <Link href="/admin/growth/sales" className="text-brand-700">Sales queue</Link> · <Link href="/admin/growth/approvals" className="text-brand-700">Approvals</Link></span>
      </div>
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
                  {e.summary ? <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><div className="text-xs font-medium uppercase tracking-wide text-slate-500">AI summary</div><p className="whitespace-pre-wrap">{e.summary}</p></div> : null}
                  {e.recommendedAction ? <p className="mt-2 text-sm"><span className="font-medium">Suggested next action:</span> {e.recommendedAction}</p> : null}
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
