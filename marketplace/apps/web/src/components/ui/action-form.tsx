"use client";

import { createContext, startTransition, useActionState, useContext, useEffect, useRef, useState } from "react";
import { useFormStatus } from "react-dom";
import { Loader2 } from "lucide-react";
import { cn } from "@/lib/cn";
import { buttonClass } from "./button";

export type ActionState = { ok?: string; error?: string; data?: unknown; at?: number } | null;
type ServerAction = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const PendingContext = createContext(false);

// ---------------- save progress on this device (saveKey) ----------------

/** Drafts are kept in this browser only, for 30 days, and cleared on a successful submit or sign-out. */
export const FORM_DRAFT_PREFIX = "cm.form.";
const DRAFT_DAYS = 30;
type Field = HTMLInputElement | HTMLSelectElement | HTMLTextAreaElement;

/** Fields worth keeping: never passwords, files, hidden values, buttons or anything marked data-nosave. */
function draftFields(form: HTMLFormElement): Field[] {
  return Array.from(form.elements).filter((el): el is Field => {
    if (!(el instanceof HTMLInputElement || el instanceof HTMLSelectElement || el instanceof HTMLTextAreaElement)) return false;
    if (!el.name || el.disabled || el.hasAttribute("data-nosave") || el.closest("[data-nosave]")) return false;
    if (el instanceof HTMLInputElement && ["password", "file", "hidden", "submit", "button", "reset", "image"].includes(el.type)) return false;
    return true;
  });
}

/** name → values in page order (checkboxes and radios as true/false). */
function snapshot(form: HTMLFormElement): Record<string, (string | boolean)[]> {
  const out: Record<string, (string | boolean)[]> = {};
  for (const el of draftFields(form)) {
    const v = el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio") ? el.checked : el.value;
    (out[el.name] ??= []).push(v);
  }
  return out;
}

/** Put saved values back, firing the events React listens to so controlled fields update too. */
function restore(form: HTMLFormElement, saved: Record<string, (string | boolean)[]>): boolean {
  let changed = false;
  const seen: Record<string, number> = {};
  for (const el of draftFields(form)) {
    const i = (seen[el.name] = (seen[el.name] ?? -1) + 1);
    const v = saved[el.name]?.[i];
    if (v === undefined) continue;
    if (el instanceof HTMLInputElement && (el.type === "checkbox" || el.type === "radio")) {
      if (typeof v === "boolean" && el.checked !== v) {
        el.click();
        changed = true;
      }
      continue;
    }
    if (typeof v !== "string" || el.value === v) continue;
    const proto = el instanceof HTMLSelectElement ? HTMLSelectElement.prototype : el instanceof HTMLTextAreaElement ? HTMLTextAreaElement.prototype : HTMLInputElement.prototype;
    Object.getOwnPropertyDescriptor(proto, "value")?.set?.call(el, v);
    el.dispatchEvent(new Event(el instanceof HTMLSelectElement ? "change" : "input", { bubbles: true }));
    changed = true;
  }
  return changed;
}

function useFormDraft(ref: React.RefObject<HTMLFormElement | null>, saveKey: string | undefined) {
  const [restoredAt, setRestoredAt] = useState<number | null>(null);
  useEffect(() => {
    const form = ref.current;
    if (!saveKey || !form) return;
    const key = FORM_DRAFT_PREFIX + saveKey;
    try {
      const raw = localStorage.getItem(key);
      const saved = raw ? (JSON.parse(raw) as { at: number; v: Record<string, (string | boolean)[]> }) : null;
      if (saved && Date.now() - saved.at < DRAFT_DAYS * 86_400_000) {
        if (restore(form, saved.v)) setRestoredAt(saved.at);
      } else if (saved) localStorage.removeItem(key);
    } catch {
      /* storage blocked: nothing to restore */
    }
    let timer: ReturnType<typeof setTimeout> | undefined;
    const save = () => {
      clearTimeout(timer);
      timer = setTimeout(() => {
        try {
          localStorage.setItem(key, JSON.stringify({ at: Date.now(), v: snapshot(form) }));
        } catch {
          /* storage full or blocked */
        }
      }, 400);
    };
    form.addEventListener("input", save);
    form.addEventListener("change", save);
    return () => {
      clearTimeout(timer);
      form.removeEventListener("input", save);
      form.removeEventListener("change", save);
    };
  }, [ref, saveKey]);
  const clear = () => {
    if (!saveKey) return;
    try {
      localStorage.removeItem(FORM_DRAFT_PREFIX + saveKey);
    } catch {
      /* ignore */
    }
    setRestoredAt(null);
  };
  return { restoredAt, clear };
}

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
  saveKey,
}: {
  id?: string;
  /** Keep what's typed on this device until it's submitted (unique per form and account). */
  saveKey?: string;
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
  const draft = useFormDraft(ref, saveKey);
  useEffect(() => {
    if (state?.ok && resetOnSuccess) ref.current?.reset();
    if (state?.ok) draft.clear();
    if (state && onDone) onDone(state);
    // eslint-disable-next-line react-hooks/exhaustive-deps -- draft.clear is stable enough; only react to a new result
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
      {draft.restoredAt ? (
        <p role="status" className="mb-3 flex flex-wrap items-center gap-x-3 gap-y-1 rounded-lg bg-brand-50 px-3 py-2 text-sm text-brand-800">
          <span>We kept what you entered on {new Date(draft.restoredAt).toLocaleString("en-US", { month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}. Finish and save when you&apos;re ready.</span>
          <button type="button" className="font-medium underline" onClick={() => { draft.clear(); window.location.reload(); }}>Start over</button>
        </p>
      ) : null}
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
