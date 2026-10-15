"use client";

import { useEffect } from "react";
import { FORM_DRAFT_PREFIX } from "@/components/ui/action-form";

function clearDrafts(only?: (key: string) => boolean) {
  try {
    for (const key of Object.keys(localStorage)) if (key.startsWith(FORM_DRAFT_PREFIX) && (!only || only(key))) localStorage.removeItem(key);
  } catch {
    /* storage blocked */
  }
}

/**
 * Housekeeping for saved form progress (ActionForm saveKey): signed in = the sign-up form is done,
 * so its draft goes; signing out clears every draft so the next person on this device sees nothing.
 */
export function FormDrafts({ signedIn }: { signedIn: boolean }) {
  useEffect(() => {
    if (signedIn) clearDrafts((k) => k.startsWith(`${FORM_DRAFT_PREFIX}signup`));
    const onSubmit = (e: SubmitEvent) => {
      const form = e.target as HTMLFormElement | null;
      if (form?.getAttribute("action")?.endsWith("/api/auth/logout")) clearDrafts();
    };
    document.addEventListener("submit", onSubmit, true);
    return () => document.removeEventListener("submit", onSubmit, true);
  }, [signedIn]);
  return null;
}
