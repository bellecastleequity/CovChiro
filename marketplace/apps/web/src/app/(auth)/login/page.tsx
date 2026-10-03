import Link from "next/link";
import { redirect } from "next/navigation";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";
import { FormGuard } from "@/components/site/form-guard";
import { Alert } from "@/components/ui/misc";
import { getSession, homeFor } from "@/lib/session";
import { loginAction } from "../actions";

export const metadata = { title: "Sign in" };

export default async function Login({ searchParams }: { searchParams: Promise<{ next?: string; reset?: string }> }) {
  const s = await getSession();
  if (s && s.mfaVerified) redirect(homeFor(s.user.role));
  const { next, reset } = await searchParams;
  return (
    <>
      <h1 className="text-xl font-semibold">Welcome back</h1>
      <p className="mt-1 text-sm text-slate-500">Sign in to your account.</p>
      {reset ? <Alert tone="success" className="mt-4">Password updated — sign in with your new password.</Alert> : null}
      <ActionForm action={loginAction} className="mt-6 space-y-4" successMessage={false}>
        <input type="hidden" name="next" value={next ?? ""} />
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" autoComplete="email" required />
        </Field>
        <Field label="Password" htmlFor="password">
          <Input id="password" name="password" type="password" autoComplete="current-password" required />
        </Field>
        <FormGuard />
        <SubmitButton className="w-full" size="lg">
          Sign in
        </SubmitButton>
      </ActionForm>
      <div className="mt-5 flex justify-between text-sm">
        <Link href="/forgot-password" className="text-slate-500 hover:text-slate-800">
          Forgot password?
        </Link>
        <Link href="/signup" className="font-medium text-brand-700">
          Create an account
        </Link>
      </div>
    </>
  );
}
