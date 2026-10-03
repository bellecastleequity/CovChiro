"use client";

import { useEffect, useRef, useState } from "react";

/**
 * Spam guard for public forms (services/src/spam.ts checkHuman):
 *  - a hidden "website" field people never see (bots fill it in),
 *  - the time the form was shown (instant submits are bots),
 *  - Cloudflare Turnstile when TURNSTILE_SITE_KEY is set; it adds a hidden
 *    cf-turnstile-response field to the enclosing form. Tokens are single-use, so the
 *    widget resets right after each submit (the form data is already captured by then).
 */

declare global {
  interface Window {
    turnstile?: {
      render: (el: HTMLElement, opts: Record<string, unknown>) => string;
      reset: (id?: string) => void;
      remove: (id: string) => void;
    };
  }
}

let siteKeyPromise: Promise<string | null> | null = null;
function siteKey(): Promise<string | null> {
  siteKeyPromise ??= fetch("/api/public-config")
    .then((r) => (r.ok ? r.json() : null))
    .then((j: { turnstileSiteKey?: string | null } | null) => j?.turnstileSiteKey ?? null)
    .catch(() => null);
  return siteKeyPromise;
}

let scriptPromise: Promise<void> | null = null;
function loadScript(): Promise<void> {
  scriptPromise ??= new Promise((resolve, reject) => {
    if (window.turnstile) return resolve();
    const s = document.createElement("script");
    s.src = "https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      scriptPromise = null;
      reject(new Error("turnstile script failed"));
    };
    document.head.appendChild(s);
  });
  return scriptPromise;
}

/** visible: always show the "verify you're human" box (sign-in style forms); otherwise it appears only when Cloudflare needs a click. */
export function FormGuard({ visible = false }: { visible?: boolean } = {}) {
  const box = useRef<HTMLDivElement>(null);
  const [startedAt, setStartedAt] = useState("");
  // Visible box: hold its space with a placeholder until Cloudflare draws it (key fetch + script take a moment).
  const [state, setState] = useState<"loading" | "ready" | "off">("loading");
  useEffect(() => setStartedAt(String(Date.now())), []);

  useEffect(() => {
    let widgetId: string | null = null;
    let cancelled = false;
    const form = box.current?.closest("form");
    const onSubmit = () => setTimeout(() => widgetId && window.turnstile?.reset(widgetId), 300);
    (async () => {
      // Visible box: fetch the key and Cloudflare's script at the same time.
      if (visible) loadScript().catch(() => {});
      const key = await siteKey();
      if (cancelled) return;
      if (!key) return setState("off");
      try {
        await loadScript();
      } catch {
        return setState("off"); // Blocked or offline: the server still applies the spam rules.
      }
      if (cancelled || !box.current || !window.turnstile) return;
      widgetId = window.turnstile.render(box.current, { sitekey: key, appearance: visible ? "always" : "interaction-only", "response-field-name": "cf-turnstile-response" });
      setState("ready");
      form?.addEventListener("submit", onSubmit);
    })();
    return () => {
      cancelled = true;
      form?.removeEventListener("submit", onSubmit);
      if (widgetId) window.turnstile?.remove(widgetId);
    };
  }, [visible]);

  return (
    <>
      <input type="text" name="website" className="hidden" tabIndex={-1} autoComplete="off" aria-hidden defaultValue="" />
      <input type="hidden" name="startedAt" value={startedAt} />
      {visible && state === "loading" ? (
        <div className="flex h-[65px] w-[300px] max-w-full items-center gap-2 rounded-md border border-slate-200 bg-slate-50 px-4 text-sm text-slate-500">
          <span className="size-4 animate-spin rounded-full border-2 border-slate-300 border-t-slate-500" />
          Checking you&apos;re human…
        </div>
      ) : null}
      <div ref={box} className="empty:hidden" />
    </>
  );
}

/** The guard fields from a submitted form, for JSON posts. */
export function guardFields(fd: FormData) {
  return { website: String(fd.get("website") ?? ""), startedAt: String(fd.get("startedAt") ?? "") || null, turnstileToken: String(fd.get("cf-turnstile-response") ?? "") || null };
}
