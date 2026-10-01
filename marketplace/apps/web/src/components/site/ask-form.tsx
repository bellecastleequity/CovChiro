"use client";

import { useState } from "react";
import { Loader2 } from "lucide-react";
import { buttonClass } from "@/components/ui/button";
import { Input, Textarea } from "@/components/ui/form";
import { askQuestionAction } from "@/app/(public)/ask-action";
import { FormGuard } from "./form-guard";

/**
 * "Ask a question": answered from the approved knowledge base when it covers
 * it; otherwise a person replies by email. The answer never invents policy.
 */
export function AskForm() {
  const [busy, setBusy] = useState(false);
  const [answer, setAnswer] = useState<{ text: string; escalated: boolean } | null>(null);
  const [error, setError] = useState<string | null>(null);
  return (
    <form
      className="space-y-3"
      onSubmit={async (e) => {
        e.preventDefault();
        setBusy(true);
        setError(null);
        const r = await askQuestionAction(new FormData(e.currentTarget));
        setBusy(false);
        if ("error" in r) setError(r.error);
        else setAnswer({ text: r.answer, escalated: r.escalated });
      }}
    >
      <div className="grid gap-3 sm:grid-cols-2">
        <Input name="name" placeholder="Your name" required />
        <Input name="email" type="email" placeholder="Email" required />
      </div>
      <Textarea name="question" placeholder="Ask about coverage, pricing, credentials, how it works…" required className="min-h-24" />
      <FormGuard />
      <button className={buttonClass("primary")} disabled={busy}>{busy ? <Loader2 className="size-4 animate-spin" /> : null}Ask</button>
      {error ? <p role="alert" className="rounded-lg bg-red-50 px-3 py-2 text-sm text-red-800">{error}</p> : null}
      {answer ? (
        <div role="status" className="rounded-xl bg-slate-50 px-4 py-3 text-sm text-slate-800">
          {answer.text}
          {!answer.escalated ? <p className="mt-2 text-xs text-slate-500">Automated answer from our published policies. Reply to our email or use the form above if you need a person.</p> : null}
        </div>
      ) : null}
    </form>
  );
}
