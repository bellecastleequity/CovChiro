import Link from "next/link";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { prisma } from "@cm/db";
import { google, referrals } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Field, Input, RequiredMark } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { GOOGLE_PENDING_COOKIE } from "@/lib/google";
import { googleSignupAction } from "../../actions";

export const metadata = { title: "Finish creating your account" };

/** After "Continue with Google" for an email with no account: clinic or provider, then the few details we need. */
export default async function GoogleSignup({ searchParams }: { searchParams: Promise<{ role?: string; campaign?: string; code?: string }> }) {
  const g = google.readPending((await cookies()).get(GOOGLE_PENDING_COOKIE)?.value);
  if (!g) redirect("/signup?google=expired");
  const { role: r, campaign, code } = await searchParams;
  const role = r === "provider" ? "provider" : r === "clinic" ? "clinic" : null;
  const inv = await referrals.invitation((await cookies()).get("cm_ref")?.value);
  const keep = `${campaign ? `&campaign=${encodeURIComponent(campaign)}` : ""}${code ? `&code=${encodeURIComponent(code)}` : ""}`;
  const professions = role === "provider" ? await prisma.profession.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } }) : [];
  return (
    <>
      <h1 className="text-xl font-semibold">Finish creating your account</h1>
      <p className="mt-1 text-sm text-slate-500">
        Signed in with Google as <b className="text-slate-700">{g.email}</b>. Your email is already confirmed.
      </p>
      <p className="mt-4 text-sm font-medium text-slate-700">Are you a clinic or a provider?</p>
      <div className="mt-2 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
        <Link href={`/signup/google?role=clinic${keep}`} className={cn("rounded-lg py-2 text-center", role === "clinic" ? "bg-white shadow-sm" : "text-slate-500")}>
          I&apos;m a clinic
        </Link>
        <Link href={`/signup/google?role=provider${keep}`} className={cn("rounded-lg py-2 text-center", role === "provider" ? "bg-white shadow-sm" : "text-slate-500")}>
          I&apos;m a provider
        </Link>
      </div>
      {role ? (
        <ActionForm action={googleSignupAction} className="mt-6 space-y-4" successMessage={false}>
          <input type="hidden" name="role" value={role} />
          <input type="hidden" name="campaign" value={campaign ?? ""} />
          <input type="hidden" name="code" value={code ?? ""} />
          <Field label="Your name" htmlFor="name">
            <Input id="name" name="name" autoComplete="name" defaultValue={g.name} required />
          </Field>
          {role === "clinic" ? (
            <Field label="Clinic name" htmlFor="organization">
              <Input id="organization" name="organization" required />
            </Field>
          ) : (
            <fieldset>
              <legend className="mb-1.5 text-sm font-medium text-slate-700">Your profession(s)<RequiredMark /></legend>
              <div className="space-y-2">
                {professions.map((p) => (
                  <Checkbox key={p.code} name="professions" value={p.code} defaultChecked={p.code === "DC"} label={`${p.displayName} (${p.credentialSuffix})`} />
                ))}
              </div>
              <p className="mt-1 text-xs text-slate-500">
                Student or not licensed yet? <Link href="/signup?role=provider&student=1" className="font-medium text-brand-700">Use the student sign-up</Link>.
              </p>
            </fieldset>
          )}
          {inv ? <p className="rounded-lg bg-accent-50 px-3 py-2 text-sm text-slate-800"><b>{inv.from} invited you.</b> Your referral is linked to this account.</p> : null}
          <Checkbox name="terms" required label={<>I agree to the terms of service and privacy policy.</>} />
          {code ? <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">Your code <strong className="font-mono">{code}</strong> will be ready when you post your first shift.</p> : null}
          <SubmitButton className="w-full" size="lg" pendingText="Creating account…">
            Create account
          </SubmitButton>
        </ActionForm>
      ) : null}
      <p className="mt-5 text-center text-sm text-slate-500">
        Not you?{" "}
        <Link href="/signup" className="font-medium text-brand-700">
          Start over
        </Link>
      </p>
    </>
  );
}
