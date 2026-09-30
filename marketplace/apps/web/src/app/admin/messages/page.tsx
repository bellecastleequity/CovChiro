import Link from "next/link";
import { messaging } from "@cm/services";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { Empty, PageHeader } from "@/components/ui/misc";
import { humanize, relative } from "@/lib/format";
import { requireActor } from "@/lib/session";

export const metadata = { title: "Blocked messages" };

export default async function BlockedMessages() {
  const { actor } = await requireActor("admin");
  const rows = await messaging.blockedMessages(actor);
  return (
    <>
      <PageHeader title="Blocked messages" description="Messages that were not delivered because they shared contact details or tried to arrange work off the platform. Repeat senders also appear under Tasks." />
      {rows.length ? (
        <Card className="divide-y divide-slate-100">
          {rows.map((r) => (
            <div key={r.id} className="space-y-1.5 px-5 py-4 text-sm">
              <div className="flex flex-wrap items-center gap-2">
                <span className="font-medium">{r.sender?.name ?? "Unknown"}</span>
                <span className="text-slate-400">({r.senderType === "CLINIC" ? "clinic" : "provider"})</span>
                {r.thread ? <Link className="text-brand-700 hover:underline" href={`/admin/messages/${r.threadId}`}>{r.thread.clinicOrg.displayName} ↔ {r.thread.provider.displayName}</Link> : null}
                <span className="text-xs text-slate-400">{relative(r.createdAt)}</span>
              </div>
              <div className="flex flex-wrap gap-1.5">
                {r.reasons.map((x) => <Badge key={x} tone={x === "off-platform" || x === "ai" ? "red" : "amber"}>{x === "ai" ? "AI check" : humanize(x)}</Badge>)}
              </div>
              <p className="whitespace-pre-line rounded-xl bg-slate-50 p-3 text-slate-700">{r.body}</p>
              {r.aiReason ? <p className="text-xs text-slate-500">AI: {r.aiReason}</p> : null}
            </div>
          ))}
        </Card>
      ) : <Empty title="Nothing blocked yet" />}
    </>
  );
}
