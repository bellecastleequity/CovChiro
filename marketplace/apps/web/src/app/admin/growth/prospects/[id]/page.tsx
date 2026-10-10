import Link from "next/link";
import { notFound } from "next/navigation";
import { isPersonalInjuryPractice } from "@cm/core";
import { growth } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge, StatusBadge } from "@/components/ui/badge";
import { buttonClass } from "@/components/ui/button";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { Alert, Checklist, PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateTimeLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { manualEmailAction, sendFirstOutreachAction, noteAction, overrideProspectAction, replyAction, researchProspectAction, saveProspectAction, instagramHandleAction } from "../../actions";
import { GrowthTabs, SEGMENTS, STAGES } from "../../ui";
import { SourceCard } from "../source-card";

export const metadata = { title: "Clinic prospect" };
export const dynamic = "force-dynamic";

const ADDED: Record<string, { tone: "success" | "info" | "warning"; text: string }> = {
  sent: { tone: "success", text: "Clinic added and the first outreach email has been sent." },
  notsent: { tone: "warning", text: "Clinic added, but the first email couldn't go out yet. See why below." },
  added: { tone: "success", text: "Clinic added to the outreach list." },
  saved: { tone: "info", text: "Clinic saved with outreach paused. Unpause it or send the first email below when you're ready." },
  exists: { tone: "info", text: "That email is already on the list, so here's the existing clinic (nothing was duplicated)." },
};

export default async function ProspectDetail({ params, searchParams }: { params: Promise<{ id: string }>; searchParams: Promise<{ added?: string }> }) {
  const { actor } = await requireActor("admin");
  const { id } = await params;
  const { added } = await searchParams;
  const d = await growth.prospectDetail(actor, id).catch(() => null);
  if (!d) notFound();
  const p = d.prospect;
  const ready = await growth.outreachReadiness(id);
  const notice = added ? ADDED[added] : null;
  return (
    <>
      <PageHeader back={{ href: "/admin/growth/prospects", label: "Clinic prospects" }} eyebrow={<Link href="/admin/growth/prospects" className="hover:underline">Clinic prospects</Link>} title={p.clinicName} actions={isPersonalInjuryPractice(p.practiceType) ? <span className="rounded-full bg-accent-50 px-3 py-1 text-sm font-medium text-accent-700 ring-1 ring-accent-200">Personal injury · gets the PI emails</span> : null} description={[p.ownerName, [p.city, p.state].filter(Boolean).join(", "), p.marketKey ? `market: ${p.marketKey}` : null].filter(Boolean).join(" · ")} />
      <GrowthTabs current="/admin/growth/prospects" />
      <div className="mb-6 flex flex-wrap gap-1.5">
        <StatusBadge status={p.stage} />
        <Badge tone={p.intentCategory === "HIGH_INTENT" ? "red" : "brand"}>{humanize(p.intentCategory)} · score {p.intentScore}</Badge>
        <Badge>{humanize(p.segment)} {p.segmentBasis === "AI" ? `(AI guess, ${Math.round((p.segmentConfidence ?? 0) * 100)}%)` : `(${humanize(p.segmentBasis)})`}</Badge>
        <Badge tone={["BOUNCED", "COMPLAINED", "UNSUBSCRIBED"].includes(p.emailStatus) ? "red" : "gray"}>email: {humanize(p.emailStatus)}</Badge>
        {p.doNotContact ? <Badge tone="red">Do not contact</Badge> : null}
        {p.outreachPaused ? <Badge>Outreach paused</Badge> : <Badge tone="green">Outreach step {p.outreachStep}</Badge>}
        {p.smsConsentAt ? <Badge tone="green">SMS opt-in</Badge> : null}
        {p.clinicOrgId ? <Link href={`/admin/clinics/${p.clinicOrgId}`}><Badge tone="brand">Has an account →</Badge></Link> : null}
      </div>

      {notice ? <Alert tone={notice.tone} className="mb-5">{notice.text}</Alert> : null}
      <Card id="outreach" className="mb-6">
        <CardHeader
          title="Outreach emails"
          description={ready.blockers.length ? "This clinic won't get outreach emails until these are sorted:" : ready.automatic ? "The automatic outreach emails will go to this clinic." : "Ready to email. The automatic follow-ups are waiting on:"}
        />
        <CardBody className="space-y-3 text-sm">
          {ready.blockers.length ? <ul className="list-disc space-y-1 pl-5 text-red-700">{ready.blockers.map((b) => <li key={b}>{b}</li>)}</ul> : null}
          {ready.waits.length ? <ul className="list-disc space-y-1 pl-5 text-slate-600">{ready.waits.map((w) => <li key={w}>{w}</li>)}</ul> : null}
          {ready.firstNow ? (
            <ActionForm action={sendFirstOutreachAction} confirm={`Send the first outreach email to ${p.email} now?`}>
              <input type="hidden" name="id" value={p.id} />
              <SubmitButton size="sm">Send the first email now</SubmitButton>
              <p className="mt-1 text-xs text-slate-500">Uses the approved first-contact wording, with unsubscribe and the postal address, as you. Suppression and do-not-contact still apply.</p>
            </ActionForm>
          ) : null}
        </CardBody>
      </Card>

      <div className="grid gap-6 lg:grid-cols-[1fr_22rem]">
        <div className="space-y-6">
          {p.aiSummary ? <Card><CardHeader title="AI summary of their last reply" /><CardBody className="text-sm">{p.aiSummary}</CardBody></Card> : null}
          <Card>
            <CardHeader title="Communication history" />
            <Table>
              <thead><tr><Th>When</Th><Th>Channel</Th><Th>Message</Th><Th>Status</Th></tr></thead>
              <tbody>
                {d.communications.map((c) => (
                  <tr key={c.id}>
                    <Td className="whitespace-nowrap text-xs">{dateTimeLabel(c.createdAt)}</Td>
                    <Td className="text-xs">{humanize(c.channel)} {c.direction === "IN" ? "←" : "→"}</Td>
                    <Td><div className="font-medium">{c.subject ?? c.promptKey ?? ""}</div>{c.promptKey ? <div className="text-xs text-slate-400">{c.promptKey} v{c.promptVersion} · {c.agent}</div> : null}{c.body ? <details className="mt-1"><summary className="cursor-pointer text-xs text-slate-500">Show</summary><p className="mt-1 whitespace-pre-wrap text-sm text-slate-700">{c.body}</p></details> : null}</Td>
                    <Td><StatusBadge status={c.status} />{c.blockReason ? <div className="text-xs text-red-700">{humanize(c.blockReason)}</div> : null}</Td>
                  </tr>
                ))}
                {!d.communications.length ? <tr><Td colSpan={4} className="text-slate-500">Nothing yet.</Td></tr> : null}
              </tbody>
            </Table>
          </Card>
          <Card>
            <CardHeader title="Log an email reply" description="Paste what they wrote. Opt-out words always unsubscribe. Legal, payment, safety and clinical topics go to a person. With AI on, other replies are classified; any reply to them is drafted for your approval." />
            <CardBody>
              <ActionForm action={replyAction} className="space-y-2" resetOnSuccess>
                <input type="hidden" name="id" value={p.id} />
                <Input name="subject" placeholder="Subject (optional)" />
                <Textarea name="text" required placeholder="Their reply…" className="min-h-28" />
                <SubmitButton size="sm">Log &amp; route reply</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Send an email" description="Written by you: the automation pause and frequency caps don't apply. Suppression, do-not-contact and unsubscribe always do." />
            <CardBody>
              <ActionForm action={manualEmailAction} className="space-y-2" resetOnSuccess>
                <input type="hidden" name="entityType" value="PROSPECT" /><input type="hidden" name="entityId" value={p.id} />
                <Input name="subject" placeholder="Subject" required />
                <Textarea name="body" placeholder="Message (plain text; blank line between paragraphs)" required className="min-h-32" />
                <Select name="purpose" className="w-64"><option value="RELATIONSHIP">Reply / relationship</option><option value="COMMERCIAL">Marketing</option></Select>
                <SubmitButton size="sm">Send</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
          <div className="grid gap-6 md:grid-cols-2">
            <Card>
              <CardHeader title="Signals" description="Opens are deliberately not counted." />
              <Table><tbody>{d.signals.map((s) => <tr key={s.id}><Td className="text-xs">{dateTimeLabel(s.createdAt)}</Td><Td>{humanize(s.kind)}</Td></tr>)}{!d.signals.length ? <tr><Td className="text-slate-500">None yet.</Td></tr> : null}</tbody></Table>
            </Card>
            <Card>
              <CardHeader title="Agent activity" />
              <Table><tbody>{d.activity.map((a) => <tr key={a.id}><Td className="text-xs">{dateTimeLabel(a.createdAt)}</Td><Td className="text-xs">{humanize(a.agent)} · {humanize(a.action)}{a.error ? <div className="text-red-700">{a.error}</div> : null}</Td></tr>)}{!d.activity.length ? <tr><Td className="text-slate-500">None yet.</Td></tr> : null}</tbody></Table>
            </Card>
          </div>
        </div>

        <div className="space-y-6">
          <SourceCard entity="PROSPECT" p={p} />
          <Card>
            <CardHeader title="Web research" action={<ActionForm action={researchProspectAction} successMessage><input type="hidden" name="id" value={p.id} /><SubmitButton size="sm" variant="outline">{p.researchStatus === "PENDING" ? "Research now" : "Research again"}</SubmitButton></ActionForm>} />
            <CardBody className="space-y-2 text-sm">
              <div><StatusBadge status={p.researchStatus} /> {p.researchConfidence != null ? <span className="text-xs text-slate-500">confidence {Math.round(p.researchConfidence * 100)}%</span> : null} {p.researchedAt ? <span className="text-xs text-slate-500">· {dateTimeLabel(p.researchedAt)}</span> : null}</div>
              {p.nameFromRegistry ? <p className="text-xs text-amber-700">The name is a doctor's name from the NPI registry; research replaces it with the practice name.</p> : null}
              {p.website ? <div className="text-xs">Website: <a href={p.website} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">{p.website}</a></div> : null}
              {p.doctors.length ? <div className="text-xs">Chiropractors: {p.doctors.join(", ")}</div> : null}
              {p.socialUrls.length ? <div className="text-xs">Social: {p.socialUrls.map((u) => <a key={u} href={u} target="_blank" rel="noopener noreferrer" className="mr-2 text-brand-700 hover:underline">{u.replace(/^https?:\/\/(www\.)?/, "").split("/")[0]}</a>)}</div> : null}
              {p.sourceUrls.length ? (
                <details><summary className="cursor-pointer text-xs text-slate-500">Sources ({p.sourceUrls.length})</summary>
                  <ul className="mt-1 space-y-0.5">{p.sourceUrls.map((u) => <li key={u} className="truncate text-xs"><a href={u} target="_blank" rel="noopener noreferrer" className="text-brand-700 hover:underline">{u}</a></li>)}</ul>
                </details>
              ) : null}
              {p.npis.length ? <div className="text-xs text-slate-500">NPI registry: {p.npis.join(", ")}</div> : null}
              <ActionForm action={instagramHandleAction} className="flex flex-wrap items-end gap-2 border-t border-slate-100 pt-3">
                <input type="hidden" name="prospectId" value={p.id} />
                <Field label={<>Instagram{p.igStatus !== "NONE" && p.igStatus !== "NO_HANDLE" ? <span className="ml-1 font-normal text-slate-500">· {humanize(p.igStatus)}</span> : null}</>}>
                  <Input name="handle" defaultValue={p.instagramHandle ? `@${p.instagramHandle}` : ""} placeholder="@handle or profile link" className="w-56" />
                </Field>
                <SubmitButton size="sm" variant="outline">Save</SubmitButton>
                <Link href="/admin/growth/instagram" className="text-xs text-brand-700 hover:underline">Follow list</Link>
              </ActionForm>
            </CardBody>
          </Card>
          {d.checklist ? <Card><CardHeader title="Onboarding" /><CardBody><Checklist items={d.checklist.map((s) => ({ label: s.label, done: s.done }))} /></CardBody></Card> : null}
          <Card>
            <CardHeader title="Overrides" description="People can change what automation decided." />
            <CardBody className="space-y-3">
              <ActionForm action={overrideProspectAction} className="flex gap-2">
                <input type="hidden" name="id" value={p.id} />
                <Select name="segment" defaultValue={p.segment}>{SEGMENTS.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
                <SubmitButton size="sm" variant="outline">Set segment</SubmitButton>
              </ActionForm>
              <ActionForm action={overrideProspectAction} className="flex gap-2">
                <input type="hidden" name="id" value={p.id} />
                <Select name="stage" defaultValue={p.stage}>{STAGES.map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select>
                <SubmitButton size="sm" variant="outline">Set stage</SubmitButton>
              </ActionForm>
              <ActionForm action={overrideProspectAction}>
                <input type="hidden" name="id" value={p.id} />
                <button name="outreachPaused" value={p.outreachPaused ? "false" : "true"} className={buttonClass("outline", "sm", "w-full")}>{p.outreachPaused ? "Resume outreach" : "Pause outreach"}</button>
              </ActionForm>
              <ActionForm action={overrideProspectAction} confirm={p.doNotContact ? undefined : "Mark do-not-contact? Their email is also added to the suppression list."}>
                <input type="hidden" name="id" value={p.id} />
                <button name="doNotContact" value={p.doNotContact ? "false" : "true"} className={buttonClass(p.doNotContact ? "outline" : "danger", "sm", "w-full")}>{p.doNotContact ? "Clear do-not-contact" : "Do not contact"}</button>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Log a call or note" />
            <CardBody>
              <ActionForm action={noteAction} className="space-y-2" resetOnSuccess>
                <input type="hidden" name="id" value={p.id} />
                <div className="flex gap-2"><Select name="channel"><option value="PHONE">Phone call</option><option value="NOTE">Note</option></Select><Select name="direction"><option value="OUT">Outbound</option><option value="IN">Inbound</option></Select></div>
                <Textarea name="text" required className="min-h-20" />
                <SubmitButton size="sm" variant="outline">Log</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Details" />
            <CardBody>
              <ActionForm action={saveProspectAction} className="space-y-2">
                <input type="hidden" name="id" value={p.id} />
                {([["clinicName", "Clinic name"], ["ownerName", "Owner"], ["email", "Email"], ["phone", "Phone"], ["website", "Website"], ["address", "Address"], ["city", "City"], ["county", "County"], ["zip", "ZIP"], ["practiceType", "Practice type"], ["source", "Source"], ["campaignCode", "Campaign"]] as const).map(([k, l]) => (
                  <Field key={k} label={l} hint={k === "practiceType" ? "Include \"personal injury\" or \"auto accident\" to send this clinic the personal injury emails." : undefined}><Input name={k} defaultValue={(p[k] as string | null) ?? ""} required={k === "clinicName"} /></Field>
                ))}
                <div className="grid grid-cols-2 gap-2">
                  <Field label="Locations"><Input name="locationsCount" type="number" min={0} defaultValue={p.locationsCount ?? ""} /></Field>
                  <Field label="Chiropractors"><Input name="providerCount" type="number" min={0} defaultValue={p.providerCount ?? ""} /></Field>
                </div>
                <Field label="Ownership"><Select name="ownership" defaultValue={p.ownership ?? ""}><option value="">Unknown</option><option value="independent">Independent</option><option value="group">Group</option><option value="franchise">Franchise</option></Select></Field>
                <Field label="Notes"><Textarea name="notes" defaultValue={p.notes ?? ""} /></Field>
                <input type="hidden" name="state" value={p.state} />
                <SubmitButton size="sm">Save</SubmitButton>
              </ActionForm>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
