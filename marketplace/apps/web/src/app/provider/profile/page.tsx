import Link from "next/link";
import { env } from "@cm/config";
import { prisma } from "@cm/db";
import { AGREEMENT_VERSION, latestSignedAgreement } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { AddressInput } from "@/components/ui/address-input";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Alert, PageHeader } from "@/components/ui/misc";
import { dateLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { agreementAction, passwordAction, profileAction, studentModeAction } from "../actions";
import { getSettings } from "@cm/services";
import { StudentFields } from "@/components/provider/student-fields";

export const metadata = { title: "Profile" };

export default async function Profile() {
  const { actor, user } = await requireActor("provider");
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: actor.providerId! }, include: { professions: { include: { profession: true } } } });
  const signed = p.agreementVersion === AGREEMENT_VERSION.PROVIDER && p.agreementSignedAt;
  const signedCopy = await latestSignedAgreement("PROVIDER", p.id);
  const studentEnabled = (await getSettings())["features.preLicensureEnabled"];
  const hasVerifiedLicense = (await prisma.license.count({ where: { providerId: p.id, status: "VERIFIED", expiresAt: { gt: new Date() } } })) > 0;
  const studentDefaults = {
    school: p.school, graduationDate: p.graduationDate?.toISOString().slice(0, 10) ?? null, intendedStates: p.intendedStates, licensureApplied: p.licensureApplied,
    expectedLicensure: p.expectedLicensure, homeZip: p.homeZip, maxDriveMinutes: p.maxDriveMinutes, preferredArea: p.preferredArea, smsConsent: !!p.smsConsentAt,
  };
  return (
    <>
      <PageHeader title="Profile" description="Clinics see your photo, name, headline, About me, credentials, skills, ratings and badges — never your home address or phone." actions={<a href={`/provider/profile/public`} className="text-sm font-medium text-brand-700">Preview public profile →</a>} />
      <div className="space-y-6">
        <Card>
          <CardHeader title="About you" />
          <CardBody>
            <ActionForm action={profileAction} className="grid gap-4 sm:grid-cols-2">
              <Field label="Legal name (as on your license)"><Input name="legalName" defaultValue={p.legalName} required /></Field>
              <Field label="Display name" hint='e.g. "Dr. Jane Rivera"'><Input name="displayName" defaultValue={p.displayName} required /></Field>
              <Field label="Mobile phone" hint={user.phoneVerifiedAt ? "Verified. Change it on the On Call page." : "Verify it on the On Call page to get text offers."}><Input name="phone" type="tel" defaultValue={user.phone ?? ""} required readOnly={!!user.phoneVerifiedAt} /></Field>
              <Field label="Headline" hint='e.g. "Sports & family chiropractor · 12 years"' className="sm:col-span-2"><Input name="headline" defaultValue={p.headline ?? ""} maxLength={120} /></Field>
              <Field label="LinkedIn profile" hint="linkedin.com/in/your-name"><Input name="linkedinUrl" defaultValue={p.linkedinUrl ?? ""} placeholder="https://www.linkedin.com/in/…" /></Field>
              {p.professions.map((x) => (
                <Field key={x.professionCode} label={`Years practicing — ${x.profession.displayName}`}><Input name={`years-${x.professionCode}`} type="number" min={0} max={70} defaultValue={x.yearsInPractice ?? ""} /></Field>
              ))}
              <Field label="NPI" hint={p.npiVerifiedAt ? "Verified with the NPPES registry." : p.npiMismatch ? "Name didn't match the registry — our team is reviewing." : "10 digits."}><Input name="npi" defaultValue={p.npi ?? ""} inputMode="numeric" maxLength={10} /></Field>
              <Field label="Home base address" hint="Used for drive times and mileage. Never shown to clinics." className="sm:col-span-2"><AddressInput name="homeAddress" defaultValue={p.homeAddress ?? ""} placeholder="Start typing your address…" required browserKey={env().GOOGLE_MAPS_BROWSER_KEY} /></Field>
              <Field label="Max one-way drive (minutes)"><Input name="maxDriveMinutes" type="number" min={10} max={600} defaultValue={p.maxDriveMinutes} required /></Field>
              <Field label="Max patients per day (optional)"><Input name="maxPatientsPerDay" type="number" defaultValue={p.maxPatientsPerDay ?? ""} /></Field>
              <Field label="Personal injury experience" hint="Treated auto-accident / PI patients (documentation, PIP, attorney cases).">
                <Select name="personalInjuryExperience" defaultValue={p.personalInjuryExperience === null ? "" : p.personalInjuryExperience ? "yes" : "no"} required>
                  <option value="" disabled>Choose…</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </Select>
              </Field>
              <Field label="School"><Input name="school" defaultValue={p.school ?? ""} /></Field>
              <Field label="Graduation year" hint="Years practicing can't be more than the years since you graduated."><Input name="graduationYear" type="number" min={1950} max={new Date().getFullYear()} defaultValue={p.graduationYear ?? ""} /></Field>
              <Field label="Languages (comma-separated)"><Input name="languages" defaultValue={p.languages.join(", ")} /></Field>
              <Field label="EHR systems you know"><Input name="ehrSystems" defaultValue={p.ehrSystems.join(", ")} /></Field>
              <Field label="About me" className="sm:col-span-2" hint="Your approach, techniques, the kinds of practices you love covering."><Textarea name="bio" defaultValue={p.bio ?? ""} maxLength={1500} required /></Field>
              <Field label="Headshot" hint="A clear, friendly photo of your face.">{p.photoUrl ? <img src={`/api/files/${p.photoUrl}`} alt="" className="mb-2 size-16 rounded-full object-cover" /> : null}<Input name="photo" type="file" accept="image/*" /></Field>
              <div className="space-y-2 pt-6">
                <Checkbox name="willingOvernight" defaultChecked={p.willingOvernight} label="Willing to stay overnight for distant shifts" />
                <Checkbox name="xrayComfort" defaultChecked={p.xrayComfort} label="Comfortable taking/reading X-rays" />
              </div>
              <div className="sm:col-span-2"><SubmitButton>Save profile</SubmitButton></div>
            </ActionForm>
          </CardBody>
        </Card>
        {studentEnabled && (p.preLicensure || !hasVerifiedLicense) ? (
          <Card id="student">
            <CardHeader
              title="Student / not yet licensed"
              description={p.preLicensure ? "You're on the student path: we'll check in about your license and malpractice and show your coverage readiness. It turns off by itself once both are verified." : "Still in school or waiting on your license? Turn this on and we'll guide you to coverage-ready."}
            />
            <CardBody>
              {p.preLicensure ? (
                <>
                  <ActionForm action={studentModeAction} className="space-y-4">
                    <input type="hidden" name="on" value="1" />
                    <StudentFields withPhone={false} defaults={studentDefaults} />
                    <SubmitButton>Save student details</SubmitButton>
                  </ActionForm>
                  <ActionForm action={studentModeAction} className="mt-3">
                    <input type="hidden" name="on" value="0" />
                    <SubmitButton variant="ghost" size="sm">I'm not a student — turn this off</SubmitButton>
                  </ActionForm>
                </>
              ) : (
                <details>
                  <summary className="cursor-pointer text-sm font-medium text-brand-700">I'm a student / not yet licensed</summary>
                  <ActionForm action={studentModeAction} className="mt-4 space-y-4">
                    <input type="hidden" name="on" value="1" />
                    <StudentFields withPhone={false} defaults={studentDefaults} />
                    <SubmitButton>Turn on the student path</SubmitButton>
                  </ActionForm>
                </details>
              )}
            </CardBody>
          </Card>
        ) : null}
        <Card id="agreement">
          <CardHeader title="Provider Platform Agreement" />
          <CardBody>
            {signed ? (
              <Alert tone="success">Signed {dateLabel(p.agreementSignedAt!)} (version {p.agreementVersion}).{signedCopy ? <> <Link href={`/agreements/signed/${signedCopy.id}`} className="font-medium underline">View or print your signed copy</Link></> : null}</Alert>
            ) : (
              <ActionForm action={agreementAction} successMessage={false}>
                <p className="mb-3 text-sm text-slate-600">Covers independent-contractor status, keeping your credentials current (and reporting any board action within 24 hours), cancellations, pay, standing bookings and non-circumvention.</p>
                <SubmitButton>{p.agreementSignedAt ? "Review & sign the updated agreement" : "Review & sign"}</SubmitButton>
              </ActionForm>
            )}
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Password" />
          <CardBody>
            <ActionForm action={passwordAction} className="grid gap-3 sm:grid-cols-3" resetOnSuccess>
              <Input name="current" type="password" placeholder="Current password" required autoComplete="current-password" />
              <Input name="next" type="password" placeholder="New password" minLength={10} required autoComplete="new-password" />
              <SubmitButton variant="outline">Change password</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
      </div>
    </>
  );
}
