import { prisma } from "@cm/db";
import { AGREEMENT_VERSION } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Textarea } from "@/components/ui/form";
import { Alert, PageHeader } from "@/components/ui/misc";
import { dateLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { agreementAction, passwordAction, profileAction } from "../actions";

export const metadata = { title: "Profile" };

export default async function Profile() {
  const { actor, user } = await requireActor("provider");
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: actor.providerId! }, include: { professions: { include: { profession: true } } } });
  const signed = p.agreementVersion === AGREEMENT_VERSION.PROVIDER && p.agreementSignedAt;
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
              <Field label="Home base address" hint="Used for drive times and mileage. Never shown to clinics." className="sm:col-span-2"><Input name="homeAddress" defaultValue={p.homeAddress ?? ""} placeholder="Street, City, ST ZIP" required /></Field>
              <Field label="Max one-way drive (minutes)"><Input name="maxDriveMinutes" type="number" min={10} max={600} defaultValue={p.maxDriveMinutes} required /></Field>
              <Field label="Max patients per day (optional)"><Input name="maxPatientsPerDay" type="number" defaultValue={p.maxPatientsPerDay ?? ""} /></Field>
              <Field label="School"><Input name="school" defaultValue={p.school ?? ""} /></Field>
              <Field label="Graduation year"><Input name="graduationYear" type="number" defaultValue={p.graduationYear ?? ""} /></Field>
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
        <Card id="agreement">
          <CardHeader title="Provider Platform Agreement" />
          <CardBody>
            {signed ? (
              <Alert tone="success">Signed {dateLabel(p.agreementSignedAt!)} (version {p.agreementVersion}).</Alert>
            ) : (
              <ActionForm action={agreementAction} successMessage={false}>
                <p className="mb-3 text-sm text-slate-600">Covers independent-contractor status, keeping your credentials current (and reporting any board action within 24 hours), cancellations, payment terms and conduct.</p>
                <SubmitButton>Review & sign</SubmitButton>
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
