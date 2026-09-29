import { prisma } from "@cm/db";
import { clinicProfile } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";
import { archiveLocationAction, locationAction } from "../actions";

export const metadata = { title: "Locations" };

type Loc = Awaited<ReturnType<typeof clinicProfile>>["org"]["locations"][number];

async function LocationForm({ loc }: { loc?: Loc }) {
  const [professions, skills] = await Promise.all([
    prisma.profession.findMany({ orderBy: { sortOrder: "asc" } }),
    prisma.skill.findMany({ where: { active: true, scopeSensitive: false }, orderBy: [{ professionCode: "asc" }, { name: "asc" }] }),
  ]);
  const chosen = loc?.professionCodes ?? ["DC"];
  return (
    <ActionForm action={locationAction} className="grid gap-4 sm:grid-cols-2" resetOnSuccess={!loc}>
      {loc ? <input type="hidden" name="locationId" value={loc.id} /> : null}
      <Field label="Location name"><Input name="name" defaultValue={loc?.name} placeholder="Main office" required /></Field>
      <Field label="Front desk phone"><Input name="phone" defaultValue={loc?.phone ?? ""} type="tel" /></Field>
      <Field label="Street address, city, state, ZIP" hint="Verified with our mapping service — your state comes from this address." className="sm:col-span-2">
        <Input name="address" defaultValue={loc ? `${loc.addressLine1}, ${loc.city}, ${loc.state} ${loc.zip}` : ""} required />
      </Field>
      <Field label="Suite / unit"><Input name="addressLine2" defaultValue={loc?.addressLine2 ?? ""} /></Field>
      <Field label="On-site contact"><Input name="onSiteContactName" defaultValue={loc?.onSiteContactName ?? ""} /></Field>
      <Field label="Patients per day"><Input name="patientsPerDay" type="number" defaultValue={loc?.patientsPerDay ?? ""} /></Field>
      <Field label="EHR"><Input name="ehr" defaultValue={loc?.ehr ?? ""} /></Field>
      <Field label="Equipment (comma-separated)" className="sm:col-span-2"><Input name="equipment" defaultValue={loc?.equipment.join(", ")} placeholder="Drop tables, X-ray, e-stim" /></Field>
      <Field label="Dress code"><Input name="dressCode" defaultValue={loc?.dressCode ?? ""} /></Field>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-slate-700">We post shifts for</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {professions.map((p) => <Checkbox key={p.code} name="professions" value={p.code} defaultChecked={chosen.includes(p.code)} label={`${p.displayName}${p.active ? "" : " (soon)"}`} />)}
        </div>
      </fieldset>
      <Field label="Arrival notes for confirmed providers" className="sm:col-span-2" hint="Parking, entrance, who to ask for. Shown only after confirmation.">
        <Textarea name="arrivalNotes" defaultValue={loc?.arrivalNotes ?? ""} />
      </Field>
      <fieldset className="sm:col-span-2">
        <legend className="mb-1.5 text-sm font-medium text-slate-700">Techniques used here</legend>
        <div className="grid gap-2 sm:grid-cols-3">
          {skills.filter((k) => !k.professionCode || chosen.includes(k.professionCode)).map((k) => (
            <Checkbox key={k.id} name="skills" value={k.id} defaultChecked={loc?.skills.some((s) => s.skillId === k.id)} label={k.name} />
          ))}
        </div>
      </fieldset>
      <div className="sm:col-span-2"><SubmitButton>{loc ? "Save location" : "Add location"}</SubmitButton></div>
    </ActionForm>
  );
}

export default async function Locations() {
  const { actor } = await requireActor("clinic");
  const { org } = await clinicProfile(actor);
  return (
    <>
      <PageHeader title="Locations" description="A clinic can have many locations, even in different states." />
      <div className="space-y-6">
        {org.locations.map((l) => (
          <Card key={l.id}>
            <CardHeader
              title={l.name}
              description={`${l.addressLine1}, ${l.city}, ${l.state} ${l.zip}`}
              action={<div className="flex items-center gap-2">{l.rateRegion ? <Badge>{l.rateRegion.name}</Badge> : null}<ActionForm action={archiveLocationAction} confirm="Archive this location?" successMessage={false}><input type="hidden" name="locationId" value={l.id} /><button className="text-xs text-slate-400 hover:text-red-600">Archive</button></ActionForm></div>}
            />
            <CardBody><LocationForm loc={l} /></CardBody>
          </Card>
        ))}
        <Card>
          <CardHeader title="Add a location" />
          <CardBody><LocationForm /></CardBody>
        </Card>
      </div>
    </>
  );
}
