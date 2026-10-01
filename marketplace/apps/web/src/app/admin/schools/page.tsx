import { schools } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Field, Input, Select } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";
import { addSchoolAction, loadSchoolListAction, schoolActiveAction } from "../actions";

export const metadata = { title: "Schools" };

export default async function Schools() {
  const { actor } = await requireActor("admin");
  const { professions, schools: rows, catalog } = await schools.adminSchools(actor);
  return (
    <>
      <PageHeader title="Schools" description="The dropdown on the student sign-up, grouped by profession. Students can still type a school that isn't listed." />
      <div className="grid gap-6 lg:grid-cols-3">
        <div className="space-y-6 lg:col-span-2">
          {professions.map((p) => {
            const list = rows.filter((s) => s.professionCode === p.code);
            if (!list.length && !p.active) return null;
            return (
              <Card key={p.code}>
                <CardHeader
                  title={<>{p.displayName} {p.active ? <Badge tone="green">Live</Badge> : <Badge>Not live</Badge>}</>}
                  description={`${list.filter((s) => s.active).length} shown in the dropdown${p.active ? "" : " (only once this profession is live or in Growth prelaunch)"}`}
                  action={catalog[p.code] ? (
                    <ActionForm action={loadSchoolListAction} successMessage>
                      <input type="hidden" name="professionCode" value={p.code} />
                      <SubmitButton size="sm" variant="ghost">Load built-in list ({catalog[p.code]})</SubmitButton>
                    </ActionForm>
                  ) : null}
                />
                <CardBody>
                  {list.length ? (
                    <ul className="divide-y divide-slate-100 text-sm">
                      {list.map((s) => (
                        <li key={s.id} className="flex items-center justify-between gap-3 py-2">
                          <span className={s.active ? "" : "text-slate-400 line-through"}>{s.name}{s.city ? <span className="text-slate-500"> · {s.city}{s.state ? `, ${s.state}` : ""}</span> : null}</span>
                          <ActionForm action={schoolActiveAction} successMessage={false}>
                            <input type="hidden" name="id" value={s.id} />
                            <input type="hidden" name="active" value={s.active ? "false" : "true"} />
                            <button className="text-xs text-slate-500 hover:text-brand-700">{s.active ? "Hide" : "Show"}</button>
                          </ActionForm>
                        </li>
                      ))}
                    </ul>
                  ) : (
                    <p className="text-sm text-amber-800">No schools yet — students will type their school until you add some.</p>
                  )}
                </CardBody>
              </Card>
            );
          })}
        </div>
        <Card className="h-fit">
          <CardHeader title="Add a school" />
          <CardBody>
            <ActionForm action={addSchoolAction} className="space-y-3" resetOnSuccess>
              <Field label="Profession">
                <Select name="professionCode" defaultValue="DC">{professions.map((p) => <option key={p.code} value={p.code}>{p.displayName}</option>)}</Select>
              </Field>
              <Field label="School name"><Input name="name" required /></Field>
              <div className="grid grid-cols-3 gap-2">
                <Field label="City" className="col-span-2"><Input name="city" /></Field>
                <Field label="State"><Input name="state" maxLength={2} className="uppercase" /></Field>
              </div>
              <SubmitButton size="sm">Add school</SubmitButton>
            </ActionForm>
            <p className="mt-3 text-xs text-slate-500">Turning a profession on in States &amp; professions, or putting it in Growth prelaunch, adds its built-in list automatically (chiropractic has one; add others here).</p>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
