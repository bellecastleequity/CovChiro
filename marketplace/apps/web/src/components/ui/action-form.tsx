"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { buttonClass } from "./button";

export type ActionState = { ok?: string; error?: string; data?: unknown; at?: number } | null;
type ServerAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const PendingContext = createContext(false);

/**
 * Form bound to a server action; shows the returned error/success inline.
 * Submits via onSubmit + startTransition rather than <form action>, because
 * React 19 clears every field after an action-attribute submit — a typo in a
 * password would otherwise wipe the whole form.
 */
export function ActionForm({
  action,
  children,
  className,
  resetOnSuccess,
  successMessage = true,
  confirm,
  onDone,
  id,
}: {
  id?: string;
  action: ServerAction;
  children: React.ReactNode;
  className?: string;
  resetOnSuccess?: boolean;
  successMessage?: boolean;
  confirm?: string;
  onDone?: (s: ActionState) => void;
}) {
  const [state, run, pending] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
    if (state && onDone) onDone(state);
  }, [state, resetOnSuccess, onDone]);
  return (
    <form
      ref={ref}
      id={id}
      className={className}
      onSubmit={(e) => {
        e.preventDefault();
        if (pending || (confirm && !window.confirm(confirm))) return;
        const fd = new FormData(e.currentTarget, (e.nativeEvent as SubmitEvent).submitter);
        startTransition(() => run(fd));
      }}
    >
      <PendingContext.Provider value={pending}>{children}</PendingContext.Provider>
      {state?.error ? (
        <p role="alert" className="mt-3 rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">
          {state.error}
        </p>
      ) : null}
      {state?.ok && successMessage ? (
        <p role="status" className="mt-3 rounded-lg bg-emerald-50 px-3 py-2 text-sm text-emerald-800">
          {state.ok}
        </p>
      ) : null}
    </form>
  );
}

export function SubmitButton({ children, variant = "primary", size = "md", className, pendingText, disabled, name, value }: { children: React.ReactNode; disabled?: boolean; variant?: "primary" | "secondary" | "outline" | "ghost" | "danger"; size?: "sm" | "md" | "lg"; className?: string; pendingText?: string; /** Sent with the form when this button submits it (several buttons, one form). */ name?: string; value?: string }) {
  const { pending: formPending } = useFormStatus();
  const pending = useContext(PendingContext) || formPending;
  return (
    <button type="submit" name={name} value={value} disabled={pending || disabled} className={buttonClass(variant, size, cn(className))}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}
