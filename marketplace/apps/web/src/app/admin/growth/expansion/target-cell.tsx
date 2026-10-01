"use client";

import { ActionForm } from "@/components/ui/action-form";
import { cn } from "@/lib/cn";
import { targetStatusAction } from "../actions";

const TONE: Record<string, string> = {
  OFF: "bg-slate-50 text-slate-500 ring-slate-200",
  PRELAUNCH: "bg-amber-50 text-amber-900 ring-amber-300",
  LIVE: "bg-emerald-50 text-emerald-800 ring-emerald-300",
};

/** One profession × state switch: Off / Prelaunch / Live (saves on change). */
export function TargetCell({ professionCode, state, status }: { professionCode: string; state: string; status: string }) {
  const id = `target-${professionCode}-${state}`;
  return (
    // A refused switch (e.g. Live while the marketplace is off) snaps back to the saved status.
    <ActionForm id={id} action={targetStatusAction} successMessage={false} className="text-left" onDone={(s) => { if (s?.error) (document.getElementById(id) as HTMLFormElement | null)?.reset(); }}>
      <input type="hidden" name="professionCode" value={professionCode} />
      <input type="hidden" name="state" value={state} />
      <select
        key={status}
        name="status"
        defaultValue={status}
        aria-label={`${professionCode} in ${state}`}
        onChange={(e) => e.currentTarget.form?.requestSubmit()}
        className={cn("w-full rounded-md border-0 py-1 pl-2 pr-6 text-xs font-medium ring-1 ring-inset focus:ring-2 focus:ring-brand-500", TONE[status] ?? TONE.OFF)}
      >
        <option value="OFF">Off</option>
        <option value="PRELAUNCH">Prelaunch</option>
        <option value="LIVE">Live</option>
      </select>
    </ActionForm>
  );
}
