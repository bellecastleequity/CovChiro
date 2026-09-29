import { notFound } from "next/navigation";
import { brand, env } from "@cm/config";
import { prisma } from "@cm/db";
import { testSigningEnabled } from "@cm/integrations";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Checkbox } from "@/components/ui/form";
import { devSignAction } from "../actions";

// Decided per request: ESIGN_TEST_MODE is read at runtime, not build time.
export const dynamic = "force-dynamic";

/** Built-in click-to-sign page: development, or production test mode (ESIGN_TEST_MODE) until Dropbox Sign is connected. */
export default async function DevSign({ searchParams }: { searchParams: Promise<{ envelope?: string }> }) {
  if (!testSigningEnabled()) notFound();
  const production = env().NODE_ENV === "production";
  const { envelope } = await searchParams;
  const sig = envelope ? await prisma.agreementSignature.findUnique({ where: { envelopeId: envelope } }) : null;
  if (!sig) notFound();
  const kind = sig.partyType === "CLINIC" ? "Clinic" : "Provider";
  return (
    <div className="mx-auto max-w-2xl px-4 py-16">
      <div className="rounded-2xl border border-amber-300 bg-amber-50 px-4 py-2 text-sm text-amber-900">
        {production
          ? "Test signature for the build & test phase. The final agreement will be signed through Dropbox Sign, and you'll be asked to sign it again then."
          : "Development signing page — production uses Dropbox Sign."}
      </div>
      <h1 className="mt-6 text-2xl font-semibold">{brand().name} {kind} Platform Agreement · v{sig.version}</h1>
      <div className="mt-4 h-64 overflow-y-auto rounded-xl border border-slate-200 bg-white p-4 text-sm text-slate-600">
        <p>Placeholder text. The attorney-reviewed agreement template lives in the e-signature vendor and is versioned there (SPEC §13).</p>
      </div>
      <ActionForm action={devSignAction} className="mt-5 space-y-4" successMessage={false}>
        <input type="hidden" name="envelope" value={sig.envelopeId!} />
        <Checkbox name="agree" required label="I have read and agree to this agreement." />
        <SubmitButton>Sign agreement</SubmitButton>
      </ActionForm>
    </div>
  );
}
