import Link from "next/link";
import { prisma } from "@cm/db";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { FormGuard } from "@/components/site/form-guard";
import { cookies } from "next/headers";
import { dollars } from "@cm/core";
import { getSettings, google, referrals, schools } from "@cm/services";
import { isSandbox } from "@cm/config";
import { Checkbox, Field, Input, Select, RequiredMark } from "@/components/ui/form";
import { SOURCE_OPTIONS, StudentFields } from "@/components/provider/student-fields";
import { cn } from "@/lib/cn";
import { GoogleAnalytics } from "@/components/site/google-analytics";
import { Alert } from "@/components/ui/misc";
import { GoogleButton, OrDivider } from "@/components/site/google-button";
import { signupAction } from "../actions";

export const metadata = { title: "Create your account" };

export default async function Signup({ searchParams }: { searchParams: Promise<{ role?: string; code?: string; profession?: string; student?: string; campaign?: string; c?: string; ref?: string; google?: string }> }) {
  const { role: r, code, profession, student: st, campaign, c, ref: refParam, google: problem } = await searchParams;
  const googleNote = problem ? google.GOOGLE_PROBLEMS[problem as keyof typeof google.GOOGLE_PROBLEMS] : null;
  const inv = await referrals.invitation(refParam ?? (await cookies()).get("cm_ref")?.value);
  const role = r === "provider" ? "provider" : "clinic";
  const settings = await getSettings();
  const studentEnabled = settings["features.preLicensureEnabled"];
  const student = role === "provider" && studentEnabled && st === "1";
  const professions = await prisma.profession.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  const schoolGroups = await schools.schoolOptions();
  // Growth campaign links (/join/<code>) and prospect tokens survive switching tabs.
  const keep = `${campaign ? `&campaign=${encodeURIComponent(campaign)}` : ""}${profession ? `&profession=${encodeURIComponent(profession)}` : ""}${inv ? `&ref=${inv.code}` : ""}`;
  return (
    <>
      {settings["seo.gaMeasurementId"] && !isSandbox() ? <GoogleAnalytics id={settings["seo.gaMeasurementId"]} /> : null}
      <h1 className="text-xl font-semibold">Create your account</h1>
      {inv ? (
        <p className="mt-3 rounded-xl bg-accent-50 px-4 py-3 text-sm text-slate-800">
          <b>{inv.from} invited you.</b> Create your free profile now so you&apos;re ready when the need arises. After your first completed shift you get a {dollars(inv.friendRewardCents)} bonus, and you can earn {dollars(inv.referrerRewardCents)} for every colleague you refer.
        </p>
      ) : null}
      <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
        <Link href={`/signup?role=clinic${code ? `&code=${code}` : ""}${inv ? `&ref=${inv.code}` : ""}`} className={cn("rounded-lg py-2 text-center", role === "clinic" ? "bg-white shadow-sm" : "text-slate-500")}>
          I'm a clinic
        </Link>
        <Link href={`/signup?role=provider${keep}`} className={cn("rounded-lg py-2 text-center", role === "provider" ? "bg-white shadow-sm" : "text-slate-500")}>
          I'm a provider
        </Link>
      </div>
      {role === "provider" && studentEnabled ? (
        <div className="mt-3 grid grid-cols-2 gap-1 rounded-xl border border-slate-200 p-1 text-sm font-medium" role="group" aria-label="Licensure">
          <Link href={`/signup?role=provider${keep}`} className={cn("rounded-lg py-2 text-center", !student ? "bg-brand-600 text-white" : "text-slate-500")}>
            Licensed provider
          </Link>
          <Link href={`/signup?role=provider&student=1${keep}`} className={cn("rounded-lg py-2 text-center", student ? "bg-brand-600 text-white" : "text-slate-500")}>
            Student / not yet licensed
          </Link>
        </div>
      ) : null}
      {googleNote ? <Alert tone={problem === "cancelled" ? "info" : "error"} className="mt-4">{googleNote}</Alert> : null}
      {google.googleEnabled() && !student ? (
        <div className="mt-6">
          <GoogleButton params={{ role, campaign, code }} label="Sign up with Google" />
          <OrDivider />
        </div>
      ) : null}
      <ActionForm action={signupAction} className="mt-6 space-y-4" successMessage={false}>
        <input type="hidden" name="role" value={role} />
        {student ? <input type="hidden" name="student" value="1" /> : null}
        <input type="hidden" name="code" value={code ?? ""} />
        <input type="hidden" name="campaign" value={campaign ?? ""} />
        <input type="hidden" name="ref" value={inv?.code ?? ""} />
        <input type="hidden" name="c" value={c && /^[a-f0-9]{40}$/.test(c) ? c : ""} />
        <Field label="Your name" htmlFor="name">
          <Input id="name" name="name" autoComplete="name" required />
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
                <Checkbox key={p.code} name="professions" value={p.code} defaultChecked={profession ? profession === p.code : p.code === "DC"} label={`${p.displayName} (${p.credentialSuffix})`} />
              ))}
            </div>
            <p className="mt-1 text-xs text-slate-500">More professions are coming soon — you can add them later.</p>
          </fieldset>
        )}
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        {student ? (
          <>
            <StudentFields schools={schoolGroups} />
            <Field label="How did you hear about us?" htmlFor="source">
              <Select id="source" name="source" defaultValue="">
                {SOURCE_OPTIONS.map(([v, l]) => (
                  <option key={v} value={v}>
                    {l}
                  </option>
                ))}
              </Select>
            </Field>
          </>
        ) : null}
        <Field label="Password" htmlFor="password" hint="At least 10 characters.">
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        <Checkbox name="terms" required label={<>I agree to the terms of service and privacy policy.</>} />
        {code ? <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">Your code <strong className="font-mono">{code}</strong> will be ready when you post your first shift.</p> : null}
        <FormGuard />
        <SubmitButton className="w-full" size="lg" pendingText="Creating account…">
          Create account
        </SubmitButton>
      </ActionForm>
      <p className="mt-5 text-center text-sm text-slate-500">
        Already have an account?{" "}
        <Link href="/login" className="font-medium text-brand-700">
          Sign in
        </Link>
      </p>
    </>
  );
}
