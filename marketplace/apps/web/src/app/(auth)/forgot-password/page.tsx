import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";
import { FormGuard } from "@/components/site/form-guard";
import { forgotAction } from "../actions";

export const metadata = { title: "Reset password" };

export default function Forgot() {
  return (
    <>
      <h1 className="text-xl font-semibold">Reset your password</h1>
      <p className="mt-1 text-sm text-slate-500">We'll email you a link that works for one hour.</p>
      <ActionForm action={forgotAction} className="mt-6 space-y-4">
        <Field label="Email" htmlFor="email">
          <Input id="email" name="email" type="email" required autoComplete="email" />
        </Field>
        <FormGuard visible />
        <SubmitButton className="w-full">Send reset link</SubmitButton>
      </ActionForm>
    </>
  );
}
