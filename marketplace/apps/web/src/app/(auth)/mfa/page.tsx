import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Input } from "@/components/ui/form";
import { getSession } from "@/lib/session";
import { mfaVerifyAction } from "../actions";

export const metadata = { title: "Two-step verification" };

export default async function Mfa() {
  const s = await getSession();
  if (!s) redirect("/login");
  if (!s.user.mfaEnabled) redirect("/mfa/setup");
  return (
    <>
      <h1 className="text-xl font-semibold">Two-step verification</h1>
      <p className="mt-1 text-sm text-slate-500">Enter the 6-digit code from your authenticator app.</p>
      <ActionForm action={mfaVerifyAction} className="mt-6 space-y-4" successMessage={false}>
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" pattern="[0-9 ]{6,7}" maxLength={7} required className="text-center font-mono text-xl tracking-[0.4em]" autoFocus />
        <SubmitButton className="w-full" size="lg">
          Verify
        </SubmitButton>
      </ActionForm>
    </>
  );
}
