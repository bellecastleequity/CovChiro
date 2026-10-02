"use client";

import { useEffect, useState } from "react";
import { ActionForm, type ActionState } from "@/components/ui/action-form";
import { buttonClass } from "@/components/ui/button";

type Act = { value: string; label: string; verb: string; variant?: "primary" | "outline" | "danger"; /** Selects every box in this group first ("Approve all …"). */ allOf?: string };

const boxes = (formId: string, group?: string) =>
  [...document.querySelectorAll<HTMLInputElement>(`input[type=checkbox][form="${formId}"]`)].filter((b) => !group || b.dataset.group === group);

/**
 * Multi-select for a list of server-rendered rows. Each row renders
 * <input type="checkbox" name="ids" value=… form={formId} data-group=…>;
 * this bar counts them, offers select-all per group and submits the chosen
 * decision with every checked id. Each action confirms with the exact count.
 */
export function BulkSelect({ formId, action, groups = [], actions, noun = "item" }: { formId: string; action: (p: ActionState, fd: FormData) => Promise<ActionState>; groups?: { key: string; label: string }[]; actions: Act[]; noun?: string }) {
  const [n, setN] = useState(0);
  const [counts, setCounts] = useState<Record<string, number>>({});
  const groupKeys = groups.map((g) => g.key).join(",");
  useEffect(() => {
    const keys = groupKeys ? groupKeys.split(",") : [];
    const recount = () => {
      setN(boxes(formId).filter((b) => b.checked).length);
      setCounts(Object.fromEntries(keys.map((k) => [k, boxes(formId, k).length])));
    };
    recount();
    document.addEventListener("change", recount);
    const t = setInterval(recount, 1000); // rows come and go after each action
    return () => { document.removeEventListener("change", recount); clearInterval(t); };
  }, [formId, groupKeys]);
  const setAll = (on: boolean, group?: string) => { boxes(formId, group).forEach((b) => (b.checked = on)); setN(boxes(formId).filter((b) => b.checked).length); };
  const plural = (k: number) => `${k} ${noun}${k === 1 ? "" : "s"}`;

  return (
    <ActionForm id={formId} action={action} className="sticky top-16 z-10 mb-4 rounded-2xl border border-slate-200 bg-white/95 p-3 shadow-sm backdrop-blur">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-sm font-semibold text-slate-800">{n ? `${plural(n)} selected` : "Select items below"}</span>
        {groups.filter((g) => counts[g.key]).map((g) => (
          <button key={g.key} type="button" onClick={() => setAll(true, g.key)} className={buttonClass("ghost", "sm")}>Select all {g.label} ({counts[g.key]})</button>
        ))}
        {n ? <button type="button" onClick={() => setAll(false)} className={buttonClass("ghost", "sm")}>Clear</button> : null}
        <span className="ml-auto flex flex-wrap gap-2">
          {actions.map((a) => {
            const k = a.allOf ? counts[a.allOf] ?? 0 : n;
            return (
              <button
                key={a.label}
                name="decision"
                value={a.value}
                disabled={!k}
                onClick={(e) => {
                  if (a.allOf) { setAll(false); setAll(true, a.allOf); }
                  const c = boxes(formId).filter((b) => b.checked).length;
                  if (!c || !window.confirm(`${a.verb} ${plural(c)}?`)) e.preventDefault();
                }}
                className={buttonClass(a.variant ?? "primary", "sm")}
              >
                {a.label}{k ? ` (${k})` : ""}
              </button>
            );
          })}
        </span>
      </div>
    </ActionForm>
  );
}
