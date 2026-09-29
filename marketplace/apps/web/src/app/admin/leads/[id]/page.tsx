import { leads } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { StatusBadge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { dateLabel, dateTimeLabel, humanize } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { deleteLeadAction, resendLeadAction, updateLeadAction } from "../../actions";

export default async function Lead({ params }: { params: Promise<{ id: string }> }) {
  const { actor } = await requireActor("admin");
  const { lead, promo } = await leads.leadDetail(actor, (await params).id);
  return (
    <>
      <PageHeader title={lead.name} description={`${lead.email}${lead.phone ? ` · ${lead.phone}` : ""}${lead.organization ? ` · ${lead.organization}` : ""}`} actions={<StatusBadge status={lead.status} />} />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {lead.message ? <Card><CardHeader title="Message" /><CardBody><p className="whitespace-pre-line text-sm">{lead.message}</p></CardBody></Card> : null}
          <Card>
            <CardHeader title="Activity" />
            <CardBody>
              <ActionForm action={updateLeadAction} className="mb-4 flex gap-2" resetOnSuccess>
                <input type="hidden" name="leadId" value={lead.id} />
                <Textarea name="note" placeholder="Add a note (call summary, next step…)" className="min-h-10" required />
                <SubmitButton size="sm">Add</SubmitButton>
              </ActionForm>
              <ol className="space-y-3 border-l border-slate-200 pl-4 text-sm">
                {lead.activities.map((a) => (
                  <li key={a.id}><div className="text-xs text-slate-400">{dateTimeLabel(a.createdAt)} · {humanize(a.kind)}</div><div className="whitespace-pre-line">{a.body}</div></li>
                ))}
              </ol>
            </CardBody>
          </Card>
        </div>
        <div className="space-y-6">
          <Card>
            <CardHeader title="Details" />
            <CardBody className="space-y-1 text-sm">
              <div>Audience: {lead.audience.toLowerCase()}</div>
              <div>Source: {lead.source}{lead.campaignCode ? ` (${lead.campaignCode})` : ""}</div>
              {lead.professionCode ? <div>Profession: {lead.professionCode}{lead.state ? ` · ${lead.state}` : ""}</div> : null}
              {promo ? <div>Code: <span className="font-mono">{promo.code}</span> · used {promo.usedCount}/{promo.maxUses ?? "∞"}{promo.expiresAt ? ` · expires ${dateLabel(promo.expiresAt)}` : ""}</div> : null}
              <div>Follow-up emails sent: {lead.dripStep}{lead.nextDripAt ? ` · next ${dateTimeLabel(lead.nextDripAt)}` : ""}</div>
              {lead.utmSource ? <div>UTM: {lead.utmSource}/{lead.utmMedium}/{lead.utmCampaign}</div> : null}
              {lead.convertedAt ? <div className="text-emerald-700">Converted {dateTimeLabel(lead.convertedAt)}</div> : null}
            </CardBody>
          </Card>
          <Card>
            <CardHeader title="Update" />
            <CardBody>
              <ActionForm action={updateLeadAction} className="space-y-2">
                <input type="hidden" name="leadId" value={lead.id} />
                <Field label="Status"><Select name="status" defaultValue={lead.status}>{["NEW", "NURTURING", "CONTACTED", "CONVERTED", "UNSUBSCRIBED", "EXPIRED", "LOST"].map((s) => <option key={s} value={s}>{humanize(s)}</option>)}</Select></Field>
                <Field label="Follow up on"><Input type="date" name="followUpAt" defaultValue={lead.followUpAt?.toISOString().slice(0, 10)} /></Field>
                <SubmitButton size="sm">Save</SubmitButton>
              </ActionForm>
              <div className="mt-4 flex gap-2">
                <ActionForm action={resendLeadAction}><input type="hidden" name="leadId" value={lead.id} /><SubmitButton size="sm" variant="outline">Resend last email</SubmitButton></ActionForm>
                <ActionForm action={deleteLeadAction} confirm="Delete this lead permanently?"><input type="hidden" name="leadId" value={lead.id} /><SubmitButton size="sm" variant="ghost">Delete</SubmitButton></ActionForm>
              </div>
            </CardBody>
          </Card>
        </div>
      </div>
    </>
  );
}
