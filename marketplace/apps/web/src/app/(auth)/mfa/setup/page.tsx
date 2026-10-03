import { redirect } from "next/navigation";
import QRCode from "qrcode";
import { auth } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Input } from "@/components/ui/form";
import { getSession } from "@/lib/session";
import { mfaVerifyAction } from "../../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Set up two-step verification" };

export default async function MfaSetup() {
  const s = await getSession();
  if (!s) redirect("/login");
  // Test site: 2-step is an emailed code; there's no app to set up.
  if (auth.emailCodeMfa()) redirect("/mfa");
  if (s.user.mfaEnabled && s.mfaVerified) redirect("/");
  if (s.user.mfaEnabled) redirect("/mfa");
  const { secret, otpauthUrl } = await auth.beginMfaEnrollment(s.user.id);
  const qr = await QRCode.toDataURL(otpauthUrl, { margin: 1, width: 200 });
  return (
    <>
      <h1 className="text-xl font-semibold">Set up two-step verification</h1>
      <p className="mt-1 text-sm text-slate-500">{s.user.role === "PLATFORM_ADMIN" ? "Required for admin accounts." : "Adds a second step when you sign in."} Scan this with Google Authenticator, 1Password, Authy or similar.</p>
      {/* eslint-disable-next-line @next/next/no-img-element */}
      <img src={qr} alt="QR code for your authenticator app" className="mx-auto mt-5 rounded-xl border border-slate-200" width={200} height={200} />
      <p className="mt-3 text-center text-xs text-slate-500">
        Can't scan? Enter <span className="font-mono">{secret}</span>
      </p>
      <ActionForm action={mfaVerifyAction} className="mt-5 space-y-4" successMessage={false}>
        <input type="hidden" name="enrolling" value="1" />
        <Input name="code" inputMode="numeric" autoComplete="one-time-code" maxLength={7} required placeholder="6-digit code" className="text-center font-mono text-xl tracking-[0.4em]" />
        <SubmitButton className="w-full" size="lg">
          Turn on and continue
        </SubmitButton>
      </ActionForm>
    </>
  );
}
