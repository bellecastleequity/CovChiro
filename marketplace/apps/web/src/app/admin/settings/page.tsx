import { admin } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";
import { settingAction, testEmailAction } from "../actions";

export const metadata = { title: "Settings" };

export default async function Settings() {
  const { actor, user } = await requireActor("admin");
  const rows = await admin.settingsView(actor);
  const groups = [...new Set(rows.map((r) => r.group))];
  const open = rows.filter((r) => r.flag).length;
  return (
    <>
      <PageHeader title="Settings" description={`Every owner decision and threshold lives here. ${open} are flagged OWNER DECISION or ATTORNEY REVIEW. Changes are audit-logged.`} />
      <div className="space-y-6">
        <Card>
          <CardHeader title="Email check" description="Sends a test email the same way signup confirmations and booking emails go out, and shows the email service's exact reply if it fails." />
          <ActionForm action={testEmailAction} className="flex flex-wrap items-center gap-2 px-5 pb-5">
            <Input name="to" type="email" required defaultValue={user.email} className="w-72" />
            <SubmitButton size="sm" variant="outline">Send test email</SubmitButton>
          </ActionForm>
        </Card>
        {groups.map((g) => (
          <Card key={g}>
            <CardHeader title={g} />
            <div className="divide-y divide-slate-100">
              {rows.filter((r) => r.group === g).map((r) => {
                const complex = typeof r.value === "object";
                return (
                  <ActionForm key={r.key} action={settingAction} className="grid gap-2 px-5 py-3 sm:grid-cols-[1fr_320px_auto] sm:items-center">
                    <input type="hidden" name="key" value={r.key} />
                    <div>
                      <div className="text-sm font-medium">{r.label} {r.flag ? <Badge tone={r.flag === "ATTORNEY_REVIEW" ? "red" : "amber"}>{r.flag === "ATTORNEY_REVIEW" ? "Attorney review" : "Owner decision"}</Badge> : null}</div>
                      <div className="font-mono text-xs text-slate-400">{r.key}</div>
                      {r.help ? <div className="text-xs text-slate-500">{r.help}</div> : null}
                    </div>
                    {complex ? <Textarea name="value" defaultValue={JSON.stringify(r.value, null, 1)} className="min-h-20 font-mono text-xs" /> : <Input name="value" defaultValue={String(r.value)} className="font-mono" />}
                    <SubmitButton size="sm" variant="outline">Save</SubmitButton>
                  </ActionForm>
                );
              })}
            </div>
          </Card>
        ))}
      </div>
    </>
  );
}
