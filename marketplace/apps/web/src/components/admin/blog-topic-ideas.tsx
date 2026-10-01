"use client";

import { useState } from "react";
import { Lightbulb, Sparkles } from "lucide-react";
import { ActionForm, SubmitButton, type ActionState } from "@/components/ui/action-form";
import { Select } from "@/components/ui/form";

type Idea = { topic: string; audience: string };
type Action = (prev: ActionState, fd: FormData) => Promise<ActionState>;

const LABEL: Record<string, string> = { CLINIC: "Clinics", PROVIDER: "Providers", ALL: "Everyone" };

/** Ask the AI for topic ideas, then draft any of them in one click. */
export function BlogTopicIdeas({ suggest, draft }: { suggest: Action; draft: Action }) {
  const [ideas, setIdeas] = useState<Idea[]>([]);
  return (
    <div>
      <ActionForm action={suggest} successMessage={false} onDone={(s) => Array.isArray(s?.data) && setIdeas(s.data as Idea[])} className="flex flex-wrap items-end gap-2">
        <label className="text-sm">
          <span className="mb-1 block font-medium text-slate-700">Ideas for</span>
          <Select name="audience" defaultValue="CLINIC" className="w-40">
            <option value="CLINIC">Clinics</option>
            <option value="PROVIDER">Providers</option>
            <option value="ALL">Both</option>
          </Select>
        </label>
        <SubmitButton variant="outline" pendingText="Thinking…"><Lightbulb className="size-4" />Suggest topics</SubmitButton>
      </ActionForm>
      {ideas.length ? (
        <ul className="mt-4 divide-y divide-slate-100 rounded-xl border border-slate-200">
          {ideas.map((i) => (
            <li key={i.topic} className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
              <div className="min-w-0 flex-1 text-sm">
                <div className="font-medium text-slate-900">{i.topic}</div>
                <div className="text-xs text-slate-500">{LABEL[i.audience] ?? i.audience}</div>
              </div>
              <ActionForm action={draft} successMessage={false}>
                <input type="hidden" name="topic" value={i.topic} />
                <input type="hidden" name="audience" value={i.audience} />
                <SubmitButton size="sm" pendingText="Writing… (up to 2 min)"><Sparkles className="size-4" />Write draft</SubmitButton>
              </ActionForm>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}
