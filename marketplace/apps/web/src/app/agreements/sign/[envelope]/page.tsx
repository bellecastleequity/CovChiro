import { notFound, redirect } from "next/navigation";
import { brand } from "@cm/config";
import { agreementForSigning } from "@cm/services";
import { AgreementDocument } from "@/components/agreements/document";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { requireActor } from "@/lib/session";
import { signAgreementAction } from "../../actions";

export const metadata = { title: "Review and sign" };
export const dynamic = "force-dynamic";

export default async function SignAgreement({ params }: { params: Promise<{ envelope: string }> }) {
  const { actor } = await requireActor("any");
  const { envelope } = await params;
  const view = await agreementForSigning(actor, envelope).catch(() => null);
  if (!view) notFound();
  if (view.signed) redirect(`/agreements/signed/${view.sig.id}`);
  const clinic = view.sig.partyType === "CLINIC";
  return (
    <div className="mx-auto max-w-3xl px-4 py-10 sm:py-14">
      <p className="mb-4 text-sm text-slate-500">Please read the whole agreement. It&apos;s filled in with your details — sign at the bottom.</p>
      <div className="rounded-2xl border border-slate-200 bg-white p-5 shadow-sm sm:p-8">
        <AgreementDocument doc={view.doc} />
      </div>
      <div className="mt-6 rounded-2xl border border-brand-200 bg-brand-50/40 p-5 sm:p-6">
        <h2 className="font-semibold text-slate-900">Sign electronically</h2>
        <ActionForm action={signAgreementAction} className="mt-4 space-y-4" successMessage={false}>
          <input type="hidden" name="envelope" value={envelope} />
          <input type="hidden" name="viewedHash" value={view.hash ?? ""} />
          <Checkbox
            name="consent"
            required
            label={`I agree to use electronic records and signatures with ${brand().name}. I can download or print this agreement, and ask for a paper copy at any time at no charge.`}
          />
          <div className="grid gap-4 sm:grid-cols-2">
            <Field label="Type your full legal name" htmlFor="typedName" hint="This is your signature.">
              <Input id="typedName" name="typedName" required minLength={3} maxLength={120} autoComplete="name" defaultValue="" placeholder={view.user.name} />
            </Field>
            {clinic ? (
              <Field label="Your title" htmlFor="title" hint="For example Owner, Practice Manager.">
                <Input id="title" name="title" required maxLength={80} />
              </Field>
            ) : null}
          </div>
          <Checkbox name="agree" required label={clinic ? "I have read this agreement and I'm authorized to sign it on behalf of the Clinic. The Clinic agrees to it." : "I have read and agree to this agreement."} />
          <p className="text-xs text-slate-500">When you sign we record the date and time, your IP address and device, and a fingerprint of the exact text above. A copy is emailed to {view.user.email}.</p>
          <SubmitButton size="lg">Sign agreement</SubmitButton>
        </ActionForm>
      </div>
    </div>
  );
}
