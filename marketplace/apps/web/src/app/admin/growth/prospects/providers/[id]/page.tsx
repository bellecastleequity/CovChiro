import Link from "next/link";
import { notFound } from "next/navigation";
import { growth } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { dateTimeLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { providerProspectAction } from "../../../actions";
import { GrowthTabs, usd } from "../../../ui";

export const metadata = { title: "Provider prospect" };
export const dynamic = "force-dynamic";

function Op({ id, op, label, variant = "outline", confirm }: { id: string; op: string; label: string; variant?: "outline" | "ghost" | "danger" | "primary"; confirm?: string }) {
  return (
    <ActionForm action={providerProspectAction} confirm={confirm}>
      <input type="hidden" name="id" value={id} /><input type="hidden" name="op" value={op} />
      <SubmitButton size="sm" variant={variant}>{label}</SubmitButton>
    </ActionForm>
  );
}

export default async function ProviderProspectPage({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor("admin");
  const d = await growth.providerProspect(actor, (await params).id);
  if (!d) notFound();
  const { p } = d;
  return (
    <>
      <PageHeader title={p.displayName} description={`${p.professionCode} · NPI ${p.npi} · ${[p.address, p.city, p.state, p.zip].filter(Boolean).join(", ")}`} actions={<Link href="/admin/growth/prospects/providers" className="text-sm text-brand-700">← Provider prospects</Link>} />
      <GrowthTabs current="/admin/growth/prospects" />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          <Card>
            <CardHeader title="Status" description={`Next: ${d.next}`} action={<div className="flex flex-wrap gap-1"><Badge>{humanize(p.stage)}</Badge><Badge tone={p.contactStatus === "VERIFIED" ? "green" : "gray"}>{humanize(p.contactStatus)}</Badge>{p.needsReview ? <Badge tone="amber">Needs review</Badge> : null}{p.doNotContact ? <Badge tone="red">Do not contact</Badge> : null}</div>} />
            <CardBody className="grid gap-3 text-sm sm:grid-cols-2">
              <div><div className="text-xs text-slate-500">Email</div>{p.email ?? "—"}{p.emailOrigin ? <span className="text-xs text-slate-400"> · via {p.emailOrigin}</span> : null}{p.emailCheck ? <span className="text-xs text-slate-400"> · check: {p.emailCheck}</span> : null}</div>
              <div><div className="text-xs text-slate-500">Found on</div>{p.emailSourceUrl ? <a href={p.emailSourceUrl} target="_blank" rel="noreferrer" className="break-all text-brand-700">{p.emailSourceUrl}</a> : "—"}</div>
              <div><div className="text-xs text-slate-500">Practice</div>{d.practice ? <Link href={`/admin/growth/prospects/${d.practice.id}`} className="text-brand-700">{d.practice.clinicName}</Link> : "—"} · {humanize(p.practiceRole)} · {p.providersAtPractice} at this address</div>
              <div><div className="text-xs text-slate-500">Website</div>{p.website ?? "—"}</div>
              <div><div className="text-xs text-slate-500">Research</div>{humanize(p.researchStatus)}{p.researchConfidence != null ? ` · match ${Math.round(p.researchConfidence * 100)}%` : ""} · {p.researchAttempts} attempt{p.researchAttempts === 1 ? "" : "s"} · {usd(Math.round(p.researchCostMicroUsd / 10_000))}</div>
              <div><div className="text-xs text-slate-500">Source</div>{p.source} · found {dateTimeLabel(p.collectedAt)}</div>
              {p.reviewReason ? <div className="sm:col-span-2 rounded-lg bg-amber-50 px-3 py-2 text-amber-900">{p.reviewReason}</div> : null}
              {d.provider ? <div className="sm:col-span-2 rounded-lg bg-emerald-50 px-3 py-2 text-emerald-900">Registered as <Link href={`/admin/providers/${d.provider.id}`} className="font-medium underline">{d.provider.displayName}</Link> ({humanize(d.provider.status)}).</div> : null}
              {p.sourceUrls.length ? <div className="sm:col-span-2"><div className="text-xs text-slate-500">Sources</div><ul className="list-disc pl-5 text-xs">{p.sourceUrls.map((u) => <li key={u} className="break-all">{u}</li>)}</ul></div> : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Messages" />
            <CardBody className="space-y-3">
              {d.comms.length ? d.comms.map((c) => (
                <div key={c.id} className="rounded-lg border border-slate-200 p-3 text-sm">
                  <div className="text-xs text-slate-500">{dateTimeLabel(c.createdAt)} · {c.direction === "IN" ? "Reply" : humanize(c.status)} · {c.promptKey ?? c.channel}</div>
                  <div className="font-medium">{c.subject}</div>
                  <div className="mt-1 whitespace-pre-wrap text-slate-600">{c.body?.slice(0, 1200)}</div>
                </div>
              )) : <p className="text-sm text-slate-500">No messages yet.</p>}
              <ActionForm action={providerProspectAction} className="space-y-2 border-t border-slate-100 pt-3" resetOnSuccess>
                <input type="hidden" name="id" value={p.id} /><input type="hidden" name="op" value="reply" />
                <Field label="Log a reply they sent (opt-outs suppress automatically; interest goes to Leads / Conversations)"><Textarea name="text" required /></Field>
                <SubmitButton size="sm" variant="outline">Log reply</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Agent activity" />
            <CardBody className="space-y-1 text-xs">
              {d.activity.length ? d.activity.map((a) => <div key={a.id}>{dateTimeLabel(a.createdAt)} · {a.agent} · {a.action.replace(/_/g, " ")}{a.output ? ` · ${a.output.slice(0, 160)}` : ""}{a.error ? <span className="text-red-700"> · {a.error}</span> : null}</div>) : <span className="text-slate-500">None.</span>}
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Actions" />
            <CardBody className="space-y-3">
              <div className="flex flex-wrap gap-2">
                <Op id={p.id} op="research" label="Re-run research" />
                {p.email ? <Op id={p.id} op="verify" label="Re-check email" variant="ghost" /> : null}
                {p.needsReview ? <Op id={p.id} op="approve" label="Approve match" variant="primary" /> : null}
                {p.outreachPaused ? <Op id={p.id} op="resume" label="Resume outreach" variant="ghost" /> : <Op id={p.id} op="pause" label="Pause outreach" variant="ghost" />}
                {p.doNotContact ? <Op id={p.id} op="unsuppress" label="Allow contact" variant="ghost" /> : <Op id={p.id} op="suppress" label="Suppress" variant="danger" confirm="Never contact this provider? Their email goes on the suppression list." />}
              </div>
              <ActionForm action={providerProspectAction} className="space-y-2">
                <input type="hidden" name="id" value={p.id} /><input type="hidden" name="op" value="email" />
                <Field label="Correct the email" hint="A professional address that reaches them. It's re-checked before any email goes out."><Input name="email" type="email" defaultValue={p.email ?? ""} /></Field>
                <SubmitButton size="sm" variant="secondary">Save email</SubmitButton>
              </ActionForm>
              <ActionForm action={providerProspectAction} className="space-y-2">
                <input type="hidden" name="id" value={p.id} /><input type="hidden" name="op" value="details" />
                <Field label="Practice role"><Select name="practiceRole" defaultValue={p.practiceRole}><option value="OWNER">Owner</option><option value="ASSOCIATE">Associate</option><option value="UNKNOWN">Unknown</option></Select></Field>
                <Field label="Campaign code (attribution)"><Input name="campaignCode" defaultValue={p.campaignCode ?? ""} /></Field>
                <Field label="Notes"><Textarea name="notes" defaultValue={p.notes ?? ""} /></Field>
                <SubmitButton size="sm" variant="secondary">Save</SubmitButton>
              </ActionForm>
              <ActionForm action={providerProspectAction} className="space-y-2" confirm="Merge the other prospect into this one? The other record is deleted.">
                <input type="hidden" name="id" value={p.id} /><input type="hidden" name="op" value="merge" />
                <Field label="Merge a duplicate (its prospect ID)"><Input name="dropId" required /></Field>
                <SubmitButton size="sm" variant="ghost">Merge into this one</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
