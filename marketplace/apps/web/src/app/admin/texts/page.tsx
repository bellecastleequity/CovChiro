import Link from "next/link";
import { getSettings, texts } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Textarea } from "@/components/ui/form";
import { Alert, PageHeader } from "@/components/ui/misc";
import { relative } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { cn } from "@/lib/cn";
import { markTextsReadAction, sendTextAction } from "./actions";

export const metadata = { title: "Texts" };
export const dynamic = "force-dynamic";

export default async function AdminTexts({ searchParams }: { searchParams: Promise<{ p?: string; new?: string }> }) {
  const { actor } = await requireActor("admin");
  const sp = await searchParams;
  const [list, st] = await Promise.all([texts.conversations(actor), getSettings()]);
  const selected = sp.p ?? (sp.new ? null : list[0]?.phone ?? null);
  const t = selected ? await texts.thread(actor, selected) : null;
  if (t && t.messages.some((m) => m.direction === "IN" && !m.readAt)) await texts.markRead(actor, t.phone);
  const number = st["site.phoneLabel"] || st["site.phone"];
  return (
    <div>
      <PageHeader
        title="Texts"
        description={`Texts to ${number || "the business number"} that aren't shift-offer replies, and your replies from that number. Shift offers (YES/NO + code) and STOP/HELP are still handled automatically.`}
        actions={<Link href="/admin/texts?new=1" className="rounded-xl bg-brand-600 px-4 py-2 text-sm font-medium text-white">New text</Link>}
      />
      <div className="grid gap-4 lg:grid-cols-[minmax(0,320px)_1fr]">
        <Card>
          <CardHeader title={`${list.length} conversation${list.length === 1 ? "" : "s"}`} />
          <ul className="divide-y divide-slate-100">
            {list.length ? null : <li className="px-5 py-6 text-sm text-slate-500">No texts yet. When someone texts {number || "the business number"}, it shows up here.</li>}
            {list.map((c) => (
              <li key={c.phone}>
                <Link href={`/admin/texts?p=${encodeURIComponent(c.phone)}`} className={cn("block px-5 py-3 hover:bg-slate-50", c.phone === t?.phone && "bg-brand-50/70")}>
                  <div className="flex items-center justify-between gap-2">
                    <span className="truncate font-medium text-slate-900">{c.name ?? c.label}</span>
                    {c.unread ? <Badge tone="amber">{c.unread} new</Badge> : <span className="text-xs text-slate-400">{relative(c.last.createdAt)}</span>}
                  </div>
                  {c.name ? <div className="text-xs text-slate-500">{c.label}</div> : null}
                  <div className="mt-0.5 truncate text-sm text-slate-600">{c.last.direction === "OUT" ? "You: " : ""}{c.last.body}</div>
                </Link>
              </li>
            ))}
          </ul>
        </Card>
        {t ? (
          <Card>
            <CardHeader
              title={t.who.name ?? t.label}
              description={t.who.name ? `${t.who.kind} · ${t.label}` : "Not linked to an account"}
              action={
                <div className="flex gap-2">
                  <a href={`tel:${t.phone}`} className="rounded-xl border border-slate-300 px-3 py-1.5 text-sm font-medium text-slate-700">Call</a>
                  <ActionForm action={markTextsReadAction}><input type="hidden" name="phone" value={t.phone} /><SubmitButton size="sm" variant="outline">Mark read</SubmitButton></ActionForm>
                </div>
              }
            />
            <CardBody className="space-y-3">
              {t.stopped ? <Alert tone="warning">This number texted STOP, so it can&apos;t be texted until they text START.</Alert> : null}
              <div className="max-h-[55vh] space-y-2 overflow-y-auto">
                {t.messages.map((m) => (
                  <div key={m.id} className={m.direction === "OUT" ? "ml-10 rounded-2xl bg-brand-600 px-4 py-2.5 text-white" : "mr-10 rounded-2xl bg-slate-100 px-4 py-2.5 text-slate-900"}>
                    <p className="whitespace-pre-line text-sm">{m.body}</p>
                    <div className={cn("mt-1 text-[11px]", m.direction === "OUT" ? "text-white/70" : "text-slate-500")}>
                      {m.direction === "OUT" ? (m.authorName ?? "Automatic reply") : "Them"} · {relative(m.createdAt)}
                      {m.status === "FAILED" ? ` · not sent: ${m.error ?? "error"}` : ""}
                    </div>
                  </div>
                ))}
              </div>
              {t.stopped ? null : (
                <ActionForm action={sendTextAction} className="space-y-2" resetOnSuccess>
                  <input type="hidden" name="phone" value={t.phone} />
                  <Field label={`Reply from ${number || "the business number"}`}><Textarea name="body" required rows={3} maxLength={600} /></Field>
                  <SubmitButton>Send text</SubmitButton>
                </ActionForm>
              )}
            </CardBody>
          </Card>
        ) : (
          <Card>
            <CardHeader title="New text" description={`Starts a conversation from ${number || "the business number"}. Only text people who gave you their number for this.`} />
            <CardBody>
              <ActionForm action={sendTextAction} className="space-y-3" resetOnSuccess>
                <Field label="Mobile number"><Input name="phone" required placeholder="(407) 555-0100" inputMode="tel" /></Field>
                <Field label="Message"><Textarea name="body" required rows={3} maxLength={600} /></Field>
                <SubmitButton>Send text</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        )}
      </div>
    </div>
  );
}
