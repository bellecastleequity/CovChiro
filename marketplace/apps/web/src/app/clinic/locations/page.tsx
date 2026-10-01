import { env } from "@cm/config";
import { prisma } from "@cm/db";
import { ATTIRE_OPTIONS, clinicProfile, MAX_LOCATION_PHOTOS } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { AddressInput } from "@/components/ui/address-input";
import { Badge } from "@/components/ui/badge";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { PageHeader } from "@/components/ui/misc";
import { requireActor } from "@/lib/session";
import { archiveLocationAction, locationAction, locationPhotosAction, removeLocationPhotoAction } from "../actions";

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
        <AddressInput name="address" defaultValue={loc ? `${loc.addressLine1}, ${loc.city}, ${loc.state} ${loc.zip}` : ""} placeholder="Start typing the address…" required browserKey={env().GOOGLE_MAPS_BROWSER_KEY} />
      </Field>
      <Field label="Suite / unit"><Input name="addressLine2" defaultValue={loc?.addressLine2 ?? ""} /></Field>
      <Field label="On-site contact"><Input name="onSiteContactName" defaultValue={loc?.onSiteContactName ?? ""} /></Field>
      <Field label="Patients per day"><Input name="patientsPerDay" type="number" defaultValue={loc?.patientsPerDay ?? ""} /></Field>
      <Field label="EHR"><Input name="ehr" defaultValue={loc?.ehr ?? ""} /></Field>
      <Field label="Equipment (comma-separated)" className="sm:col-span-2"><Input name="equipment" defaultValue={loc?.equipment.join(", ")} placeholder="Drop tables, X-ray, e-stim" /></Field>
      <Field label="Provider attire" htmlFor={`dressCode-${loc?.id ?? "new"}`} hint="What you'd like providers to wear here. Shown before they apply.">
        <Select id={`dressCode-${loc?.id ?? "new"}`} name="dressCode" required defaultValue={loc?.dressCode && (ATTIRE_OPTIONS as readonly string[]).includes(loc.dressCode) ? loc.dressCode : ""}>
          <option value="" disabled>Select one</option>
          {ATTIRE_OPTIONS.map((a) => <option key={a} value={a}>{a}</option>)}
        </Select>
      </Field>
      <fieldset>
        <legend className="mb-1.5 text-sm font-medium text-slate-700">We post shifts for</legend>
        <div className="flex flex-wrap gap-x-4 gap-y-2">
          {professions.map((p) => <Checkbox key={p.code} name="professions" value={p.code} defaultChecked={chosen.includes(p.code)} label={`${p.displayName}${p.active ? "" : " (soon)"}`} />)}
        </div>
      </fieldset>
      <Field label="How to find us — cheat sheet for your provider (optional)" className="sm:col-span-2" hint="Parking, which entrance, door codes, who to ask for, where to put their things. Shown only to the provider booked here.">
        <Textarea name="arrivalNotes" defaultValue={loc?.arrivalNotes ?? ""} placeholder={"Park behind the building, not in patient spots.\nUse the side door by the blue awning.\nAsk for Maria at the front desk."} />
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
            <CardBody className="border-t border-slate-100">
              <div className="mb-3">
                <div className="text-sm font-medium text-slate-700">Photos to help providers find you (optional)</div>
                <p className="text-sm text-slate-500">The building, your sign or the entrance to use. Up to {MAX_LOCATION_PHOTOS} (JPG, PNG or WebP; if an upload fails, try one photo at a time). Only the provider booked here sees them.</p>
              </div>
              {l.photoKeys.length ? (
                <div className="mb-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
                  {l.photoKeys.map((k) => (
                    <div key={k} className="relative">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={`/api/files/${k}`} alt="Clinic exterior" className="aspect-[4/3] w-full rounded-xl object-cover ring-1 ring-slate-200" />
                      <ActionForm action={removeLocationPhotoAction} className="absolute right-1.5 top-1.5" successMessage={false} confirm="Remove this photo?">
                        <input type="hidden" name="locationId" value={l.id} />
                        <input type="hidden" name="key" value={k} />
                        <button className="rounded-full bg-white/90 px-2 py-0.5 text-xs text-slate-600 shadow hover:text-red-600">Remove</button>
                      </ActionForm>
                    </div>
                  ))}
                </div>
              ) : null}
              {l.photoKeys.length < MAX_LOCATION_PHOTOS ? (
                <ActionForm action={locationPhotosAction} className="flex flex-wrap items-center gap-3" resetOnSuccess>
                  <input type="hidden" name="locationId" value={l.id} />
                  <input type="file" name="photos" accept="image/jpeg,image/png,image/webp" multiple required className="text-sm" />
                  <SubmitButton size="sm" variant="secondary">Upload photos</SubmitButton>
                </ActionForm>
              ) : null}
            </CardBody>
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
