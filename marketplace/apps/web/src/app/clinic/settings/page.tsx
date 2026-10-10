import { textingEnabled } from "@cm/integrations";
import Link from "next/link";
import { AGREEMENT_VERSION, latestSignedAgreement, clinicProfile } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input, Select } from "@/components/ui/form";
import { InfoTip } from "@/components/ui/info-tip";
import { Alert, PageHeader } from "@/components/ui/misc";
import { dateLabel } from "@/lib/format";
import { getSession, requireActor } from "@/lib/session";
import { AddProviderSideCard } from "@/components/workspace/add-side";
import { GoogleAccountCard } from "@/components/site/google-account";
import { agreementAction, clinicPhoneConfirmAction, experienceAction, clinicPhoneStartAction, orgAction, passwordAction } from "../actions";

export const metadata = { title: "Settings" };

export default async function Settings({ searchParams }: { searchParams: Promise<{ google?: string }> }) {
  const { google: googleNotice } = await searchParams;
  const { actor, user } = await requireActor("clinic");
  const { org } = await clinicProfile(actor);
  const owner = actor.role === "CLINIC_OWNER";
  const signed = org.agreementVersion === AGREEMENT_VERSION.CLINIC && org.agreementSignedAt;
  const signedCopy = await latestSignedAgreement("CLINIC", org.id);
  const texting = textingEnabled();
  // Owners can add a provider side to this login (picking up shifts at other clinics on their days off).
  const canAddProvider = owner && !(await getSession())?.workspaces.provider;
  return (
    <>
      <PageHeader title="Settings" />
      <div className="space-y-6">
        <Card id="verification">
          <CardHeader title="Clinic verification" description="We confirm who owns every clinic on the platform. Your shifts go out to providers once your clinic is verified." />
          <CardBody>
            <Link href="/clinic/settings/verification" className="text-sm font-medium text-brand-700">
              {org.verificationStatus === "VERIFIED" ? "Verified · view or renew →" : org.verificationStatus === "PENDING" ? "Under review · view →" : "Verify your clinic →"}
            </Link>
          </CardBody>
        </Card>
        <Card>
          <CardHeader title="Clinic" />
          <CardBody>
            <ActionForm action={orgAction} className="grid gap-4 sm:grid-cols-2">
              <Field label="Legal business name"><Input name="legalName" defaultValue={org.legalName} required disabled={!owner} /></Field>
              <Field label="Display name"><Input name="displayName" defaultValue={org.displayName} required disabled={!owner} /></Field>
              <Field label="Phone"><Input name="phone" defaultValue={org.phone ?? ""} disabled={!owner} /></Field>
              <Field label="Billing email"><Input name="billingEmail" type="email" defaultValue={org.billingEmail ?? ""} disabled={!owner} /></Field>
              {owner ? <div className="sm:col-span-2"><SubmitButton>Save</SubmitButton></div> : null}
            </ActionForm>
          </CardBody>
        </Card>
        <Card id="texts">
          <CardHeader title="Text alerts" description="Get a text when your provider is on the way, if they cancel or don't show, and when a replacement is confirmed." />
          <CardBody className="space-y-3">
            {!texting ? <Alert tone="info" title="By email for now">Text alerts are coming soon. Until then, these alerts are emailed to {user.email}.</Alert> : null}
            {texting && user.phoneVerifiedAt ? <Alert tone="success">Texts go to <strong>{user.phone}</strong>.</Alert> : null}
            {texting ? (<>
            <ActionForm action={clinicPhoneStartAction} className="flex gap-2">
              <Input name="phone" type="tel" placeholder="Your mobile, e.g. (407) 555-0123" defaultValue={user.phone ?? ""} required className="max-w-xs" />
              <SubmitButton variant="outline">Send code</SubmitButton>
            </ActionForm>
            <ActionForm action={clinicPhoneConfirmAction} className="flex gap-2">
              <Input name="code" inputMode="numeric" maxLength={6} placeholder="6-digit code" required className="max-w-40" />
              <SubmitButton size="md">Verify</SubmitButton>
            </ActionForm>
            <p className="text-xs text-slate-500">By verifying, you agree to receive shift alerts by text. Message frequency varies. Msg &amp; data rates may apply. Reply STOP to opt out, HELP for help. <a href="/privacy" target="_blank" className="underline">Privacy</a> · <a href="/terms" target="_blank" className="underline">Terms</a></p>
            </>) : null}
          </CardBody>
        </Card>
        <Card id="experience">
          <CardHeader title={<>Provider experience<InfoTip label="About experience">New shifts start with this minimum, and you can change it on each shift. Providers enter their years of practice, which can&apos;t exceed the years since they graduated. With the emergency option on, a last-minute replacement can come from any qualified provider.</InfoTip></>} description="The minimum years of experience for your new shifts. You can change it on any shift when you post it." />
          <CardBody>
            <ActionForm action={experienceAction} className="space-y-4">
              <Field label="Minimum experience" htmlFor="minYears" hint="A higher minimum means fewer providers can take your shifts, so they may take longer to fill.">
                <Select id="minYears" name="minYears" defaultValue={String(org.minYearsExperience)} className="max-w-xs">
                  <option value="0">Any experience</option>
                  <option value="2">2+ years</option>
                  <option value="5">5+ years</option>
                  <option value="10">10+ years</option>
                </Select>
              </Field>
              <Checkbox name="relax" defaultChecked={org.relaxExperienceInEmergency} label="Relax this in emergencies — when a provider cancels last-minute or doesn't show, any qualified provider can step in." />
              <SubmitButton variant="outline">Save</SubmitButton>
            </ActionForm>
          </CardBody>
        </Card>
        <Card id="agreement">
          <CardHeader title="Clinic Platform Agreement" />
          <CardBody>
            {signed ? (
              <Alert tone="success">Signed {dateLabel(org.agreementSignedAt!)} (version {org.agreementVersion}).{signedCopy ? <> <Link href={`/agreements/signed/${signedCopy.id}`} className="font-medium underline">View or print your signed copy</Link></> : null}</Alert>
            ) : owner ? (
              <ActionForm action={agreementAction} successMessage={false}>
                <p className="mb-3 text-sm text-slate-600">Covers pricing, deposits and cancellations, payment authorization, supervision responsibilities, no patient information on the platform, and non-circumvention.</p>
                <SubmitButton>{org.agreementSignedAt ? "Review & sign the updated agreement" : "Review & sign"}</SubmitButton>
              </ActionForm>
            ) : <p className="text-sm text-slate-500">The clinic owner needs to sign the agreement.</p>}
          </CardBody>
        </Card>
        {canAddProvider ? <AddProviderSideCard /> : null}
        <GoogleAccountCard connected={!!user.googleSub} hasPassword={!!user.passwordHash} back="/clinic/settings" notice={googleNotice} />
        <Card>
          <CardHeader title="Password" />
          <CardBody>
            {user.passwordHash ? (
              <ActionForm action={passwordAction} className="grid gap-3 sm:grid-cols-3" resetOnSuccess>
                <Input className="req-mark" name="current" type="password" placeholder="Current password" required />
                <Input className="req-mark" name="next" type="password" placeholder="New password" minLength={10} required />
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
