"use client";

import { useEffect, useRef, useState } from "react";
import { MessageSquareWarning, X } from "lucide-react";

/** The page's own recent browser errors, attached to a report. */
const seen: string[] = [];
let sent = 0;

function sendError(message: string, stack?: string) {
  const line = message.slice(0, 300);
  seen.unshift(line);
  seen.length = Math.min(seen.length, 5);
  // A handful per page is plenty; the server also caps it.
  if (++sent > 10) return;
  void fetch("/api/sandbox/error", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ message, stack, path: location.pathname + location.search }), keepalive: true }).catch(() => undefined);
}

/** Test site: catches browser errors and offers "Report a problem" from the amber bar. */
export function SandboxReporter() {
  const [open, setOpen] = useState(false);
  const [note, setNote] = useState("");
  const [state, setState] = useState<{ busy?: boolean; ok?: boolean; error?: string }>({});
  const box = useRef<HTMLTextAreaElement>(null);

  useEffect(() => {
    const onError = (e: ErrorEvent) => sendError(e.message || "Script error", e.error?.stack);
    const onRejection = (e: PromiseRejectionEvent) => {
      const r = e.reason as { message?: string; stack?: string } | undefined;
      sendError(r?.message ?? String(e.reason), r?.stack);
    };
    window.addEventListener("error", onError);
    window.addEventListener("unhandledrejection", onRejection);
    return () => {
      window.removeEventListener("error", onError);
      window.removeEventListener("unhandledrejection", onRejection);
    };
  }, []);

  useEffect(() => {
    if (open) box.current?.focus();
  }, [open]);

  async function submit() {
    setState({ busy: true });
    const r = await fetch("/api/sandbox/report", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ note, path: location.pathname + location.search, client: { userAgent: navigator.userAgent, viewport: `${innerWidth}×${innerHeight}`, browserErrors: seen } }),
    }).catch(() => null);
    const j = (await r?.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    if (r?.ok && j?.ok) {
      setState({ ok: true });
      setNote("");
    } else setState({ error: j?.error ?? "Couldn't send it. Try again in a moment." });
  }

  return (
    <>
      <button type="button" onClick={() => { setOpen(true); setState({}); }} className="ml-2 inline-flex items-center gap-1 rounded-full bg-amber-950/10 px-2 py-0.5 hover:bg-amber-950/20">
        <MessageSquareWarning className="size-3.5" aria-hidden /> Report a problem
      </button>
      {open ? (
        <div role="dialog" aria-label="Report a problem" className="fixed right-4 top-9 z-[60] w-[min(26rem,calc(100vw-2rem))] rounded-2xl border border-slate-200 bg-white p-4 text-left text-sm font-normal text-slate-800 shadow-xl">
          <div className="mb-2 flex items-center justify-between">
            <p className="font-semibold">Report a problem</p>
            <button type="button" onClick={() => setOpen(false)} aria-label="Close" className="rounded p-1 text-slate-500 hover:bg-slate-100"><X className="size-4" /></button>
          </div>
          {state.ok ? (
            <p className="rounded-lg bg-emerald-50 px-3 py-2 text-emerald-800">Thanks, it&apos;s sent. The page you were on and any recent errors were included.</p>
          ) : (
            <>
              <p className="mb-2 text-xs text-slate-500">What happened, and what did you expect? The page you&apos;re on, your login and any recent errors are added automatically.</p>
              <textarea ref={box} value={note} onChange={(e) => setNote(e.target.value)} rows={5} maxLength={4000} className="w-full rounded-lg border border-slate-300 p-2 text-sm focus:border-brand-500 focus:outline-none" placeholder="e.g. I clicked Apply and nothing happened" />
              {state.error ? <p className="mt-2 rounded-lg bg-red-50 px-3 py-2 text-red-800">{state.error}</p> : null}
              <div className="mt-3 flex justify-end gap-2">
                <button type="button" onClick={() => setOpen(false)} className="rounded-lg px-3 py-1.5 text-slate-600 hover:bg-slate-100">Cancel</button>
                <button type="button" disabled={state.busy || note.trim().length < 3} onClick={submit} className="rounded-lg bg-brand-600 px-3 py-1.5 font-medium text-white disabled:opacity-50">{state.busy ? "Sending…" : "Send"}</button>
              </div>
            </>
          )}
        </div>
      ) : null}
    </>
  );
}
