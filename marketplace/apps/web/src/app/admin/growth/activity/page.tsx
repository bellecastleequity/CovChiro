import Link from "next/link";
import { growth } from "@cm/services";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateTimeLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { GrowthTabs } from "../ui";
import { ActivityFeed } from "../panels";

export const metadata = { title: "Agent activity" };
export const dynamic = "force-dynamic";

export default async function Activity({ searchParams }: { searchParams: Promise<{ agent?: string; errors?: string; status?: string; feed?: string }> }) {
  const { actor } = await requireActor("admin");
  const f = await searchParams;
  const [act, comms] = await Promise.all([growth.activity(actor, { agent: f.agent, errors: f.errors === "1" }), growth.communications(actor, { status: f.status })]);
  const chip = (href: string, label: string, on: boolean) => <Link key={href} href={href} className={`rounded-full px-3 py-1 text-xs ring-1 ${on ? "bg-brand-600 text-white ring-brand-600" : "ring-slate-200"}`}>{label}</Link>;
  return (
    <>
      <PageHeader title="Agent activity" description="Audit log of every agent action: what it acted on, the prompt version and model, the output, the send status, any human override, and errors. Context is stored by reference, never as raw personal data." />
      <GrowthTabs current="/admin/growth/activity" />
      <div className="mb-3 flex flex-wrap gap-2">
        {chip("/admin/growth/activity", "All", !f.agent && !f.errors)}
        {chip("/admin/growth/activity?errors=1", "Errors only", f.errors === "1")}
        {chip("/admin/growth/activity?feed=1", "Feed with milestones", f.feed === "1")}
        {Object.keys(growth.AGENTS).map((k) => chip(`/admin/growth/activity?agent=${k}`, humanize(k), f.agent === k))}
      </div>
      {f.feed === "1" ? <div className="mb-6"><ActivityFeed limit={80} title="Feed: agent activity and marketplace milestones" /></div> : null}
      <Card>
        <Table>
          <thead><tr><Th>When</Th><Th>Agent</Th><Th>Action</Th><Th>Entity</Th><Th>Prompt · model</Th><Th>Result</Th></tr></thead>
          <tbody>
            {act.map((a) => (
              <tr key={a.id}>
                <Td className="whitespace-nowrap text-xs">{dateTimeLabel(a.createdAt)}</Td><Td className="text-xs">{humanize(a.agent)}</Td><Td className="text-xs">{humanize(a.action)}</Td>
                <Td className="text-xs">{a.entityType === "PROSPECT" && a.entityId ? <Link className="text-brand-700 hover:underline" href={`/admin/growth/prospects/${a.entityId}`}>prospect</Link> : a.entityType === "PROVIDER" && a.entityId ? <Link className="text-brand-700 hover:underline" href={`/admin/providers/${a.entityId}`}>provider</Link> : (a.entityType ?? "—").toLowerCase()}</Td>
                <Td className="font-mono text-xs">{[a.promptKey ? `${a.promptKey} v${a.promptVersion}` : null, a.model].filter(Boolean).join(" · ") || "—"}</Td>
                <Td className="max-w-md text-xs">{a.sendStatus ? <StatusBadge status={a.sendStatus.toUpperCase()} /> : null} {a.humanOverrideBy ? <span className="text-brand-700">by a person </span> : null}<span className={a.error ? "text-red-700" : "text-slate-600"}>{(a.error ?? a.output ?? "").slice(0, 220)}</span></Td>
              </tr>
            ))}
            {!act.length ? <tr><Td colSpan={6} className="text-slate-500">No activity yet.</Td></tr> : null}
          </tbody>
        </Table>
      </Card>
      <Card className="mt-6">
        <CardHeader title="Communications" action={<div className="flex gap-1">{["", "SENT", "BLOCKED", "FAILED", "PENDING_APPROVAL", "RECEIVED"].map((s) => chip(`/admin/growth/activity${s ? `?status=${s}` : ""}`, s ? humanize(s) : "All", (f.status ?? "") === s))}</div>} />
        <Table>
          <thead><tr><Th>When</Th><Th>To</Th><Th>Message</Th><Th>Agent</Th><Th>Status</Th></tr></thead>
          <tbody>
            {comms.map((c) => (
              <tr key={c.id}>
                <Td className="whitespace-nowrap text-xs">{dateTimeLabel(c.createdAt)}</Td>
                <Td className="text-xs">{c.toAddress ?? "—"}<div className="text-slate-400">{c.entityType.toLowerCase()} · {c.channel.toLowerCase()} {c.direction === "IN" ? "in" : "out"}</div></Td>
                <Td className="text-xs">{c.subject ?? c.promptKey ?? "—"}{c.promptKey ? <div className="text-slate-400">{c.promptKey} v{c.promptVersion}</div> : null}</Td>
                <Td className="text-xs">{c.createdById ? "a person" : humanize(c.agent ?? "")}</Td>
                <Td><StatusBadge status={c.status} />{c.blockReason ? <div className="text-xs text-red-700">{humanize(c.blockReason)}</div> : null}{c.error ? <div className="text-xs text-red-700">{c.error}</div> : null}</Td>
              </tr>
            ))}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
