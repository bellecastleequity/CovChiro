import Link from "next/link";
import { env } from "@cm/config";
import { prisma } from "@cm/db";
import { textingEnabled } from "@cm/integrations";
import { AGREEMENT_VERSION, latestSignedAgreement } from "@cm/services";
import { InfoTip } from "@/components/ui/info-tip";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { AddressInput } from "@/components/ui/address-input";
import { Checkbox, Field, Input, Select, Textarea } from "@/components/ui/form";
import { Alert, PageHeader } from "@/components/ui/misc";
import { dateLabel } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { GoogleAccountCard } from "@/components/site/google-account";
import { agreementAction, passwordAction, payFloorAction, profileAction, studentModeAction } from "../actions";
import { breaks, getSettings, payfloors, schools } from "@cm/services";
import { PauseCircle, PlayCircle } from "lucide-react";
import { StudentFields } from "@/components/provider/student-fields";

export const metadata = { title: "Profile" };

export default async function Profile({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { google: googleNotice } = await searchParams;
  const { actor, user } = await requireActor("provider");
  const p = await prisma.provider.findUniqueOrThrow({ where: { id: actor.providerId! }, include: { professions: { include: { profession: true } } } });
  const signed = p.agreementVersion === AGREEMENT_VERSION.PROVIDER && p.agreementSignedAt;
  const signedCopy = await latestSignedAgreement("PROVIDER", p.id);
  const brk = await breaks.breakStatus(p.id);
  const onBreak = brk.onBreak || brk.scheduled;
  const studentEnabled = (await getSettings())["features.preLicensureEnabled"];
  const hasVerifiedLicense = (await prisma.license.count({ where: { providerId: p.id, status: "VERIFIED", expiresAt: { gt: new Date() } } })) > 0;
  const schoolGroups = await schools.schoolOptions(p.professions.map((pp) => pp.professionCode));
  const floors = await payfloors.myPayFloors(actor);
  const licStates = [...new Set((await prisma.license.findMany({ where: { providerId: p.id, status: "VERIFIED" }, select: { state: true } })).map((l) => l.state).filter((x) => x !== "US"))];
  const guidance = await Promise.all(p.professions.map(async (pp) => ({ code: pp.professionCode, g: await payfloors.payGuidance(pp.professionCode, licStates) })));
  const dollars = (c: number | null | undefined) => (c ? String(c / 100) : "");
  const studentDefaults = {
    school: p.school, graduationDate: p.graduationDate?.toISOString().slice(0, 10) ?? null, intendedStates: p.intendedStates, licensureApplied: p.licensureApplied,
    expectedLicensure: p.expectedLicensure, homeZip: p.homeZip, maxDriveMinutes: p.maxDriveMinutes, preferredArea: p.preferredArea, smsConsent: !!p.smsConsentAt,
  };
  return (
    <>
      <p className="mb-1 text-sm font-medium text-accent-700">Member since {dateLabel(p.createdAt, "UTC", { month: "long", year: "numeric" })} · only you see this</p>
      <PageHeader title="Profile" description="Clinics see your photo, name, headline, About me, credentials, skills, ratings and badges — never your home address or phone." actions={
          <div className="flex flex-wrap items-center gap-3">
            <a href={`/provider/profile/public`} className="text-sm font-medium text-brand-700">Preview public profile →</a>
            {onBreak ? (
              <Link href="/provider/break" className="inline-flex items-center gap-1.5 rounded-xl bg-emerald-600 px-3 py-2 text-sm font-semibold text-white hover:bg-emerald-700"><PlayCircle className="size-4" />Resume coverage</Link>
            ) : (
              <Link href="/provider/break" className="inline-flex items-center gap-1.5 rounded-xl border border-amber-300 bg-amber-50 px-3 py-2 text-sm font-semibold text-amber-900 hover:bg-amber-100"><PauseCircle className="size-4" />Taking a break</Link>
            )}
          </div>
        } />
      <div className="space-y-6">
        <Card>
          <CardHeader title="About you" />
          <CardBody>
            <ActionForm action={profileAction} className="grid gap-4 sm:grid-cols-2">
              <Field label={<>Legal name (as on your license)<InfoTip label="About legal name">Must match your license exactly. We verify your license, NPI and malpractice policy against it. Clinics see your display name, not this.</InfoTip></>}><Input name="legalName" defaultValue={p.legalName} required /></Field>
              <Field label="Display name" hint='e.g. "Dr. Jane Rivera"'><Input name="displayName" defaultValue={p.displayName} required /></Field>
              <Field label={<>Mobile phone<InfoTip label="About your phone">For account and shift alerts from us. It&apos;s never shown to clinics; you and clinics talk through Messages on the site.</InfoTip></>} hint={user.phoneVerifiedAt ? "Verified. Change it on the On Call page." : textingEnabled() ? "Verify it on the On Call page to get text offers." : "Alerts come by email for now."}><Input name="phone" type="tel" defaultValue={user.phone ?? ""} required readOnly={!!user.phoneVerifiedAt} /></Field>
              <Field label="Headline" hint='e.g. "Sports & family chiropractor · 12 years"' className="sm:col-span-2"><Input name="headline" defaultValue={p.headline ?? ""} maxLength={120} /></Field>
              <Field label="LinkedIn profile" hint="linkedin.com/in/your-name"><Input name="linkedinUrl" defaultValue={p.linkedinUrl ?? ""} placeholder="https://www.linkedin.com/in/…" /></Field>
              {p.professions.map((x) => (
                <Field key={x.professionCode} label={<>Years practicing — {x.profession.displayName}<InfoTip label="About years practicing">Clinics can ask for a minimum (2+, 5+ or 10+ years), and you&apos;re only matched to those shifts if you meet it. It can&apos;t be more than the years since your graduation year.</InfoTip></>}><Input name={`years-${x.professionCode}`} type="number" min={0} max={70} defaultValue={x.yearsInPractice ?? ""} /></Field>
              ))}
              <Field label={<>NPI<InfoTip label="About NPI">Your 10-digit National Provider Identifier. We check it, with your name, against the national NPPES registry. Required for professions that bill under an NPI.</InfoTip></>} hint={p.npiVerifiedAt ? "Verified with the NPPES registry." : p.npiMismatch ? "Name didn't match the registry — our team is reviewing." : "10 digits."}><Input name="npi" defaultValue={p.npi ?? ""} inputMode="numeric" maxLength={10} /></Field>
              <Field label="Home base address" hint="Used for drive times and mileage. Never shown to clinics." className="sm:col-span-2"><AddressInput name="homeAddress" defaultValue={p.homeAddress ?? ""} placeholder="Start typing your address…" required browserKey={env().GOOGLE_MAPS_BROWSER_KEY} /></Field>
              <Field label={<>Max one-way drive (minutes)<InfoTip label="About max drive">The longest you&apos;ll drive to a shift, from your home base. We only offer shifts within this drive time. Emergency cover may offer one a little farther, which you&apos;re free to decline. Mileage is paid on top of shift pay.</InfoTip></>}><Input name="maxDriveMinutes" type="number" min={10} max={600} defaultValue={p.maxDriveMinutes} required /></Field>
              <Field label={<>Max patients per day (optional)<InfoTip label="About max patients">Your preferred pace. Compare it with each shift&apos;s expected patients before you apply or set up On Call.</InfoTip></>}><Input name="maxPatientsPerDay" type="number" defaultValue={p.maxPatientsPerDay ?? ""} /></Field>
              <Field label="Personal injury experience" hint="Treated auto-accident / PI patients (documentation, PIP, attorney cases).">
                <Select name="personalInjuryExperience" defaultValue={p.personalInjuryExperience === null ? "" : p.personalInjuryExperience ? "yes" : "no"} required>
                  <option value="" disabled>Choose…</option>
                  <option value="yes">Yes</option>
                  <option value="no">No</option>
                </Select>
              </Field>
              <Field label="School"><Input name="school" defaultValue={p.school ?? ""} /></Field>
              {p.preLicensure && p.graduationDate ? (
                <Field label="Graduation" hint="Set in the student section below.">
                  <input type="hidden" name="graduationYear" value={p.graduationYear ?? ""} />
                  <p className="py-2 text-sm text-slate-700">{p.graduationDate.toLocaleDateString("en-US", { timeZone: "UTC", month: "long", day: "numeric", year: "numeric" })}{+p.graduationDate > Date.now() ? " (expected)" : ""}</p>
                </Field>
              ) : (
                <Field label="Graduation year" hint="Years practicing can't be more than the years since you graduated."><Input name="graduationYear" type="number" min={1950} max={new Date().getFullYear()} defaultValue={p.graduationYear ?? ""} /></Field>
              )}
              <Field label="Languages (comma-separated)"><Input name="languages" defaultValue={p.languages.join(", ")} /></Field>
              <Field label="EHR systems you know"><Input name="ehrSystems" defaultValue={p.ehrSystems.join(", ")} /></Field>
              <Field label="About me" className="sm:col-span-2" hint="Your approach, techniques, the kinds of practices you love covering."><Textarea name="bio" defaultValue={p.bio ?? ""} maxLength={1500} required /></Field>
              <Field label="Headshot" hint="A clear, friendly photo of your face.">{p.photoUrl ? <img src={`/api/files/${p.photoUrl}`} alt="" className="mb-2 size-16 rounded-full object-cover" /> : null}<Input name="photo" type="file" accept="image/*" /></Field>
              <div className="space-y-2 pt-6">
                <Checkbox name="willingOvernight" defaultChecked={p.willingOvernight} label={<>Willing to stay overnight for distant shifts<InfoTip label="About overnight shifts">You&apos;ll also be offered shifts beyond your normal drive time when the clinic covers lodging. You book the room and upload the receipt to be reimbursed.</InfoTip></>} />
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
                    <StudentFields schools={schoolGroups} withPhone={false} defaults={studentDefaults} />
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
                    <StudentFields schools={schoolGroups} withPhone={false} defaults={studentDefaults} />
                    <SubmitButton>Turn on the student path</SubmitButton>
                  </ActionForm>
                </details>
              )}
            </CardBody>
          </Card>
        ) : null}
        <Card id="min-pay">
          <CardHeader title="My minimum pay" description="Shifts paying less than this won't be shown or offered to you. Clinics never see it." />
          <CardBody className="space-y-6">
            {p.professions.map((pp) => {
              const f = floors.find((x) => x.professionCode === pp.professionCode);
              const g = guidance.find((x) => x.code === pp.professionCode)?.g;
              const hourly = pp.profession.pricingModel === "HOURLY";
              return (
                <ActionForm key={pp.professionCode} action={payFloorAction} className="space-y-3">
                  <input type="hidden" name="professionCode" value={pp.professionCode} />
                  {p.professions.length > 1 ? <div className="text-sm font-semibold text-slate-800">{pp.profession.displayName}</div> : null}
                  {g && (g.fullDay || g.halfDay || g.hourly) ? (
                    <p className="text-sm text-slate-600">Right now {pp.profession.displayName.toLowerCase()} shifts pay {hourly ? `${g.hourly} an hour` : [g.fullDay ? `${g.fullDay} for a full day` : null, g.halfDay ? `${g.halfDay} for a half day` : null].filter(Boolean).join(" and ")}, before extra visits and premiums.</p>
                  ) : null}
                  <div className="grid gap-3 sm:grid-cols-3">
                    {hourly ? (
                      <Field label="Per hour ($)"><Input name="minHourly" inputMode="decimal" defaultValue={dollars(f?.minHourlyCents)} placeholder="No minimum" /></Field>
                    ) : (
                      <>
                        <Field label="Full day ($)"><Input name="minFullDay" inputMode="decimal" defaultValue={dollars(f?.minFullDayCents)} placeholder="No minimum" /></Field>
                        <Field label="Half day ($)"><Input name="minHalfDay" inputMode="decimal" defaultValue={dollars(f?.minHalfDayCents)} placeholder="No minimum" /></Field>
                      </>
                    )}
                  </div>
                  <Checkbox name="includeMileage" defaultChecked={f?.includeMileage ?? false} label="Count mileage toward my minimum" />
                  <SubmitButton variant="outline" size="sm">Save minimum pay</SubmitButton>
                </ActionForm>
              );
            })}
            <p className="text-xs text-slate-500">A higher minimum means fewer shifts. Shifts you&apos;re already booked on stay booked if you raise it.</p>
          </CardBody>
        </Card>
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
        <GoogleAccountCard connected={!!user.googleSub} hasPassword={!!user.passwordHash} back="/provider/profile" notice={googleNotice} />
        <Card>
          <CardHeader title="Password" />
          <CardBody>
            {user.passwordHash ? (
              <ActionForm action={passwordAction} className="grid gap-3 sm:grid-cols-3" resetOnSuccess>
                <Input className="req-mark" name="current" type="password" placeholder="Current password" required autoComplete="current-password" />
                <Input className="req-mark" name="next" type="password" placeholder="New password" minLength={10} required autoComplete="new-password" />
                <SubmitButton variant="outline">Change password</SubmitButton>
              </ActionForm>
            ) : (
              <ActionForm action={passwordAction} className="grid gap-3 sm:grid-cols-3" resetOnSuccess>
                <p className="text-sm text-slate-600 sm:col-span-3">You sign in with Google. Set a password if you&apos;d also like to sign in with your email.</p>
                <Input className="req-mark" name="next" type="password" placeholder="New password" minLength={10} required autoComplete="new-password" />
                <SubmitButton variant="outline">Set password</SubmitButton>
              </ActionForm>
            )}
          </CardBody>
        </Card>
      </div>
    </>
  );
}
