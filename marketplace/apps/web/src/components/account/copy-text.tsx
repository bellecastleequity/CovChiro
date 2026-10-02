"use client";

import { useState } from "react";
import { Check, Copy } from "lucide-react";
import { buttonClass } from "@/components/ui/button";

export function CopyText({ text, label = "Copy" }: { text: string; label?: string }) {
  const [done, setDone] = useState(false);
  return (
    <div className="flex gap-2">
      <input readOnly value={text} onFocus={(e) => e.currentTarget.select()} className="min-w-0 flex-1 rounded-xl border border-slate-200 bg-slate-50 px-3 py-2 font-mono text-xs" aria-label="Link" />
      <button type="button" className={buttonClass("outline", "sm")} onClick={async () => (await navigator.clipboard?.writeText(text).catch(() => undefined), setDone(true), setTimeout(() => setDone(false), 2000))}>
        {done ? <Check className="size-4" /> : <Copy className="size-4" />}
        {done ? "Copied" : label}
      </button>
    </div>
  );
}
