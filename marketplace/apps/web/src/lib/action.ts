import "server-only";
import { unstable_rethrow } from "next/navigation";
import { ZodError } from "zod";
import { DomainError } from "@cm/core";

export type ActionState = { ok?: string; error?: string; data?: unknown; at?: number } | null;

/** Wraps a server action so domain/validation errors come back as messages instead of crashing the page. */
export function formAction(fn: (fd: FormData) => Promise<string | void | { ok?: string; data?: unknown }>) {
  return async (_prev: ActionState, fd: FormData): Promise<ActionState> => {
    try {
      const r = await fn(fd);
      if (r && typeof r === "object") return { ok: r.ok ?? "Saved", data: r.data, at: Date.now() };
      return { ok: r ?? "Saved", at: Date.now() };
    } catch (e) {
      unstable_rethrow(e);
      return { error: errorMessage(e), at: Date.now() };
    }
  };
}

export function errorMessage(e: unknown): string {
  if (e instanceof DomainError) return e.message;
  if (e instanceof ZodError) return e.issues[0]?.message ?? "Please check the form.";
  // Stripe setup problems (e.g. Connect settings not finished) are only fixable by the owner, so say what Stripe said.
  const se = e as { type?: unknown; message?: unknown };
  if (typeof se?.type === "string" && se.type.startsWith("Stripe") && typeof se.message === "string") {
    console.error(e);
    return `Stripe said: ${se.message}`;
  }
  console.error(e);
  return "Something went wrong. Please try again.";
}

export const str = (fd: FormData, k: string) => {
  const v = fd.get(k);
  return typeof v === "string" ? v.trim() : "";
};
export const optStr = (fd: FormData, k: string) => str(fd, k) || null;
export const bool = (fd: FormData, k: string) => fd.get(k) === "on" || fd.get(k) === "true";
export const dollarsToCents = (v: string) => (v ? Math.round(parseFloat(v.replace(/[$,]/g, "")) * 100) : null);
