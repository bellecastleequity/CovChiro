import { prisma } from "@cm/db";
import { US_STATES } from "@cm/core";
import { announcements, getSettings } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { AutoRefresh } from "@/components/countdown";
import { PageHeader, Table, Td, Th } from "@/components/ui/misc";
import { dateTimeLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { announcementAction, cancelAnnouncementAction } from "../actions";

export const metadata = { title: "Announcements" };
export const dynamic = "force-dynamic";

const AUDIENCE: Record<string, string> = { PROVIDERS: "Providers", CLINICS: "Clinics", EVERYONE: "Everyone" };

export default async function Announcements() {
  const { actor } = await requireActor("admin");
  const [rows, professions, s] = await Promise.all([announcements.listAnnouncements(actor), prisma.profession.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }), getSettings()]);
  const sending = rows.some((r) => r.status === "QUEUED" || r.status === "SENDING");
  return (
    <>
      <PageHeader title="Announcements" description="Send one message to all providers, all clinics or everyone, by email, in the app and on their phones. Check the count, send yourself a test, then send." />
      <Card className="mb-6">
        <CardHeader title="New announcement" />
        <CardBody>
          <ActionForm action={announcementAction} className="space-y-5">
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Send to">
                <Select name="audience" defaultValue="EVERYONE">
                  <option value="EVERYONE">Everyone (providers and clinics)</option>
                  <option value="PROVIDERS">All providers</option>
                  <option value="CLINICS">All clinics</option>
                </Select>
              </Field>
              <Field label="Type">
                <Select name="kind" defaultValue="NOTICE">
                  <option value="NOTICE">Important notice (service or account)</option>
                  <option value="NEWS">News or promotion (with unsubscribe link)</option>
                </Select>
              </Field>
              <Field label="Providers: status" hint="Ignored for clinics.">
                <Select name="providerStatus" defaultValue="ALL">
                  <option value="ALL">All providers</option>
                  <option value="READY">Ready for shifts only</option>
                  <option value="ONBOARDING">Still setting up only</option>
                </Select>
              </Field>
              <Field label="State (optional)" hint="Providers licensed or living there; clinics with a location there.">
                <Select name="state" defaultValue="">
                  <option value="">All states</option>
                  {Object.entries(US_STATES).map(([code, name]) => <option key={code} value={code}>{name}</option>)}
                </Select>
              </Field>
              <Field label="Profession (optional)">
                <Select name="professionCode" defaultValue="">
                  <option value="">All professions</option>
                  {professions.map((p) => <option key={p.code} value={p.code}>{p.displayName}</option>)}
                </Select>
              </Field>
              <div className="pt-7"><Checkbox name="ownersOnly" label="Clinics: owners only (not office staff logins)" /></div>
            </div>
            <Field label="Subject"><Input name="title" required maxLength={120} placeholder="e.g. New Clinic Agreement to review" /></Field>
            <Field label="Message" hint="Plain text; a blank line starts a new paragraph. Never include patient information."><Textarea name="body" required maxLength={5000} className="min-h-40" /></Field>
            <div className="grid gap-4 sm:grid-cols-2">
              <Field label="Button link (optional)" hint="A page on this site, e.g. /provider/shifts or /clinic/settings"><Input name="linkPath" placeholder="/provider/shifts" /></Field>
              <Field label="Button label (optional)"><Input name="ctaLabel" maxLength={40} placeholder="Open" /></Field>
            </div>
            <fieldset className="space-y-2 text-sm">
              <legend className="mb-1 font-medium text-slate-700">How</legend>
              <p className="text-xs text-slate-500">Everyone gets it in the app (the bell).</p>
              <Checkbox name="ch_email" defaultChecked label="Email" />
              <Checkbox name="ch_push" defaultChecked label="Phone notification (people who turned on app alerts)" />
              <Checkbox name="ch_sms" label="Text message: important notices only, to verified mobiles (sends the subject and link)" />
            </fieldset>
            <p className="rounded-xl bg-slate-50 p-3 text-xs text-slate-600">
              News and promotions go out with an unsubscribe link and your postal address ({s["growth.postalAddress"] || "set it in Settings → Growth"}), and anyone who unsubscribed is skipped. Admin logins, turned-off logins and banned emails are never included.
            </p>
            <div className="flex flex-wrap items-center gap-2 border-t border-slate-100 pt-4">
              <SubmitButton name="mode" value="count" variant="outline" size="sm">Count recipients</SubmitButton>
              <SubmitButton name="mode" value="test" variant="outline" size="sm">Send a test to me</SubmitButton>
            </div>
            <div className="space-y-2">
              <Checkbox name="confirmSend" label="I've checked the count and the test, and I want to send this to everyone in this audience." />
              <SubmitButton name="mode" value="send">Send announcement</SubmitButton>
            </div>
          </ActionForm>
        </CardBody>
      </Card>
      <Card>
        <CardHeader title="Sent and sending" />
        {sending ? <AutoRefresh seconds={15} /> : null}
        <Table>
          <thead><tr><Th>When</Th><Th>Subject</Th><Th>To</Th><Th>How</Th><Th>Progress</Th><Th /></tr></thead>
          <tbody>
            {rows.map((r) => {
              const aud = r.audience as { audience: string; state?: string | null; professionCode?: string | null; providerStatus?: string; ownersOnly?: boolean };
              const live = r.status === "QUEUED" || r.status === "SENDING";
              return (
                <tr key={r.id}>
                  <Td className="whitespace-nowrap text-xs">{dateTimeLabel(r.createdAt)}</Td>
                  <Td><div className="font-medium">{r.title}</div><div className="text-xs text-slate-500">{r.kind === "NEWS" ? "News / promotion" : "Important notice"}</div></Td>
                  <Td className="text-xs">{AUDIENCE[aud.audience] ?? aud.audience}{aud.state ? ` · ${aud.state}` : ""}{aud.professionCode ? ` · ${aud.professionCode}` : ""}{aud.providerStatus && aud.providerStatus !== "ALL" ? ` · ${aud.providerStatus.toLowerCase()}` : ""}{aud.ownersOnly ? " · owners" : ""}</Td>
                  <Td className="text-xs">in-app{r.channels.map((c) => `, ${c === "sms" ? "text" : c}`).join("")}</Td>
                  <Td className="text-xs"><Badge tone={r.status === "DONE" ? "green" : r.status === "CANCELLED" ? "gray" : "brand"}>{r.status.toLowerCase()}</Badge><div className="mt-1 text-slate-500">{r.sentCount} of {r.recipientCount} sent{r.skippedCount ? ` · ${r.skippedCount} skipped (unsubscribed or email failed)` : ""}</div></Td>
                  <Td>{live ? (
                    <ActionForm action={cancelAnnouncementAction} confirm="Stop sending? People already reached keep it.">
                      <input type="hidden" name="id" value={r.id} />
                      <SubmitButton size="sm" variant="ghost">Stop</SubmitButton>
                    </ActionForm>
                  ) : null}</Td>
                </tr>
              );
            })}
            {!rows.length ? <tr><Td colSpan={6} className="text-slate-500">No announcements yet.</Td></tr> : null}
          </tbody>
        </Table>
      </Card>
    </>
  );
}
