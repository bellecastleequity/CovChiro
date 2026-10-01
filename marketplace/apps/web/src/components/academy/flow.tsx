import { ArrowDown } from "lucide-react";
import { cn } from "@/lib/cn";

type Tone = "brand" | "accent" | "slate" | "amber" | "green" | "red";

const TONES: Record<Tone, string> = {
  brand: "border-brand-200 bg-brand-50 text-brand-900",
  accent: "border-accent-200 bg-accent-50 text-accent-900",
  slate: "border-slate-200 bg-white text-slate-900",
  amber: "border-amber-200 bg-amber-50 text-amber-900",
  green: "border-emerald-200 bg-emerald-50 text-emerald-900",
  red: "border-red-200 bg-red-50 text-red-900",
};

export interface FlowStep {
  title: React.ReactNode;
  detail?: React.ReactNode;
  tone?: Tone;
  /** Side-by-side outcomes after this step (a decision). */
  branches?: { label: React.ReactNode; title: React.ReactNode; detail?: React.ReactNode; tone?: Tone }[];
}

/** A top-to-bottom flowchart in plain HTML: readable on phones, prints cleanly, no image to go stale. */
export function Flow({ steps, caption }: { steps: FlowStep[]; caption?: React.ReactNode }) {
  return (
    <figure className="my-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-6">
      <ol className="flex flex-col items-stretch">
        {steps.map((st, i) => (
          <li key={i} className="flex flex-col items-center">
            <div className={cn("w-full max-w-xl rounded-xl border px-4 py-3 shadow-card", TONES[st.tone ?? "slate"])}>
              <div className="text-sm font-semibold">{st.title}</div>
              {st.detail ? <div className="mt-0.5 text-sm opacity-80">{st.detail}</div> : null}
            </div>
            {st.branches ? (
              <div className="mt-3 grid w-full gap-3 sm:grid-cols-2">
                {st.branches.map((b, j) => (
                  <div key={j} className="flex flex-col items-center">
                    <div className="mb-1 text-xs font-semibold uppercase tracking-wide text-slate-500">{b.label}</div>
                    <div className={cn("w-full rounded-xl border px-4 py-3", TONES[b.tone ?? "slate"])}>
                      <div className="text-sm font-semibold">{b.title}</div>
                      {b.detail ? <div className="mt-0.5 text-sm opacity-80">{b.detail}</div> : null}
                    </div>
                  </div>
                ))}
              </div>
            ) : null}
            {i < steps.length - 1 ? <ArrowDown aria-hidden className="my-1.5 size-5 text-slate-400" /> : null}
          </li>
        ))}
      </ol>
      {caption ? <figcaption className="mt-4 text-center text-xs text-slate-500">{caption}</figcaption> : null}
    </figure>
  );
}

/** A timeline counting down to (and past) a moment, e.g. the shift start. */
export function Timeline({ items, caption }: { items: { when: React.ReactNode; what: React.ReactNode; detail?: React.ReactNode; tone?: Tone }[]; caption?: React.ReactNode }) {
  return (
    <figure className="my-6 rounded-2xl border border-slate-200 bg-slate-50 p-4 sm:p-6">
      <ol className="relative ml-2 border-l-2 border-slate-200">
        {items.map((it, i) => (
          <li key={i} className="relative pb-5 pl-6 last:pb-0">
            <span className={cn("absolute -left-[9px] top-1 size-4 rounded-full border-2 border-white ring-1 ring-slate-300", it.tone === "red" ? "bg-red-500" : it.tone === "amber" ? "bg-amber-500" : it.tone === "green" ? "bg-emerald-500" : it.tone === "accent" ? "bg-accent-500" : "bg-brand-600")} />
            <div className="text-xs font-semibold uppercase tracking-wide text-accent-700">{it.when}</div>
            <div className="text-sm font-semibold text-slate-900">{it.what}</div>
            {it.detail ? <div className="text-sm text-slate-600">{it.detail}</div> : null}
          </li>
        ))}
      </ol>
      {caption ? <figcaption className="mt-4 text-xs text-slate-500">{caption}</figcaption> : null}
    </figure>
  );
}

/** Lesson prose helpers so every lesson reads the same. */
export function H({ children }: { children: React.ReactNode }) {
  return <h2 className="mb-2 mt-8 text-lg font-semibold text-slate-900 first:mt-0">{children}</h2>;
}
export function P({ children }: { children: React.ReactNode }) {
  return <p className="my-3 text-[15px] leading-relaxed text-slate-700">{children}</p>;
}
export function Ul({ items }: { items: React.ReactNode[] }) {
  return (
    <ul className="my-3 space-y-2 text-[15px] leading-relaxed text-slate-700">
      {items.map((x, i) => (
        <li key={i} className="flex gap-2.5">
          <span aria-hidden className="mt-2.5 size-1.5 shrink-0 rounded-full bg-accent-500" />
          <span>{x}</span>
        </li>
      ))}
    </ul>
  );
}
export function KeyFacts({ rows }: { rows: [React.ReactNode, React.ReactNode][] }) {
  return (
    <dl className="my-5 divide-y divide-slate-100 rounded-2xl border border-slate-200 bg-white text-sm">
      {rows.map(([k, v], i) => (
        <div key={i} className="flex flex-wrap justify-between gap-x-4 gap-y-0.5 px-4 py-2.5">
          <dt className="text-slate-600">{k}</dt>
          <dd className="font-semibold text-slate-900">{v}</dd>
        </div>
      ))}
    </dl>
  );
}
