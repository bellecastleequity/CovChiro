import Link from "next/link";
import { growth } from "@cm/services";
import { ActionForm } from "@/components/ui/action-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { Empty, PageHeader } from "@/components/ui/misc";
import { dateTimeLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { blockSenderAction, escalationAction, escalationSpamAction, unblockSenderAction } from "../actions";
import { SubmitButton } from "@/components/ui/action-form";
import { Select } from "@/components/ui/form";
import { CardHeader } from "@/components/ui/card";
import { spam } from "@cm/services";
import { GrowthTabs } from "../ui";

export const metadata = { title: "Leads & conversations" };
export const dynamic = "force-dynamic";

const entityLink = (type: string, id: string | null) =>
  !id ? null : type === "PROVIDER_PROSPECT" ? `/admin/growth/prospects/providers/${id}` : type === "MARKET" ? `/admin/growth/markets/${id}` : type === "PROSPECT" ? `/admin/growth/prospects/${id}` : type === "CLINIC" ? `/admin/clinics/${id}` : type === "PROVIDER" ? `/admin/providers/${id}` : type === "SHIFT" ? `/admin/shifts/${id}` : null;

const SIDES: Record<string, string[]> = { providers: ["PROVIDER_PROSPECT", "PROVIDER"], clinics: ["PROSPECT", "CLINIC"], markets: ["MARKET", "SHIFT"] };

const SPAM_LABEL: Record<string, string> = { solicitation: "Sales pitch", spam: "Spam" };

export default async function Escalations({ searchParams }: { searchParams: Promise<{ all?: string; side?: string; view?: string }> }) {
  const { actor } = await requireActor("admin");
  const sp = await searchParams;
  const all = sp.all === "1";
  const spamView = sp.view === "spam";
  const [list, blocked, spamWeek] = await Promise.all([
    growth.escalations(actor, spamView ? "spam" : all ? "all" : "open"),
    spamView ? spam.blockedSenders(actor) : Promise.resolve([]),
    spam.spamCounts(new Date(Date.now() - 7 * 86_400_000)),
  ]);
  const rows = list.filter((e) => !sp.side || (SIDES[sp.side] ?? []).includes(e.entityType)).sort((a, b) => Number(b.intentLevel === "HIGH") - Number(a.intentLevel === "HIGH"));
  const chip = (side: string | undefined, label: string) => <Link key={label} href={`/admin/growth/escalations?${new URLSearchParams({ ...(side ? { side } : {}), ...(all ? { all: "1" } : {}) })}`} className={`rounded-full px-3 py-1 text-xs ring-1 ${sp.side === side ? "bg-brand-600 text-white ring-brand-600" : "ring-slate-200"}`}>{label}</Link>;
  return (
    <>
      <PageHeader title="Leads / Conversations" description="High-intent leads and conversations an agent handed to a person instead of improvising: interested providers and clinics, questions the knowledge base doesn't cover, legal, payment, safety or clinical-scope topics, markets short of providers, and open shifts with no eligible provider. High intent first." actions={<Link href={all ? "/admin/growth/escalations" : "/admin/growth/escalations?all=1"} className={buttonClass("outline", "sm")}>{all ? "Open only" : "Include resolved"}</Link>} />
      <GrowthTabs current="/admin/growth/escalations" />
      <div className="mb-4 flex flex-wrap items-center gap-2">
        {chip(undefined, "All")}{chip("providers", "Provider leads")}{chip("clinics", "Clinic leads")}{chip("markets", "Markets & shifts")}
        <Link href={spamView ? "/admin/growth/escalations" : "/admin/growth/escalations?view=spam"} className={`rounded-full px-3 py-1 text-xs ring-1 ${spamView ? "bg-slate-700 text-white ring-slate-700" : "ring-slate-200"}`}>Spam · {spamWeek.questions} this week</Link>
        <span className="ml-2 text-xs text-slate-500">Also: <Link href="/admin/growth/sales" className="text-brand-700">Sales queue</Link> · <Link href="/admin/growth/approvals" className="text-brand-700">Approvals</Link></span>
      </div>
      {spamView ? (
        <p className="mb-4 rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-600">Website questions the spam filter or the AI filed as sales pitches or spam. Nobody was notified and nothing was sent to them. They&apos;re deleted automatically after the retention period (Settings → Spam). Spam from the offer, waitlist and contact forms is under <Link href="/admin/leads?spam=1" className="text-brand-700">Leads → Spam</Link>.</p>
      ) : null}
      {!rows.length ? <Empty title={spamView ? "Nothing in Spam." : "No escalations."} /> : (
        <div className="space-y-3">
          {rows.map((e) => {
            const href = entityLink(e.entityType, e.entityId);
            return (
              <Card key={e.id}>
                <CardBody>
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div>
                      <div className="font-semibold">{href ? <Link href={href} className="hover:text-brand-700">{e.entityLabel}</Link> : e.entityLabel}</div>
                      <div className="text-sm text-slate-700">{e.reason}</div>
                    </div>
                    <div className="flex gap-1.5">{e.spamCategory ? <Badge tone="gray">{SPAM_LABEL[e.spamCategory] ?? "Spam"}</Badge> : <Badge tone="amber">{humanize(e.reasonCode)}</Badge>}{e.intentLevel ? <Badge tone="red">{e.intentLevel} intent</Badge> : null}<StatusBadge status={e.status} /></div>
                  </div>
                  {e.summary ? <div className="mt-3 rounded-lg bg-slate-50 p-3 text-sm text-slate-700"><div className="text-xs font-medium uppercase tracking-wide text-slate-500">AI summary</div><p className="whitespace-pre-wrap">{e.summary}</p></div> : null}
                  {e.recommendedAction ? <p className="mt-2 text-sm"><span className="font-medium">Suggested next action:</span> {e.recommendedAction}</p> : null}
                  <p className="mt-1 text-xs text-slate-500">{dateTimeLabel(e.createdAt)}{e.resolution ? ` · ${e.resolution}` : ""}{e.spamReasons.length ? ` · Why: ${e.spamReasons.join(", ")}` : ""}</p>
                  {e.spamCategory ? (
                    <div className="mt-3 flex flex-wrap gap-2">
                      <ActionForm action={escalationSpamAction} successMessage={false}><input type="hidden" name="id" value={e.id} /><input type="hidden" name="spam" value="false" /><SubmitButton size="sm" variant="outline">Not spam</SubmitButton></ActionForm>
                      {e.entityType === "QUESTION" ? (
                        <ActionForm action={escalationSpamAction} className="flex gap-2"><input type="hidden" name="id" value={e.id} /><input type="hidden" name="spam" value="true" />
                          <Select name="block" defaultValue="EMAIL" className="w-40"><option value="EMAIL">Block this sender</option><option value="DOMAIN">Block their domain</option></Select>
                          <SubmitButton size="sm" variant="ghost">Block</SubmitButton>
                        </ActionForm>
                      ) : null}
                    </div>
                  ) : e.entityType === "QUESTION" && e.status !== "RESOLVED" ? (
                    <ActionForm action={escalationSpamAction} className="mt-3 flex flex-wrap gap-2" confirm="Move this to Spam?"><input type="hidden" name="id" value={e.id} /><input type="hidden" name="spam" value="true" />
                      <Select name="block" defaultValue="" className="w-48"><option value="">Mark spam only</option><option value="EMAIL">Mark spam + block sender</option><option value="DOMAIN">Mark spam + block domain</option></Select>
                      <SubmitButton size="sm" variant="outline">Mark spam</SubmitButton>
                    </ActionForm>
                  ) : null}
                  {e.status !== "RESOLVED" ? (
                    <ActionForm action={escalationAction} className="mt-3 flex flex-wrap gap-2">
                      <input type="hidden" name="id" value={e.id} />
                      <Input name="resolution" placeholder="Resolution note (optional)" className="w-72" />
                      {e.status === "OPEN" ? <button name="status" value="IN_PROGRESS" className={buttonClass("outline", "sm")}>Working on it</button> : null}
                      <button name="status" value="RESOLVED" className={buttonClass("primary", "sm")}>Resolve</button>
                    </ActionForm>
                  ) : null}
                </CardBody>
              </Card>
            );
          })}
        </div>
      )}
      {spamView ? (
        <Card className="mt-6">
          <CardHeader title="Blocked senders" description="Form messages from these addresses or domains go straight to Spam. Public email providers (gmail.com, yahoo.com…) can only be blocked address by address." />
          <CardBody className="space-y-3">
            <ActionForm action={blockSenderAction} className="flex flex-wrap gap-2" resetOnSuccess>
              <Select name="kind" defaultValue="EMAIL" className="w-32"><option value="EMAIL">Address</option><option value="DOMAIN">Domain</option></Select>
              <Input name="value" placeholder="name@example.com or example.com" className="w-72" required />
              <Input name="reason" placeholder="Note (optional)" className="w-56" />
              <SubmitButton size="sm" variant="outline">Block</SubmitButton>
            </ActionForm>
            {blocked.length ? (
              <ul className="divide-y divide-slate-100 text-sm">
                {blocked.map((b) => (
                  <li key={b.id} className="flex items-center justify-between gap-3 py-2">
                    <span><span className="font-mono">{b.value}</span> <span className="text-xs text-slate-500">{b.kind === "DOMAIN" ? "domain" : "address"}{b.reason ? ` · ${b.reason}` : ""} · {dateTimeLabel(b.createdAt)}</span></span>
                    <ActionForm action={unblockSenderAction} successMessage={false}><input type="hidden" name="id" value={b.id} /><SubmitButton size="sm" variant="ghost">Unblock</SubmitButton></ActionForm>
                  </li>
                ))}
              </ul>
            ) : <p className="text-sm text-slate-500">No blocked senders yet.</p>}
          </CardBody>
        </Card>
      ) : null}
    </>
  );
}
