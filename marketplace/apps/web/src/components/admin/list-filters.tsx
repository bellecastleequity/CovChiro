import Link from "next/link";
import { US_STATES } from "@cm/core";
import { buttonClass } from "@/components/ui/button";
import { Input, Select } from "@/components/ui/form";

/** Admin list filters (Providers, Clinics): links keep every other filter, so chips and selects combine. */
export type ListParams = Record<string, string | undefined>;

export function listHref(path: string, params: ListParams, set: ListParams = {}) {
  const sp = new URLSearchParams();
  for (const [k, v] of Object.entries({ ...params, ...set })) if (v) sp.set(k, v);
  const s = sp.toString();
  return s ? `${path}?${s}` : path;
}

export const stateLabel = (code: string) => (US_STATES[code] ? `${US_STATES[code]} (${code})` : code);

/** Count chips: "All 512 · Ready 120 · Onboarding 300 …"; the active one is filled. */
export function CountChips({ path, params, name, total, options }: { path: string; params: ListParams; name: string; total: number; options: { value: string; label: string; count: number }[] }) {
  const cur = params[name];
  const chip = (value: string | undefined, label: string, count: number) => {
    const on = (cur ?? "") === (value ?? "");
    return (
      <Link key={value ?? "all"} href={listHref(path, params, { [name]: value, all: undefined })} aria-current={on ? "true" : undefined}
        className={`inline-flex items-center gap-1.5 rounded-full border px-3 py-1.5 text-sm font-medium transition ${on ? "border-brand-600 bg-brand-600 text-white" : "border-slate-200 bg-white text-slate-700 hover:border-brand-300 hover:text-brand-700"} ${count === 0 && !on ? "opacity-50" : ""}`}>
        {label}<span className={`rounded-full px-1.5 text-xs tabular-nums ${on ? "bg-white/20" : "bg-slate-100 text-slate-600"}`}>{count.toLocaleString()}</span>
      </Link>
    );
  };
  return <div className="flex flex-wrap gap-2">{chip(undefined, "All", total)}{options.map((o) => chip(o.value, o.label, o.count))}</div>;
}

/** Search box + selects (state and others), submitted as a GET form; chips' value carried in hidden fields. */
export function FilterForm({ path, params, placeholder, selects, keep }: {
  path: string;
  params: ListParams;
  placeholder: string;
  selects: { name: string; label: string; options: { value: string; label: string }[] }[];
  keep: string[];
}) {
  const active = Object.entries(params).some(([k, v]) => v && k !== "all");
  return (
    <form action={path} className="flex flex-wrap items-end gap-2">
      {keep.map((k) => (params[k] ? <input key={k} type="hidden" name={k} value={params[k]} /> : null))}
      <label className="grow basis-56 sm:grow-0"><span className="sr-only">Search</span><Input name="q" defaultValue={params.q} placeholder={placeholder} className="w-full sm:w-64" /></label>
      {selects.map((s) => (
        <label key={s.name} className="grow basis-40 sm:grow-0">
          <span className="mb-1 block text-xs font-medium text-slate-500">{s.label}</span>
          <Select name={s.name} defaultValue={params[s.name] ?? ""} className="w-full sm:w-52">
            <option value="">Any</option>
            {s.options.map((o) => <option key={o.value} value={o.value}>{o.label}</option>)}
          </Select>
        </label>
      ))}
      <button className={buttonClass("primary")}>Apply</button>
      {active ? <Link href={path} className={buttonClass("ghost")}>Clear filters</Link> : null}
    </form>
  );
}

/** "Showing 200 of 512 matching · 1,240 in total · Show all". */
export function ListSummary({ path, params, shown, matched, total, noun }: { path: string; params: ListParams; shown: number; matched: number; total: number; noun: string }) {
  return (
    <p className="text-sm text-slate-600">
      <span className="font-semibold text-slate-900">{matched.toLocaleString()}</span> {matched === total ? `${noun} in total` : <>matching · {total.toLocaleString()} {noun} in total</>}
      {shown < matched ? <> · showing the newest {shown.toLocaleString()} · <Link href={listHref(path, params, { all: "1" })} className="font-medium text-brand-700 hover:underline">Show all</Link></> : null}
    </p>
  );
}
