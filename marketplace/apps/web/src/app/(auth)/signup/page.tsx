import Link from "next/link";
import { prisma } from "@cm/db";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Checkbox, Field, Input } from "@/components/ui/form";
import { cn } from "@/lib/cn";
import { signupAction } from "../actions";

export const metadata = { title: "Create your account" };

export default async function Signup({ searchParams }: { searchParams: Promise<{ role?: string; code?: string; profession?: string }> }) {
  const { role: r, code, profession } = await searchParams;
  const role = r === "provider" ? "provider" : "clinic";
  const professions = await prisma.profession.findMany({ where: { active: true }, orderBy: { sortOrder: "asc" } });
  return (
    <>
      <h1 className="text-xl font-semibold">Create your account</h1>
      <div className="mt-4 grid grid-cols-2 gap-1 rounded-xl bg-slate-100 p-1 text-sm font-medium">
        <Link href={`/signup?role=clinic${code ? `&code=${code}` : ""}`} className={cn("rounded-lg py-2 text-center", role === "clinic" ? "bg-white shadow-sm" : "text-slate-500")}>
          I'm a clinic
        </Link>
        <Link href="/signup?role=provider" className={cn("rounded-lg py-2 text-center", role === "provider" ? "bg-white shadow-sm" : "text-slate-500")}>
          I'm a provider
        </Link>
      </div>
      <ActionForm action={signupAction} className="mt-6 space-y-4" successMessage={false}>
        <input type="hidden" name="role" value={role} />
        <input type="hidden" name="code" value={code ?? ""} />
        <Field label="Your name" htmlFor="name">
          <Input id="name" name="name" autoComplete="name" required />
        </Field>
        {role === "clinic" ? (
          <Field label="Clinic name" htmlFor="organization">
            <Input id="organization" name="organization" required />
          </Field>
        ) : (
          <fieldset>
            <legend className="mb-1.5 text-sm font-medium text-slate-700">Your profession(s)</legend>
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
        <Field label="Password" htmlFor="password" hint="At least 10 characters.">
          <Input id="password" name="password" type="password" autoComplete="new-password" minLength={10} required />
        </Field>
        <Checkbox name="terms" required label={<>I agree to the terms of service and privacy policy.</>} />
        {code ? <p className="rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">Your code <strong className="font-mono">{code}</strong> will be ready when you post your first shift.</p> : null}
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
