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

export default async function Activity({ searchParams }: { searchParams: Promise<{ agent?: string; errors?: string; status?: string; feed?: string; ready?: string }> }) {
  const { actor } = await requireActor("admin");
  const f = await searchParams;
  const [act, comms, counts, up] = await Promise.all([growth.activity(actor, { agent: f.agent, errors: f.errors === "1" }), growth.communications(actor, { status: f.status }), growth.communicationCounts(actor), growth.upNext(actor, { limit: f.ready === "all" ? 0 : 100 })]);
  const total = Object.values(counts).reduce((a, b) => a + b, 0);
  const STATUS_HELP: Record<string, string> = {
    QUEUED: "Nothing queued. Only drafts you approved on Approvals wait here. In auto mode the agents write and send in one step inside the send window, so see Ready to go out above for what the next window will send.",
    PENDING_APPROVAL: "Nothing waiting for approval. Drafts appear here (and on Approvals) when an outreach agent is in review mode and switched on.",
    BLOCKED: "Nothing blocked.",
    FAILED: "No failed sends.",
    SENT: "Nothing sent yet.",
    RECEIVED: "No replies received yet.",
  };
  const chip = (href: string, label: string, on: boolean) => <Link key={href} href={href} className={`rounded-full px-3 py-1 text-xs ring-1 ${on ? "bg-brand-600 text-white ring-brand-600" : "ring-slate-200"}`}>{label}</Link>;
  return (
    <>
      <PageHeader title="Agent activity & communications" description="Every email and text the Growth agents sent, queued, blocked or are waiting to have approved (Communications, first), and the audit log of every agent action: what it acted on, the prompt version and model, the output, the send status, any human override, and errors. Context is stored by reference, never as raw personal data." />
      <GrowthTabs current="/admin/growth/activity" />
      <Card id="ready" className="mb-6 scroll-mt-20">
        <CardHeader
          title={`Ready to go out (${(up.clinic.total + up.provider.total + up.approved).toLocaleString()})`}
          description={`Researched prospects whose next email is due, in the order the agents will take them. ${up.windowOpen ? "The send window is open: these go out at the next agent run (every 15 minutes), up to today's limit." : up.sendAt ? `Next send window: ${dateTimeLabel(up.sendAt)} Eastern.` : "No send days are set."} Each email is written when it's sent, and the usual checks (unsubscribes, bounces, opt-outs) run again then.`}
        />
        {up.approved ? <p className="border-t border-slate-100 px-4 py-3 text-sm"><b>{up.approved.toLocaleString()} approved email{up.approved === 1 ? "" : "s"}</b> waiting to send (approved on Approvals; they go out in the send window). <Link className="text-brand-700" href="/admin/growth/activity?status=QUEUED#communications">See them</Link></p> : null}
        <p className="border-t border-slate-100 px-4 py-2 text-xs text-slate-500">Daily limit for automatic marketing emails: {up.cap.toLocaleString()} (Settings → Growth → &quot;Max new marketing emails per day&quot;), split between clinic and provider outreach. More prospects become due during the day as research finishes and follow-up waits end, so a day can send more than this list showed in the morning, up to that limit.</p>
        {([["Clinic outreach", up.clinic, up.mode.clinic], ["Provider recruitment", up.provider, up.mode.provider]] as const).map(([label, side, mode]) => (
          <div key={label} className="border-t border-slate-100">
            <p className="px-4 pt-3 text-sm font-medium">
              {label} · {!side.on ? <span className="text-amber-700">agent or marketing is off</span> : <>{side.total.toLocaleString()} due · {side.nextWindow.toLocaleString()} fit {up.windowOpen ? "today's" : "the next window's"} limit ({side.slots.toLocaleString()} slots){side.total > side.nextWindow ? ` · ${(side.total - side.nextWindow).toLocaleString()} on later days` : ""} · {mode === "auto" ? "sent automatically" : "become drafts for Approvals"}</>}
            </p>
            {side.total > side.rows.length ? <p className="px-4 text-xs text-slate-500">Showing the first {side.rows.length} of {side.total.toLocaleString()}. <Link className="text-brand-700" href="/admin/growth/activity?ready=all#ready">Show all</Link></p> : null}
            {side.rows.length ? (
              <Table>
                <thead><tr><Th>#</Th><Th>Prospect</Th><Th>Email</Th><Th>Next email</Th><Th>Goes out</Th></tr></thead>
                <tbody>
                  {side.rows.map((r, i) => (
                    <tr key={r.id}>
                      <Td className="text-xs tabular-nums">{i + 1}</Td>
                      <Td className="text-xs"><Link className="text-brand-700" href={r.kind === "CLINIC" ? `/admin/growth/prospects/${r.id}` : `/admin/growth/prospects/providers/${r.id}`}>{r.name}</Link><div className="text-slate-400">{r.where}</div></Td>
                      <Td className="text-xs">{r.email}</Td>
                      <Td className="text-xs">{r.step === 0 ? "First contact" : `Follow-up ${r.step}`}<div className="text-slate-400">{r.emailKey}</div></Td>
                      <Td className="text-xs">{r.nextWindow ? (up.windowOpen ? "Next run" : up.sendAt ? dateTimeLabel(up.sendAt) : "—") : <span className="text-slate-500">A later day (daily limit)</span>}</Td>
                    </tr>
                  ))}
                </tbody>
              </Table>
            ) : <p className="px-4 pb-3 pt-1 text-sm text-slate-500">{side.on ? "Nobody is due yet. Prospects appear here once research finds a valid email and their next step's wait is over." : "Switch the agent on (Growth → Agents) and marketing for this side (Growth → Settings) to send."}</p>}
          </div>
        ))}
      </Card>
      <Card id="communications" className="mb-6 scroll-mt-20">
        <CardHeader title="Communications" description="Every growth email and text: queued to send, waiting for approval, sent, blocked, failed, and replies. Newest first, last 200." action={<div className="flex flex-wrap gap-1">{["", "QUEUED", "PENDING_APPROVAL", "SENT", "BLOCKED", "FAILED", "RECEIVED"].map((s) => chip(`/admin/growth/activity${s ? `?status=${s}` : ""}#communications`, `${s ? humanize(s) : "All"} (${s ? counts[s] ?? 0 : total})`, (f.status ?? "") === s))}</div>} />
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
            {!comms.length ? <tr><Td colSpan={5} className="text-slate-500">{f.status ? STATUS_HELP[f.status] ?? "Nothing here." : "No communications yet."}</Td></tr> : null}
          </tbody>
        </Table>
      </Card>
      <h2 id="log" className="mb-2 scroll-mt-20 text-lg font-semibold">Agent activity log</h2>
      <div className="mb-3 flex flex-wrap gap-2">
        {chip("/admin/growth/activity#log", "All", !f.agent && !f.errors)}
        {chip("/admin/growth/activity?errors=1#log", "Errors only", f.errors === "1")}
        {chip("/admin/growth/activity?feed=1#log", "Feed with milestones", f.feed === "1")}
        {Object.keys(growth.AGENTS).map((k) => chip(`/admin/growth/activity?agent=${k}#log`, humanize(k), f.agent === k))}
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
    </>
  );
}
