import Link from "next/link";
import { growth } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { dateTimeLabel } from "@/lib/format";
import { cn } from "@/lib/cn";
import { agentAction, marketingAction, pauseAction } from "./actions";

/** The big PAUSE OUTBOUND AUTOMATION button (header action on Growth pages). */
export function PauseButton({ paused }: { paused: boolean }) {
  return (
    <ActionForm action={pauseAction} successMessage={false} confirm={paused ? undefined : "Pause every automated growth email and text now? Discovery, research, scoring and the marketplace keep running."}>
      <input type="hidden" name="paused" value={paused ? "false" : "true"} />
      <SubmitButton variant={paused ? "primary" : "danger"} size="lg">{paused ? "Resume outbound automation" : "PAUSE OUTBOUND AUTOMATION"}</SubmitButton>
    </ActionForm>
  );
}

const SWITCHES: [growth.AgentKey, string, string][] = [
  ["providerOutreach", "Provider outreach", "Recruitment emails to discovered providers"],
  ["clinicOutreach", "Clinic outreach", "Educational emails to clinic prospects"],
  ["providerCredentialing", "Credential reminders", "License and malpractice follow-ups"],
  ["providerActivation", "Activation messages", "“You're coverage-ready” next steps"],
  ["providerReactivation", "Reactivation", "Nudges to idle coverage-ready providers"],
];

/** Individual outbound switches (each is an agent switch) plus the two audience switches. */
export async function OutboundSwitches() {
  const s = await growth.overviewSettings();
  return (
    <Card>
      <CardHeader title="Outbound switches" description="Each stops one kind of automated message. The marketing switches cover a whole audience; the pause button stops everything automated." />
      <div className="grid gap-px bg-slate-100 sm:grid-cols-2 xl:grid-cols-4">
        {([["provider", "Provider marketing", s.providerMarketing], ["clinic", "Clinic marketing", s.clinicMarketing]] as const).map(([audience, label, on]) => (
          <ActionForm key={audience} action={marketingAction} successMessage={false} className="flex items-center justify-between gap-3 bg-white px-4 py-3" confirm={on ? `Turn off ${label.toLowerCase()}? Queued automated messages wait until it's back on.` : undefined}>
            <input type="hidden" name="audience" value={audience} />
            <input type="hidden" name="on" value={on ? "false" : "true"} />
            <div><div className="text-sm font-medium">{label}</div><div className="text-xs text-slate-500">Everything automated to {audience}s</div></div>
            <SubmitButton size="sm" variant={on ? "outline" : "primary"}>{on ? "On" : "Off"}</SubmitButton>
          </ActionForm>
        ))}
        {SWITCHES.map(([key, label, help]) => {
          const on = !!s.agents[key];
          const launch = key === "providerOutreach" || key === "clinicOutreach";
          const mode = key === "providerOutreach" ? s.providerOutreachMode : s.outreachMode;
          return (
            <ActionForm key={key} action={agentAction} successMessage={false} className="flex items-center justify-between gap-3 bg-white px-4 py-3"
              confirm={launch && !on ? `Turn on ${label.toLowerCase()}? Mode: ${mode === "auto" ? "AUTO: emails send when compliance passes" : "review: drafts wait in Approvals"}.` : undefined}>
              <input type="hidden" name="key" value={key} />
              <input type="hidden" name="on" value={on ? "false" : "true"} />
              <div><div className="text-sm font-medium">{label} {launch ? <Badge className="ml-1">{mode}</Badge> : null}</div><div className="text-xs text-slate-500">{help}</div></div>
              <SubmitButton size="sm" variant={on ? "outline" : "primary"}>{on ? "On" : "Off"}</SubmitButton>
            </ActionForm>
          );
        })}
      </div>
    </Card>
  );
}

const KIND_TONE: Record<string, string> = { error: "bg-red-500", milestone: "bg-emerald-500", agent: "bg-brand-500" };

export async function ActivityFeed({ agent, kind, limit = 25, title = "Activity" }: { agent?: string; kind?: string; limit?: number; title?: string }) {
  const items = await growth.activityFeed({ agent, kind, limit });
  return (
    <Card>
      <CardHeader title={title} action={<Link href="/admin/growth/activity" className="text-sm text-brand-700">All activity →</Link>} />
      <ul className="divide-y divide-slate-100">
        {items.length ? items.map((i, n) => (
          <li key={n} className="flex gap-3 px-5 py-2.5 text-sm">
            <span className={cn("mt-1.5 size-2 shrink-0 rounded-full", KIND_TONE[i.kind] ?? "bg-slate-400")} />
            <div className="min-w-0 flex-1">
              <div className="text-xs text-slate-400">{dateTimeLabel(i.at)}</div>
              {i.link ? <Link href={i.link} className="hover:text-brand-700">{i.text}</Link> : <span>{i.text}</span>}
              {i.error ? <div className="truncate text-xs text-red-700">{i.error}</div> : null}
            </div>
          </li>
        )) : <li className="px-5 py-4 text-sm text-slate-500">Nothing yet.</li>}
      </ul>
    </Card>
  );
}
