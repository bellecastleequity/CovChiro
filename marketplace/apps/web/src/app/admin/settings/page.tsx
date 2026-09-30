import { admin } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardHeader } from "@/components/ui/card";
import { Input, Select, Textarea } from "@/components/ui/form";
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
                const unit = unitFor(r.key);
                return (
                  <ActionForm key={r.key} action={settingAction} className="grid gap-2 px-5 py-3 sm:grid-cols-[1fr_320px_auto] sm:items-center">
                    <input type="hidden" name="key" value={r.key} />
                    <div>
                      <div className="text-sm font-medium">{r.label} {r.flag ? <Badge tone={r.flag === "ATTORNEY_REVIEW" ? "red" : "amber"}>{r.flag === "ATTORNEY_REVIEW" ? "Attorney review" : "Owner decision"}</Badge> : null}</div>
                      <div className="font-mono text-xs text-slate-400">{r.key}</div>
                      {r.help ? <div className="text-xs text-slate-500">{r.help}</div> : null}
                    </div>
                    {complex ? (
                      <Textarea name="value" defaultValue={JSON.stringify(r.value, null, 1)} className="min-h-20 font-mono text-xs" />
                    ) : typeof r.value === "boolean" ? (
                      <Select name="value" defaultValue={String(r.value)}>
                        <option value="true">Yes</option>
                        <option value="false">No</option>
                      </Select>
                    ) : unit.money ? (
                      <div className="flex items-center gap-2">
                        <input type="hidden" name="unit" value="cents" />
                        <span className="text-sm text-slate-500">$</span>
                        <Input name="value" type="number" step="0.01" min={0} defaultValue={(Number(r.value) / 100).toFixed(2)} className="text-right" />
                        {unit.suffix ? <span className="shrink-0 text-sm text-slate-500">{unit.suffix}</span> : null}
                      </div>
                    ) : (
                      <div className="flex items-center gap-2">
                        <Input name="value" defaultValue={String(r.value)} className={unit.suffix ? "text-right" : "font-mono"} />
                        {unit.suffix ? <span className="shrink-0 text-sm text-slate-500">{unit.suffix}</span> : null}
                      </div>
                    )}
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

/** How a setting's number is shown: money in dollars (stored as cents), with a unit after it. */
function unitFor(key: string): { money: boolean; suffix: string | null } {
  if (/Cents/.test(key)) return { money: true, suffix: /PerMile/.test(key) ? "per mile" : /PerHour/.test(key) ? "per hour" : null };
  if (/Percent$/.test(key)) return { money: false, suffix: "%" };
  if (/Hours$/.test(key)) return { money: false, suffix: "hours" };
  if (/(Minutes|Min)$/.test(key)) return { money: false, suffix: "min" };
  if (/Days$/.test(key)) return { money: false, suffix: "days" };
  if (/Months$/.test(key)) return { money: false, suffix: "months" };
  return { money: false, suffix: null };
}
