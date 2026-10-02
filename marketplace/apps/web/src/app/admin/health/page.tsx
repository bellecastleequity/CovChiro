import Link from "next/link";
import { CheckCircle2 } from "lucide-react";
import { absoluteUrl, health } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Alert, PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateTimeLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { healthAction } from "../actions";

export const metadata = { title: "System health" };
export const dynamic = "force-dynamic";

const ago = (d: Date | null) => {
  if (!d) return "never";
  const m = Math.round((Date.now() - +d) / 60_000);
  return m < 1 ? "just now" : m < 90 ? `${m} min ago` : m < 2880 ? `${Math.round(m / 60)} h ago` : `${Math.round(m / 1440)} days ago`;
};

export default async function HealthPage() {
  const { actor } = await requireActor("admin");
  const { facts, issues, lastRun } = await health.healthBoard(actor);
  const failingJobs = facts.jobs.filter((j) => j.failStreak > 0).sort((a, b) => b.failStreak - a.failStreak);
  const ch = (label: string, c: typeof facts.email) =>
    c ? (c.failStreak ? <Badge tone="red">{label}: {c.failStreak} failing</Badge> : <Badge tone="green">{label}: OK · last sent {ago(c.lastOkAt)}</Badge>) : <Badge>{label}: nothing sent yet</Badge>;

  return (
    <>
      <PageHeader
        title="System health"
        description="Checked every 5 minutes. When something stops or is about to stop working, every admin gets an email (and a text for critical problems) with what's wrong and how to fix it, a reminder while it lasts, and a note when it's resolved."
        actions={
          <div className="flex flex-wrap gap-2">
            <ActionForm action={healthAction}><input type="hidden" name="what" value="run" /><SubmitButton size="sm">Check now</SubmitButton></ActionForm>
            <ActionForm action={healthAction}><input type="hidden" name="what" value="test" /><SubmitButton size="sm" variant="outline">Send test alert</SubmitButton></ActionForm>
          </div>
        }
      />

      {!issues.length ? (
        <Alert tone="success" className="mb-6" title="Everything is working">Background jobs, email, texts, AI, Stripe, backups and the database all look healthy.</Alert>
      ) : (
        <div className="mb-6 space-y-3">
          {issues.map((i) => (
            <Card key={i.key} className={i.severity === "critical" ? "border-red-300" : "border-amber-300"}>
              <CardBody className="space-y-2">
                <div className="flex flex-wrap items-center gap-2">
                  <Badge tone={i.severity === "critical" ? "red" : "amber"}>{i.severity === "critical" ? "Critical" : "Warning"}</Badge>
                  <span className="font-semibold text-slate-900">{i.title}</span>
                  {i.since ? <span className="text-xs text-slate-500">since {dateTimeLabel(i.since)}{i.lastAlertAt ? ` · last emailed ${ago(i.lastAlertAt)}` : ""}</span> : null}
                </div>
                <p className="text-sm text-slate-700"><span className="font-medium">What&apos;s happening:</span> {i.detail}</p>
                <p className="text-sm text-slate-700"><span className="font-medium">How to fix it:</span> {i.remedy}</p>
                {i.link && i.link !== "/admin/health" ? <Link href={i.link} className="text-sm font-medium text-brand-700 hover:underline">Open →</Link> : null}
              </CardBody>
            </Card>
          ))}
        </div>
      )}

      <div className="grid gap-6 lg:grid-cols-2">
        <Card>
          <CardHeader title="Signals" description={`Last full check ${ago(lastRun)}.`} />
          <CardBody className="space-y-3 text-sm">
            <div className="flex flex-wrap gap-2">
              {facts.lastTickAt && Date.now() - +facts.lastTickAt < 10 * 60_000 ? <Badge tone="green">Background jobs: running · {ago(facts.lastTickAt)}</Badge> : <Badge tone="red">Background jobs: last ran {ago(facts.lastTickAt)}</Badge>}
              {ch("Email", facts.email)}
              {ch("Texts", facts.sms)}
              {facts.aiErrors.length ? <Badge tone="amber">AI: {facts.aiErrors.length} failed call(s) in 6 h</Badge> : <Badge tone="green">AI: no failures in 6 h</Badge>}
              <Badge tone={facts.aiBudget.dayPct >= 100 ? "red" : facts.aiBudget.dayPct >= 90 ? "amber" : "gray"}>AI budget today {Math.round(facts.aiBudget.dayPct)}% · month {Math.round(facts.aiBudget.monthPct)}%</Badge>
              {facts.stripeFailures.length ? <Badge tone="amber">Stripe: {facts.stripeFailures.length} failure(s) in 24 h</Badge> : <Badge tone="green">Stripe: no failures in 24 h</Badge>}
              <Badge tone={facts.backups.lastOkAt ? "green" : "amber"}>Last backup {ago(facts.backups.lastOkAt)}</Badge>
              {facts.missingMigrations.length ? <Badge tone="red">Database update needed</Badge> : <Badge tone="green">Database up to date</Badge>}
            </div>
            {facts.aiErrors[0] ? <p className="text-xs text-slate-500">Latest AI error ({facts.aiErrors[0].provider}, {ago(facts.aiErrors[0].at)}): {facts.aiErrors[0].error.slice(0, 200)}</p> : null}
            {facts.email?.lastError && facts.email.failStreak ? <p className="text-xs text-slate-500">Latest email error: {facts.email.lastError.slice(0, 200)}</p> : null}
          </CardBody>
        </Card>

        <Card>
          <CardHeader title="Background jobs with errors" description="A job alerts after failing several runs in a row; one-off errors that fix themselves don't." />
          {!failingJobs.length ? (
            <CardBody><p className="flex items-center gap-2 text-sm text-emerald-700"><CheckCircle2 className="size-4" /> No job is failing.</p></CardBody>
          ) : (
            <Table>
              <thead><tr><Th>Job</Th><Th>Fails in a row</Th><Th>Last error</Th><Th></Th></tr></thead>
              <tbody>
                {failingJobs.map((j) => (
                  <tr key={j.name}>
                    <Td><span className="font-medium">{j.name}</span>{j.critical ? <Badge tone="red" className="ml-1">core</Badge> : null}</Td>
                    <Td>{j.failStreak}</Td>
                    <Td className="max-w-xs text-xs text-slate-600">{(j.lastError ?? "").slice(0, 200)} <span className="text-slate-400">· {ago(j.lastErrorAt)}</span></Td>
                    <Td><ActionForm action={healthAction}><input type="hidden" name="what" value="clear" /><input type="hidden" name="job" value={j.name} /><SubmitButton size="sm" variant="ghost">Clear</SubmitButton></ActionForm></Td>
                  </tr>
                ))}
              </tbody>
            </Table>
          )}
        </Card>
      </div>

      <Card className="mt-6">
        <CardHeader title="Outside watchdog (recommended)" description="If the whole site or its hosting goes down, nothing inside it can email you. A free uptime monitor covers that." />
        <CardBody className="space-y-2 text-sm text-slate-700">
          <ol className="list-decimal space-y-1 pl-5">
            <li>Create a free account at UptimeRobot (or any uptime monitor).</li>
            <li>Add an HTTP(s) monitor for <code className="rounded bg-slate-100 px-1">{absoluteUrl("/api/health")}</code>, every 5 minutes, alerting your email and phone.</li>
            <li>It shows DOWN when the site is unreachable or a critical problem is open (HTTP 503). Each check also runs these health checks, so alert emails still go out even if the background cron has stopped.</li>
          </ol>
          <p className="text-xs text-slate-500">Alert recipients, texting and timing: <Link href="/admin/settings#s-health.enabled" className="text-brand-700 hover:underline">Settings → System health</Link>.</p>
        </CardBody>
      </Card>
    </>
  );
}
