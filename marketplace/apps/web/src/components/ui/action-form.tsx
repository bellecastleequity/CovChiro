"use client";

import { useActionState, useEffect, useRef } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { buttonClass } from "./button";

export type ActionState = { ok?: string; error?: string; data?: unknown; at?: number } | null;
type ServerAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

/** Form bound to a server action; shows the returned error/success inline. */
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
  const [state, run] = useActionState(action, null);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
    if (state && onDone) onDone(state);
  }, [state, resetOnSuccess, onDone]);
  return (
    <form
      ref={ref}
      id={id}
      action={run}
      className={className}
      onSubmit={(e) => {
        if (confirm && !window.confirm(confirm)) e.preventDefault();
      }}
    >
      {children}
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

export function SubmitButton({ children, variant = "primary", size = "md", className, pendingText, disabled }: { children: React.ReactNode; disabled?: boolean; variant?: "primary" | "secondary" | "outline" | "ghost" | "danger"; size?: "sm" | "md" | "lg"; className?: string; pendingText?: string }) {
  const { pending } = useFormStatus();
  return (
    <button type="submit" disabled={pending || disabled} className={buttonClass(variant, size, cn(className))}>
      {pending ? <Loader2 className="size-4 animate-spin" /> : null}
      {pending && pendingText ? pendingText : children}
    </button>
  );
}
