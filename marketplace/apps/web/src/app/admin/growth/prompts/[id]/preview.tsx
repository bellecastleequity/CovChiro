"use client";

import { useState } from "react";
import { ActionForm, SubmitButton, type ActionState } from "@/components/ui/action-form";
import { Badge } from "@/components/ui/badge";
import type { growth } from "@cm/services";
import { previewPromptAction } from "../../actions";

type Preview = Awaited<ReturnType<typeof growth.previewPrompt>>;

/** Renders the version with sample values; "with AI" shows what the model would write and whether the guardrails would accept it. */
export function PromptPreview({ id, hasInstructions }: { id: string; hasInstructions: boolean }) {
  const [data, setData] = useState<Preview | null>(null);
  const onDone = (s: ActionState) => { if (s?.data) setData(s.data as Preview); };
  return (
    <div className="space-y-3">
      <div className="flex gap-2">
        <ActionForm action={previewPromptAction} onDone={onDone} successMessage={false}><input type="hidden" name="id" value={id} /><SubmitButton size="sm" variant="outline">Preview</SubmitButton></ActionForm>
        {hasInstructions ? <ActionForm action={previewPromptAction} onDone={onDone}><input type="hidden" name="id" value={id} /><input type="hidden" name="ai" value="true" /><SubmitButton size="sm" variant="outline" pendingText="Asking the model…">Preview with AI</SubmitButton></ActionForm> : null}
      </div>
      {data ? (
        <div className="grid gap-3 lg:grid-cols-2">
          <div className="rounded-xl border border-slate-200 p-3"><div className="mb-1 text-xs font-medium text-slate-500">Approved template (sample values)</div><div className="font-medium">{data.subject}</div><p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{data.body}</p></div>
          {data.ai ? (
            <div className="rounded-xl border border-slate-200 p-3">
              <div className="mb-1 flex items-center gap-2 text-xs font-medium text-slate-500">AI version · {data.ai.model} {data.ai.guardrail ? <Badge tone="red">Would be rejected: {data.ai.guardrail}</Badge> : <Badge tone="green">Passes guardrails</Badge>}</div>
              <div className="font-medium">{data.ai.subject}</div><p className="mt-2 whitespace-pre-wrap text-sm text-slate-700">{data.ai.body}</p>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
