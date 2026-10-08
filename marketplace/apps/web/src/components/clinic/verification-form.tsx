import { FileText } from "lucide-react";
import { US_STATES } from "@cm/core";
import type { clinicVerify } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import type { formAction } from "@/lib/action";

/** The clinic verification form: the owner on Settings → Clinic verification, or an admin entering it for the clinic. */
export function VerificationForm({
  action,
  v,
  professions,
  mode,
  clinicOrgId,
}: {
  action: ReturnType<typeof formAction>;
  v: Awaited<ReturnType<typeof clinicVerify.myVerification>>;
  professions: { code: string; displayName: string }[];
  mode: "clinic" | "admin";
  clinicOrgId?: string;
}) {
  const p = v.prefill;
  const rows = Array.from({ length: Math.max(3, p.owners.length + 1) }, (_, i) => p.owners[i] ?? null).slice(0, 6);
  const states = Object.entries(US_STATES);
  return (
    <ActionForm action={action} className="space-y-6">
      {clinicOrgId ? <input type="hidden" name="clinicOrgId" value={clinicOrgId} /> : null}
      <Card>
        <CardHeader title="1. Your business" description={v.rule ? `As registered with ${v.rule.entityRegistry}.` : "As registered with your state."} />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="Legal business name" className="sm:col-span-2"><Input name="entityName" defaultValue={p.entityName} required /></Field>
          <Field label="State it's registered in">
            <Select name="entityState" defaultValue={p.entityState || v.state || "FL"} required>
              {states.map(([code, name]) => <option key={code} value={code}>{name}</option>)}
            </Select>
          </Field>
          <Field label="State registration (document) number" hint={v.rule ? <>Find it on <a href={v.rule.entityLookupUrl} target="_blank" rel="noreferrer" className="underline">{v.rule.entityRegistry}</a>.</> : undefined}>
            <Input name="entityNumber" defaultValue={p.entityNumber} required />
          </Field>
          <Field label="Organization NPI (type 2)" hint={<>10 digits. Look it up on the <a href="https://npiregistry.cms.hhs.gov/" target="_blank" rel="noreferrer" className="underline">NPI registry</a>. Leave blank if the clinic doesn&apos;t have one; we&apos;ll check another way.</>}>
            <Input name="orgNpi" inputMode="numeric" maxLength={10} defaultValue={p.orgNpi ?? ""} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="2. Who owns the clinic" description="Everyone with an ownership share. Shares should add up to 100%. Leave extra rows blank." />
        <CardBody className="space-y-4">
          {rows.map((o, i) => (
            <fieldset key={i} className="grid gap-3 rounded-xl border border-slate-200 p-4 sm:grid-cols-6">
              <legend className="px-1 text-sm font-medium text-slate-700">Owner {i + 1}</legend>
              <Field label="Full legal name" className="sm:col-span-3"><Input name={`owner${i}_name`} defaultValue={o?.name ?? ""} required={i === 0} /></Field>
              <Field label="Share (%)"><Input name={`owner${i}_percent`} inputMode="decimal" defaultValue={o?.percent ? String(o.percent) : ""} required={i === 0} /></Field>
              <Field label="Licensed practitioner?" className="sm:col-span-2">
                <Select name={`owner${i}_licensed`} defaultValue={o ? (o.licensed ? "yes" : "no") : "yes"}>
                  <option value="yes">Yes, licensed</option>
                  <option value="no">No (investor / business owner)</option>
                </Select>
              </Field>
              <Field label="Profession" className="sm:col-span-2">
                <Select name={`owner${i}_profession`} defaultValue={o?.professionCode ?? "DC"}>
                  {professions.map((x) => <option key={x.code} value={x.code}>{x.displayName}</option>)}
                </Select>
              </Field>
              <Field label="License state">
                <Select name={`owner${i}_state`} defaultValue={o?.licenseState ?? v.state ?? "FL"}>
                  {states.map(([code]) => <option key={code} value={code}>{code}</option>)}
                </Select>
              </Field>
              <Field label="License number" className="sm:col-span-2"><Input name={`owner${i}_license`} defaultValue={o?.licenseNumber ?? ""} /></Field>
              <Field label="Their NPI (optional)"><Input name={`owner${i}_npi`} inputMode="numeric" maxLength={10} defaultValue={o?.npi ?? ""} /></Field>
            </fieldset>
          ))}
          <p className="text-xs text-slate-500">More than {rows.length} owners? Add the largest ones here and list the rest in an uploaded document.</p>
        </CardBody>
      </Card>

      <Card>
        <CardHeader
          title={`3. ${v.rule?.facilityLicenseName ?? "Clinic license"}`}
          description={
            v.rule?.nonPractitionerOwners === "FACILITY_LICENSE"
              ? `Needed when any owner isn't a licensed practitioner. ${v.rule.note ?? ""}`
              : "If your state licenses clinics, enter it here."
          }
        />
        <CardBody className="grid gap-4 sm:grid-cols-2">
          <Field label="License number" hint={v.rule?.facilityLicenseLookupUrl ? <>As shown on <a href={v.rule.facilityLicenseLookupUrl} target="_blank" rel="noreferrer" className="underline">the state&apos;s lookup</a>.</> : undefined}>
            <Input name="facilityLicenseNumber" defaultValue={p.facilityLicenseNumber ?? ""} />
          </Field>
          <Field label="Or: certificate of exemption number" hint="Clinics wholly owned by licensed practitioners may hold one instead (optional).">
            <Input name="facilityExemptionNumber" defaultValue={p.facilityExemptionNumber ?? ""} />
          </Field>
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="4. Documents" description="A copy of the clinic license (required when an owner isn't a licensed practitioner). Articles of organization or the latest annual report help too. PDF or photo, up to 10 MB each. Never upload patient information." />
        <CardBody className="space-y-3">
          {p.documentKeys.length ? (
            <ul className="space-y-1 text-sm">
              {p.documentKeys.map((k, i) => (
                <li key={k}>
                  <label className="flex items-center gap-2">
                    <input type="checkbox" name="keepDocument" value={k} defaultChecked className="size-4 rounded border-slate-300" />
                    <a href={`/api/files/${k}`} target="_blank" className="flex items-center gap-1 text-brand-700"><FileText className="size-4" />Document {i + 1}</a>
                    <span className="text-xs text-slate-500">(untick to remove)</span>
                  </label>
                </li>
              ))}
            </ul>
          ) : null}
          <input type="file" name="documents" multiple accept="application/pdf,image/png,image/jpeg,image/webp" className="block text-sm" />
      <Checkbox name="documentsLater" label={mode === "admin" ? "The clinic will email the documents (upload them on the review page when they arrive)" : "Having trouble uploading? Tick this and email the documents to us instead; we'll attach them for you."} />
        </CardBody>
      </Card>

      <Card>
        <CardHeader title="5. Ownership statement" />
        <CardBody className="space-y-3">
          <p className="rounded-xl bg-slate-50 p-4 text-sm text-slate-700">{v.attestText}</p>
          {mode === "admin" ? (
            <>
              <Checkbox name="attest" required label="The owner confirmed this statement to me." />
              <Field label="Owner's full name"><Input name="attestName" required className="max-w-sm" /></Field>
              <Field label="How they gave you these details and confirmed the statement" hint="Kept with the record, e.g. “Phone call with Dr. Doe, Oct 9; documents by email.”"><Textarea name="adminNote" required /></Field>
              <SubmitButton>Submit for the clinic</SubmitButton>
            </>
          ) : (
            <>
              <Checkbox name="attest" required label="I confirm the statement above." />
              <Field label="Type your full name to sign"><Input name="attestName" required className="max-w-sm" /></Field>
              <SubmitButton>{v.status === "VERIFIED" ? "Renew verification" : "Submit for verification"}</SubmitButton>
            </>
          )}
        </CardBody>
      </Card>
    </ActionForm>
  );
}
