import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Input } from "@/components/ui/form";
import { auth } from "@cm/services";
import { getSession } from "@/lib/session";
import { mfaResendAction, mfaVerifyAction } from "../actions";

export const metadata = { title: "Two-step verification" };

export default async function Mfa() {
  const s = await getSession();
  if (!s) redirect("/login");
  const byEmail = auth.emailCodeMfa();
  if (!byEmail && !s.user.mfaEnabled) redirect("/mfa/setup");
  if (s.mfaVerified) redirect("/");
  // Test site: make sure a code is on its way (sign-in sends one; this covers arriving here later).
  if (byEmail && !(await auth.hasPendingEmailCode(s.user.id))) await auth.sendEmailCode(s.user.id).catch(() => undefined);
  return (
    <>
      <h1 className="text-xl font-semibold">Two-step verification</h1>
      <p className="mt-1 text-sm text-slate-500">
        {byEmail ? <>We emailed a 6-digit code to <b>{s.user.email}</b>. It works for 10 minutes; check spam if you don&apos;t see it.</> : "Enter the 6-digit code from your authenticator app."}
      </p>
      <ActionForm action={mfaVerifyAction} className="mt-6 space-y-4" successMessage={false}>
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required className="text-center font-mono text-xl tracking-[0.4em]" autoFocus />
        <SubmitButton className="w-full" size="lg">
          Verify
        </SubmitButton>
      </ActionForm>
      {byEmail ? (
        <ActionForm action={mfaResendAction} className="mt-4 text-center">
          <SubmitButton variant="ghost" size="sm" pendingText="Sending…">Email me a new code</SubmitButton>
        </ActionForm>
      ) : null}
    </>
  );
}
