"use client";

import { useCallback, useState } from "react";
import { ActionForm, SubmitButton, type ActionState } from "@/components/ui/action-form";
import { Field, Input } from "@/components/ui/form";
import { FormGuard } from "@/components/site/form-guard";
import { loginAction } from "../actions";

/** Sign-in form. The "verify you're human" box shows once sign-in needs it (after repeated failures). */
export function LoginForm({ next, challenge }: { next: string; challenge: boolean }) {
  const [visible, setVisible] = useState(challenge);
  const onDone = useCallback((s: ActionState) => {
    if (s?.error?.includes("verify you're human")) setVisible(true);
  }, []);
  return (
    <ActionForm action={loginAction} className="mt-6 space-y-4" successMessage={false} onDone={onDone}>
      <input type="hidden" name="next" value={next} />
      <Field label="Email" htmlFor="email">
        <Input id="email" name="email" type="email" autoComplete="email" required />
      </Field>
      <Field label="Password" htmlFor="password">
        <Input id="password" name="password" type="password" autoComplete="current-password" required />
      </Field>
      <FormGuard key={visible ? "check" : "quiet"} visible={visible} />
      <SubmitButton className="w-full" size="lg">
        Sign in
      </SubmitButton>
    </ActionForm>
  );
}
