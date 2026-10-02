import Link from "next/link";
import { CheckCircle2, CircleDashed } from "lucide-react";
import type { SetupStatus as Status } from "@/lib/setup";

/**
 * Persistent account-setup status in the header: a progress chip ("Setup 5/8")
 * that opens the remaining steps, or a green "Ready" check once everything is done.
 */
export function SetupStatus({ status }: { status: Status }) {
  const total = status.items.length;
  const done = status.items.filter((i) => i.done).length;
  if (done === total) {
    return (
      <span title="Setup complete" className="mr-1 inline-flex items-center gap-1.5 rounded-full bg-emerald-50 px-1.5 py-1 sm:px-2.5 text-xs font-semibold text-emerald-700 ring-1 ring-emerald-200">
        <CheckCircle2 className="size-4" />
        <span className="hidden sm:inline">{status.readyLabel}</span>
      </span>
    );
  }
  const pct = Math.round((done / total) * 100);
  return (
    <details className="group relative sm:mr-1">
      <summary className="flex cursor-pointer list-none items-center gap-1 rounded-full bg-amber-50 px-1.5 py-1 sm:gap-1.5 sm:px-2.5 text-xs font-semibold text-amber-800 ring-1 ring-amber-200 hover:bg-amber-100 [&::-webkit-details-marker]:hidden" aria-label={`Setup ${done} of ${total} done`}>
        <span className="relative grid size-5 place-items-center">
          <svg viewBox="0 0 36 36" className="size-5 -rotate-90" aria-hidden>
            <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeOpacity="0.2" strokeWidth="4" />
            <circle cx="18" cy="18" r="15" fill="none" stroke="currentColor" strokeWidth="4" strokeDasharray={`${(pct / 100) * 94.2} 94.2`} strokeLinecap="round" />
          </svg>
        </span>
        <span><span className="hidden sm:inline">Setup </span>{done}/{total}</span>
      </summary>
      <div className="fixed inset-x-4 top-14 z-40 mt-2 sm:absolute sm:inset-x-auto sm:right-0 sm:top-full sm:w-80 rounded-2xl border border-slate-200 bg-white p-3 shadow-xl">
        <div className="mb-2 text-sm font-semibold text-slate-900">{total - done} step{total - done === 1 ? "" : "s"} left</div>
        <ul className="space-y-1">
          {status.items.map((i) => (
            <li key={i.label}>
              {i.done || !i.href ? (
                <div className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm">
                  {i.done ? <CheckCircle2 className="mt-0.5 size-4 shrink-0 text-emerald-600" /> : <CircleDashed className="mt-0.5 size-4 shrink-0 text-amber-600" />}
                  <span className={i.done ? "text-slate-400 line-through" : "font-medium text-slate-800"}>{i.label}{!i.done && i.hint ? <span className="block text-xs font-normal text-slate-500">{i.hint}</span> : null}</span>
                </div>
              ) : (
                <Link href={i.href} className="flex items-start gap-2 rounded-lg px-2 py-1.5 text-sm hover:bg-slate-50">
                  <CircleDashed className="mt-0.5 size-4 shrink-0 text-amber-600" />
                  <span className="font-medium text-slate-800">{i.label}{i.hint ? <span className="block text-xs font-normal text-slate-500">{i.hint}</span> : null}</span>
                  <span className="ml-auto text-xs font-medium text-brand-700">Start</span>
                </Link>
              )}
            </li>
          ))}
        </ul>
        <Link href={status.base} className="mt-2 block px-2 text-xs font-medium text-brand-700 hover:underline">Open your checklist</Link>
      </div>
    </details>
  );
}
