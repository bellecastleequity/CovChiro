"use client";

import { useCallback, useEffect, useState } from "react";
import { ExternalLink } from "lucide-react";
import { ActionForm, SubmitButton, type ActionState } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";

type Pending = { id: string; handle: string; name: string };
const KEY = "cm-ig-pending";
const EVT = "cm-ig-opened";

const read = (): Pending | null => {
  try {
    return JSON.parse(sessionStorage.getItem(KEY) ?? "null");
  } catch {
    return null;
  }
};
const write = (p: Pending | null) => {
  try {
    if (p) sessionStorage.setItem(KEY, JSON.stringify(p));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* private mode: the prompt just won't survive a reload */
  }
};

/**
 * Opens the clinic's profile. On a computer it reuses ONE Instagram window
 * placed beside this page (no pile of tabs); on a phone the link opens the
 * Instagram app. Either way the clinic is remembered so the page can ask
 * "Did you follow?" when you come back.
 */
export function IgOpenButton({ id, handle, name }: Pending) {
  const url = `https://www.instagram.com/${handle}/`;
  return (
    <a
      href={url}
      target="_blank"
      rel="noopener noreferrer"
      onClick={(e) => {
        const p = { id, handle, name };
        write(p);
        window.dispatchEvent(new CustomEvent(EVT, { detail: p }));
        const phone = window.matchMedia("(pointer: coarse)").matches || window.innerWidth < 768;
        if (phone) return; // let the link open the Instagram app
        e.preventDefault();
        const w = Math.min(520, Math.round(screen.availWidth * 0.4));
        const h = screen.availHeight;
        const left = screen.availWidth - w;
        const win = window.open(url, "cm-instagram", `popup=yes,width=${w},height=${h},left=${left},top=0`);
        if (win) win.focus();
        else window.open(url, "_blank", "noopener"); // pop-ups blocked: fall back to a tab
      }}
      className="inline-flex items-center gap-1.5 rounded-lg bg-brand-600 px-3 py-1.5 text-sm font-semibold text-white hover:bg-brand-700"
    >
      Open <ExternalLink className="size-3.5" />
    </a>
  );
}

/** The "Did you follow @handle?" card, shown when you return to this page after opening a clinic. */
export function IgFollowPrompt({ action }: { action: (p: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [opened, setOpened] = useState<Pending | null>(null);
  const [show, setShow] = useState(false);

  useEffect(() => {
    setOpened(read());
    const onOpen = (e: Event) => { setOpened((e as CustomEvent<Pending>).detail); setShow(false); };
    const onBack = () => {
      if (document.visibilityState === "visible" && read()) { setOpened(read()); setShow(true); }
    };
    window.addEventListener(EVT, onOpen);
    window.addEventListener("focus", onBack);
    document.addEventListener("visibilitychange", onBack);
    return () => { window.removeEventListener(EVT, onOpen); window.removeEventListener("focus", onBack); document.removeEventListener("visibilitychange", onBack); };
  }, []);

  const close = useCallback(() => { write(null); setShow(false); setOpened(null); }, []);
  const done = useCallback((s: ActionState) => { if (s?.ok) close(); }, [close]);

  if (!show || !opened) return null;
  return (
    <div role="dialog" aria-modal="true" aria-labelledby="ig-prompt-title" className="fixed inset-x-0 bottom-0 z-50 p-4 sm:inset-auto sm:bottom-6 sm:right-6 sm:w-96">
      <div className="rounded-2xl border border-slate-200 bg-white p-4 shadow-2xl">
        <div id="ig-prompt-title" className="font-semibold text-slate-900">Did you follow @{opened.handle}?</div>
        <div className="mt-0.5 text-sm text-slate-500">{opened.name}</div>
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionForm action={action} onDone={done} successMessage={false}>
            <input type="hidden" name="ids" value={opened.id} />
            <input type="hidden" name="decision" value="followed" />
            <SubmitButton size="sm">Yes, followed</SubmitButton>
          </ActionForm>
          <ActionForm action={action} onDone={done} successMessage={false}>
            <input type="hidden" name="ids" value={opened.id} />
            <input type="hidden" name="decision" value="skip" />
            <SubmitButton size="sm" variant="outline">Skip this clinic</SubmitButton>
          </ActionForm>
          <button type="button" onClick={close} className={buttonClass("ghost", "sm")}>Not yet</button>
        </div>
      </div>
    </div>
  );
}
