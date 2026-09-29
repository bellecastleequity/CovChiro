import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";
import { resetAction } from "../actions";

export const metadata = { title: "Choose a new password" };

export default async function Reset({ searchParams }: { searchParams: Promise<{ token?: string }> }) {
  const { token } = await searchParams;
  return (
    <>
      <h1 className="text-xl font-semibold">Choose a new password</h1>
      <ActionForm action={resetAction} className="mt-6 space-y-4" successMessage={false}>
        <input type="hidden" name="token" value={token ?? ""} />
        <Field label="New password" htmlFor="password" hint="At least 10 characters.">
          <Input id="password" name="password" type="password" minLength={10} required autoComplete="new-password" />
        </Field>
        <Field label="Confirm password" htmlFor="confirm">
          <Input id="confirm" name="confirm" type="password" minLength={10} required autoComplete="new-password" />
        </Field>
        <SubmitButton className="w-full">Update password</SubmitButton>
      </ActionForm>
    </>
  );
}
