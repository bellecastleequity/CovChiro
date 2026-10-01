import Link from "next/link";
import { growth } from "@cm/services";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { Card, CardBody } from "@/components/ui/card";
import { Checklist, Empty, PageHeader } from "@/components/ui/misc";
import { dateLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { GrowthTabs, usd } from "../ui";

export const metadata = { title: "Sales queue" };
export const dynamic = "force-dynamic";

/** Spec §17: put human attention where it produces the most value. */
export default async function SalesQueue() {
  const { actor } = await requireActor("admin");
  const items = await growth.salesQueue(actor);
  return (
    <>
      <PageHeader title="Sales queue" description="High-intent clinics: interest in replies, unposted multi-day requests, high intent scores and open escalations. Phone calls are human-only." />
      <GrowthTabs current="/admin/growth/sales" />
      {!items.length ? <Empty title="No high-intent opportunities right now." /> : (
        <div className="space-y-4">
          {items.map(({ prospect: p, escalations, checklist, drafts, suggested }) => (
            <Card key={p.id}>
              <CardBody>
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div>
                    <Link href={`/admin/growth/prospects/${p.id}`} className="text-lg font-semibold hover:text-brand-700">{p.clinicName}</Link>
                    <div className="text-sm text-slate-500">{[p.city, p.state].filter(Boolean).join(", ")}{p.ownerName ? ` · ${p.ownerName}` : ""}{p.phone ? ` · ${p.phone}` : ""}</div>
                  </div>
                  <div className="flex flex-wrap gap-1.5"><Badge tone="red">{humanize(p.intentCategory)} · {p.intentScore}</Badge><StatusBadge status={p.stage} />{(p.locationsCount ?? 0) > 1 ? <Badge tone="brand">{p.locationsCount} locations</Badge> : null}</div>
                </div>
                <dl className="mt-4 grid gap-x-8 gap-y-2 text-sm sm:grid-cols-[9rem_1fr]">
                  {drafts.length ? (<><dt className="text-slate-500">Requested</dt><dd>{drafts.map((d) => dateLabel(d.startsAt, d.timeZone)).join(", ")} · {drafts.length} day{drafts.length === 1 ? "" : "s"} · {usd(drafts.reduce((a, d) => a + d.clinicPriceCents, 0))} potential</dd></>) : null}
                  <dt className="text-slate-500">Account</dt><dd>{p.clinicOrgId ? <Link className="text-brand-700 hover:underline" href={`/admin/clinics/${p.clinicOrgId}`}>Created</Link> : "Not yet"}</dd>
                  {p.aiSummary ? (<><dt className="text-slate-500">AI summary</dt><dd>{p.aiSummary}</dd></>) : null}
                  {escalations.map((e) => (<div key={e.id} className="contents"><dt className="text-slate-500">{humanize(e.reasonCode)}</dt><dd>{e.reason}</dd></div>))}
                  <dt className="font-medium text-slate-700">Suggested action</dt><dd className="font-medium">{suggested}</dd>
                </dl>
                {checklist ? <div className="mt-4 max-w-md"><Checklist items={checklist.map((s) => ({ label: s.label, done: s.done }))} /></div> : null}
              </CardBody>
            </Card>
          ))}
        </div>
      )}
    </>
  );
}
