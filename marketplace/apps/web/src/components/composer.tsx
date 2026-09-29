"use client";

import { useActionState, useEffect, useRef, useState } from "react";
import { SendHorizontal } from "lucide-react";
import type { ActionState } from "./ui/action-form";

export function Composer({ threadId, action }: { threadId: string; action: (prev: ActionState, fd: FormData) => Promise<ActionState> }) {
  const [state, run, pending] = useActionState(action, null);
  const [ack, setAck] = useState(false);
  const ref = useRef<HTMLFormElement>(null);
  useEffect(() => {
    if (state?.ok) {
      ref.current?.reset();
      setAck(false);
    }
    if (state?.error && /patient information/i.test(state.error)) setAck(true);
  }, [state]);
  return (
    <form ref={ref} action={run} className="border-t border-slate-200 p-3">
      <input type="hidden" name="threadId" value={threadId} />
      {ack ? <input type="hidden" name="ackPhi" value="true" /> : null}
      {state?.error ? <p className="mb-2 rounded-lg bg-amber-50 px-3 py-2 text-xs text-amber-900">{state.error}{ack ? " Edit your message, or send again to confirm it contains no patient information." : ""}</p> : null}
      {state?.ok && state.ok !== "Sent" ? <p className="mb-2 rounded-lg bg-sky-50 px-3 py-2 text-xs text-sky-900">{state.ok}</p> : null}
      <div className="flex items-end gap-2">
        <textarea name="body" required rows={1} placeholder="Write a message… (no patient information)" className="max-h-40 min-h-10 flex-1 resize-y rounded-xl border border-slate-300 px-3 py-2 text-sm focus:border-brand-500 focus:outline-none" />
        <button disabled={pending} className="grid size-10 place-items-center rounded-xl bg-brand-600 text-white hover:bg-brand-700 disabled:opacity-50" aria-label="Send">
          <SendHorizontal className="size-4" />
        </button>
      </div>
    </form>
  );
}
