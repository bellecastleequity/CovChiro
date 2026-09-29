import { notFound } from "next/navigation";
import { auth } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";
import { setupAction } from "../actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "First-time setup" };

/** Only reachable while SETUP_TOKEN is set and no admin exists yet. */
export default async function Setup() {
  if (!(await auth.setupAvailable())) notFound();
  return (
    <>
      <h1 className="text-xl font-semibold">First-time setup</h1>
      <p className="mt-1 text-sm text-slate-500">Loads the starting configuration (professions, states, rate regions) and creates your admin account. This page disappears once an admin exists.</p>
      <ActionForm action={setupAction} className="mt-6 space-y-4" successMessage={false}>
        <Field label="Setup token" htmlFor="token" hint="The SETUP_TOKEN value from your hosting environment variables.">
          <Input id="token" name="token" type="password" required autoComplete="off" />
        </Field>
        <Field label="Your name" htmlFor="name"><Input id="name" name="name" required autoComplete="name" /></Field>
        <Field label="Admin email" htmlFor="email"><Input id="email" name="email" type="email" required autoComplete="email" /></Field>
        <Field label="Password" htmlFor="password" hint="At least 12 characters. You'll add two-step verification next.">
          <Input id="password" name="password" type="password" required minLength={12} autoComplete="new-password" />
        </Field>
        <SubmitButton className="w-full" pendingText="Setting up…">Create admin & finish setup</SubmitButton>
      </ActionForm>
    </>
  );
}
