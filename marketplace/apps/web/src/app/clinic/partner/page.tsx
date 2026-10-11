import { notFound } from "next/navigation";
import { BadgeCheck, Handshake, Lock, PiggyBank } from "lucide-react";
import { brand } from "@cm/config";
import { partners } from "@cm/services";
import { AgreementDocument } from "@/components/agreements/document";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { Alert, PageHeader, Stat } from "@/components/ui/misc";
import { dateLabel, money } from "@/lib/format";
import { requireActor } from "@/lib/session";
import { signPartnerAddendumAction } from "../actions";

const YMD: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

export const metadata = { title: "Partner clinic" };
export const dynamic = "force-dynamic";

/** Partner clinic program: the open offer (review + e-sign, owners) or the partnership in force. */
export default async function ClinicPartner({ searchParams }: { searchParams: Promise<{ signed?: string }> }) {
  const { actor } = await requireActor("clinic");
  const sp = await searchParams;
  const view = await partners.partnershipForClinic(actor);
  if (!view) notFound();
  const owner = actor.role === "CLINIC_OWNER";

  if (view.kind === "ACTIVE") {
    const p = view.p;
    const ending = p.status === "ENDED" && p.endedAt;
    const signed = await partners.signedPartnerAddendum(actor, p.id).catch(() => null);
    return (
      <>
        <PageHeader title="Partner clinic" description={`Thanks for booking all your coverage with ${brand().name}.`} />
        {sp.signed ? <Alert tone="success" className="mb-5" title="Welcome, partner">Your partner pricing applies to every shift you post from now on. A signed copy was emailed to you.</Alert> : null}
        {ending ? <Alert tone="warning" className="mb-5" title={`Partnership ends ${dateLabel(p.endedAt!, undefined, YMD)}`}>Partner pricing applies to shifts posted until then. Shifts already booked keep their price.</Alert> : null}
        <div className="grid gap-4 sm:grid-cols-3">
          <Stat label="Partner discount" value={`${p.discountPercent}% off`} hint="Every shift's coverage price" tone="green" />
          <Stat label="Rates locked until" value={dateLabel(p.term.termEnd, undefined, YMD)} hint={`Term ${p.term.termNumber} · renews every ${p.termMonths} months`} tone="brand" />
          <Stat label="Saved this term" value={money(view.discountsCents.cents)} hint={`${view.discountsCents.bookings} booking${view.discountsCents.bookings === 1 ? "" : "s"}`} />
        </div>
        <Card className="mt-6">
          <CardHeader title="How it works" />
          <CardBody className="space-y-2 text-sm text-slate-700">
            <p>Post shifts as usual. The partner discount is taken off the coverage price automatically, and your coverage prices can&apos;t go above the rates in effect on {dateLabel(p.term.termStart, undefined, YMD)}.</p>
            <p>If a shift is still unfilled {p.releaseHours} hours before it starts, you&apos;re free to cover it elsewhere.</p>
            <p>To end the partnership at the end of a term, let us know at least {p.noticeDays} days before {dateLabel(p.term.termEnd, undefined, YMD)}.</p>
            {signed ? <p><a className="font-medium text-brand-700 hover:underline" href={`/agreements/partner/${p.id}`}>View your signed Partner Addendum</a></p> : null}
          </CardBody>
        </Card>
      </>
    );
  }

  // Open offer.
  const p = view.p;
  const sign = owner ? await partners.partnerAddendumForSigning(actor).catch(() => null) : null;
  return (
    <>
      <PageHeader title={`Become a ${brand().name} partner`} description="Book all your temporary coverage with us. In return, save on every shift and lock in your rates." />
      <div className="grid gap-4 sm:grid-cols-3">
        <Perk icon={<PiggyBank className="size-5" />} title={`${p.discountPercent}% off every shift`} text="Taken off the coverage price automatically. Providers are paid the same." />
        <Perk icon={<Lock className="size-5" />} title={`Rates locked ${p.termMonths} months`} text="Your coverage prices can't go up during each term. If ours go down, you pay less." />
        <Perk icon={<Handshake className="size-5" />} title="Fair exclusivity" text={`If we haven't filled a shift ${p.releaseHours} hours before it starts, you're free to cover it elsewhere.`} />
      </div>
      {!owner ? (
        <Alert tone="info" className="mt-6" title="Ask your clinic owner to sign">Only a clinic owner can sign the Partner Addendum.</Alert>
      ) : sign ? (
        <>
          <p className="mb-4 mt-8 text-sm text-slate-500">Please read the whole addendum. It&apos;s filled in with your details. Sign at the bottom.</p>
          <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8"><AgreementDocument doc={sign.doc} /></div>
          <div className="mt-6 rounded-2xl border border-brand-200 bg-brand-50/40 p-5 sm:p-6">
            <h2 className="flex items-center gap-2 font-semibold text-slate-900"><BadgeCheck className="size-5 text-brand-700" />Sign electronically</h2>
            <ActionForm action={signPartnerAddendumAction} className="mt-4 space-y-4" successMessage={false}>
              <input type="hidden" name="id" value={p.id} />
              <input type="hidden" name="viewedHash" value={sign.hash} />
              <Checkbox name="consent" required label={`I agree to use electronic records and signatures with ${brand().name}. I can download or print this addendum, and ask for a paper copy at any time at no charge.`} />
              <div className="grid gap-4 sm:grid-cols-2">
                <Field label="Type your full legal name" htmlFor="typedName" hint="This is your signature.">
                  <Input id="typedName" name="typedName" required minLength={3} maxLength={120} autoComplete="name" placeholder={sign.user.name} />
                </Field>
                <Field label="Your title" htmlFor="title" hint="For example Owner, Practice Manager.">
                  <Input id="title" name="title" required maxLength={80} />
                </Field>
              </div>
              <Checkbox name="agree" required label="I have read this addendum and I'm authorized to sign it on behalf of the Clinic. The Clinic agrees to it." />
              <p className="text-xs text-slate-500">When you sign we record the date and time, your IP address and device, and a fingerprint of the exact text above. A copy is emailed to {sign.user.email}.</p>
              <SubmitButton size="lg">Sign and become a partner</SubmitButton>
            </ActionForm>
          </div>
        </>
      ) : null}
    </>
  );
}

function Perk({ icon, title, text }: { icon: React.ReactNode; title: string; text: string }) {
  return (
    <Card>
      <CardBody>
        <div className="flex items-center gap-2 font-semibold text-slate-900"><span className="text-accent-600">{icon}</span>{title}</div>
        <p className="mt-1 text-sm text-slate-600">{text}</p>
      </CardBody>
    </Card>
  );
}
