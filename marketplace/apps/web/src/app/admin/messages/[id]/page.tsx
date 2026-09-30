import { messaging } from "@cm/services";
import { Badge } from "@/components/ui/badge";
import { Card } from "@/components/ui/card";
import { PageHeader } from "@/components/ui/misc";
import { relative } from "@/lib/format";
import { requireActor } from "@/lib/session";

export default async function AdminThread({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor("admin");
  const { id } = await params;
  const { thread, messages } = await messaging.threadMessages(actor, id);
  const blocked = (await messaging.blockedMessages(actor)).filter((b) => b.threadId === id);
  const all = [
    ...messages.map((m) => ({ id: m.id, at: m.createdAt, from: m.senderType, body: m.body, flagged: m.flagged, blocked: false })),
    ...blocked.map((b) => ({ id: b.id, at: b.createdAt, from: b.senderType, body: b.body, flagged: false, blocked: true })),
  ].sort((a, b) => +a.at - +b.at);
  return (
    <>
      <PageHeader eyebrow="Conversation (read-only)" title={`${thread.clinicName} ↔ ${thread.providerName}`} />
      <Card className="divide-y divide-slate-100">
        {all.map((m) => (
          <div key={m.id} className={`px-5 py-3 text-sm ${m.blocked ? "bg-red-50/60" : ""}`}>
            <div className="mb-1 flex items-center gap-2 text-xs text-slate-500">
              <span className="font-medium text-slate-700">{m.from === "CLINIC" ? thread.clinicName : thread.providerName}</span>
              {relative(m.at)}
              {m.blocked ? <Badge tone="red">Blocked — not delivered</Badge> : null}
              {m.flagged ? <Badge tone="amber">Flagged</Badge> : null}
            </div>
            <p className="whitespace-pre-line">{m.body}</p>
          </div>
        ))}
      </Card>
    </>
  );
}
