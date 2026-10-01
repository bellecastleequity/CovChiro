import Link from "next/link";
import { growth } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateTimeLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { agentAction } from "../actions";
import { OutboundSwitches, PauseButton } from "../panels";
import { GrowthTabs, usd } from "../ui";

export const metadata = { title: "AI agents" };
export const dynamic = "force-dynamic";

const GROUPS: [string, growth.AgentKey[]][] = [
  ["Provider acquisition", ["providerDiscovery", "contactDiscovery", "providerOutreach", "providerRecruitment", "providerCredentialing", "providerActivation", "providerReactivation", "matching"]],
  ["Clinic acquisition", ["clinicProspecting", "clinicOutreach", "clinicConversation", "clinicOnboarding", "signupRecovery", "leadScoring"]],
  ["Content, analytics & people", ["content", "analytics", "escalation"]],
];

export default async function Agents() {
  await requireActor("admin");
  const [rows, s] = await Promise.all([growth.agentBoard(), growth.overviewSettings()]);
  const byKey = new Map(rows.map((r) => [r.key, r]));
  return (
    <>
      <PageHeader title="AI agents" description="Each agent does one job on a schedule in the background worker; it doesn't need this page open. Switch an agent off and its queue simply waits. Costs are this month's logged AI spend." actions={<PauseButton paused={s.paused} />} />
      <GrowthTabs current="/admin/growth/agents" />
      <div className="mb-6"><OutboundSwitches /></div>
      {GROUPS.map(([title, keys]) => (
        <Card key={title} className="mb-6">
          <CardHeader title={title} />
          <Table>
            <thead><tr><Th>Agent</Th><Th>Status</Th><Th className="text-right">Today</Th><Th className="text-right">Waiting</Th><Th>Last run</Th><Th className="text-right">Errors 24h</Th><Th>AI model</Th><Th className="text-right">Cost (month)</Th><Th /></tr></thead>
            <tbody>
              {keys.map((k) => byKey.get(k)).filter((r): r is NonNullable<typeof r> => !!r).map((r) => (
                <tr key={r.key} className="align-top">
                  <Td><div className="font-medium">{r.label}</div><div className="max-w-sm text-xs text-slate-500">{r.description}</div></Td>
                  <Td>
                    <ActionForm action={agentAction} successMessage={false}>
                      <input type="hidden" name="key" value={r.key} />
                      <input type="hidden" name="on" value={r.on ? "false" : "true"} />
                      <div className="flex flex-col items-start gap-1">
                        {r.on ? (s.paused && ["providerOutreach", "clinicOutreach", "providerCredentialing", "providerActivation", "providerReactivation", "providerRecruitment", "clinicOnboarding", "signupRecovery"].includes(r.key) ? <Badge tone="amber">PAUSED</Badge> : <Badge tone="green">ACTIVE</Badge>) : <Badge>OFF</Badge>}
                        <SubmitButton size="sm" variant="ghost">{r.on ? "Turn off" : "Turn on"}</SubmitButton>
                      </div>
                    </ActionForm>
                  </Td>
                  <Td className="text-right tabular-nums">{r.processedToday}</Td>
                  <Td className="text-right tabular-nums">{r.waiting ?? "—"}</Td>
                  <Td className="text-xs">{r.lastRun ? dateTimeLabel(r.lastRun) : "—"}</Td>
                  <Td className="text-right tabular-nums">{r.errors24h ? <Link href={`/admin/growth/activity?agent=${r.key}&errors=1`} className="text-red-700 underline">{r.errors24h}</Link> : 0}</Td>
                  <Td className="font-mono text-xs">{r.model}</Td>
                  <Td className="text-right tabular-nums">{usd(Math.round(r.costMonthCents))}</Td>
                  <Td className="whitespace-nowrap text-xs"><Link href={`/admin/growth/activity?agent=${r.key}`} className="text-brand-700">Logs</Link> · <Link href="/admin/growth/settings" className="text-brand-700">Configure</Link></Td>
                </tr>
              ))}
            </tbody>
          </Table>
        </Card>
      ))}
    </>
  );
}
