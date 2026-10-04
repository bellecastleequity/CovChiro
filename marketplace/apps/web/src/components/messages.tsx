import { brand } from "@cm/config";
import Link from "next/link";
import { MessageSquare } from "lucide-react";
import { messaging, type Actor } from "@cm/services";
import { Card } from "@/components/ui/card";
import { Empty, PageHeader } from "@/components/ui/misc";
import { cn } from "@/lib/cn";
import { relative } from "@/lib/format";
import { Composer } from "./composer";
import type { ActionState } from "./ui/action-form";

export async function ThreadList({ actor, base }: { actor: Actor; base: string }) {
  const threads = await messaging.listThreads(actor);
  const provider = actor.role === "PROVIDER";
  return (
    <>
      <PageHeader title="Messages" description="Contact details are shared through the platform. Do not include patient information." />
      {threads.length ? (
        <Card className="divide-y divide-slate-100">
          {threads.map((t) => (
            <Link key={t.id} href={`${base}/${t.id}`} className="flex items-center gap-3 px-5 py-4 hover:bg-slate-50">
              <div className="grid size-10 shrink-0 place-items-center rounded-full bg-brand-50 text-sm font-semibold text-brand-700">{(provider ? t.clinicName : t.providerName).slice(0, 1)}</div>
              <div className="min-w-0 flex-1">
                <div className="flex items-center justify-between gap-2">
                  <span className={cn("truncate text-sm", t.unread ? "font-semibold" : "font-medium")}>{provider ? t.clinicName : t.providerName}</span>
                  <span className="shrink-0 text-xs text-slate-400">{relative(t.lastMessageAt)}</span>
                </div>
                <div className="truncate text-sm text-slate-500">{t.last?.body ?? "No messages yet"}</div>
              </div>
              {t.unread ? <span className="rounded-full bg-brand-600 px-1.5 text-xs font-semibold text-white">{t.unread}</span> : null}
            </Link>
          ))}
        </Card>
      ) : (
        <Empty title="No conversations yet" icon={<MessageSquare className="size-6" />}>Conversations start from a shift application or invitation.</Empty>
      )}
    </>
  );
}

export async function ThreadView({ actor, threadId, send }: { actor: Actor; threadId: string; send: (prev: ActionState, fd: FormData) => Promise<ActionState> }) {
  const { thread, messages, side } = await messaging.threadMessages(actor, threadId);
  return (
    <>
      <PageHeader back={{ href: side === "PROVIDER" ? "/provider/messages" : "/clinic/messages", label: "Messages" }} title={side === "PROVIDER" ? thread.clinicName : thread.providerName} description={`Keep everything on ${brand().name}: messages with phone numbers, emails, links, social handles or offers to work off the platform aren't sent. ${thread.confirmed ? "The address, front desk number and arrival notes are on each booking." : "Booking details are shared once a shift is confirmed."}`} />
      <Card className="flex h-[65dvh] flex-col">
        <div className="flex-1 space-y-3 overflow-y-auto p-4">
          {messages.map((m) => {
            const mine = m.senderType === side;
            return (
              <div key={m.id} className={cn("flex", mine ? "justify-end" : "justify-start")}>
                <div className={cn("max-w-[80%] rounded-2xl px-3.5 py-2 text-sm", mine ? "rounded-br-sm bg-brand-600 text-white" : "rounded-bl-sm bg-slate-100 text-slate-900")}>
                  <p className="whitespace-pre-line break-words">{m.body}</p>
                  <div className={cn("mt-1 text-[10px]", mine ? "text-brand-100" : "text-slate-400")}>{relative(m.createdAt)}{m.redacted ? " · contact removed" : ""}</div>
                </div>
              </div>
            );
          })}
          {!messages.length ? <p className="py-10 text-center text-sm text-slate-400">Say hello 👋</p> : null}
        </div>
        {side !== "ADMIN" ? <Composer threadId={threadId} action={send} /> : null}
      </Card>
    </>
  );
}
