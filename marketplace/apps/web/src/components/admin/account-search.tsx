"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/form";
import { findAccountsAction } from "@/app/admin/actions";

type Hit = Awaited<ReturnType<typeof findAccountsAction>>[number];
type Kind = "PROVIDER" | "CLINIC";

/**
 * Pick a provider and/or clinic by typing a name or login email. Posts `name` (the id),
 * `${name}Type` (PROVIDER or CLINIC) and `${name}Name` (for the confirmation message).
 */
export function AccountSearch({ types, name, placeholder }: { types: Kind[]; name: string; placeholder?: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Hit | null>(null);
  const seq = useRef(0);
  const both = types.length > 1;
  const key = types.join(",");

  useEffect(() => {
    if (picked || q.trim().length < 2) {
      setHits([]);
      return;
    }
    const n = ++seq.current;
    setBusy(true);
    const t = setTimeout(async () => {
      const r = await findAccountsAction(q, key.split(",") as Kind[]).catch(() => []);
      if (n !== seq.current) return; // a newer search is on its way
      setHits(r);
      setBusy(false);
      setOpen(true);
    }, 250);
    return () => clearTimeout(t);
  }, [q, picked, key]);

  const tag = (h: Hit) => (both ? <span className={`mr-1.5 rounded px-1.5 py-0.5 text-[10px] font-semibold uppercase tracking-wide ${h.type === "CLINIC" ? "bg-accent-50 text-accent-800" : "bg-brand-50 text-brand-700"}`}>{h.type === "CLINIC" ? "Clinic" : "Provider"}</span> : null);

  if (picked)
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-brand-200 bg-brand-50/50 px-3 py-2 text-sm">
        <div className="min-w-0">
          <div className="font-medium text-slate-900">{tag(picked)}{picked.name}</div>
          <div className="truncate text-xs text-slate-500">{[picked.sub, picked.email].filter(Boolean).join(" · ")}</div>
        </div>
        <button type="button" onClick={() => { setPicked(null); setQ(""); }} className="shrink-0 rounded-full p-1 text-slate-500 hover:bg-white hover:text-slate-800" aria-label="Choose someone else"><X className="size-4" /></button>
        <input type="hidden" name={name} value={picked.id} />
        <input type="hidden" name={`${name}Type`} value={picked.type} />
        <input type="hidden" name={`${name}Name`} value={picked.name} />
      </div>
    );

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => hits.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder={placeholder ?? "Type a name or email"} className="pl-9" autoComplete="off" aria-label={placeholder ?? "Search by name or email"} />
      {/* Required, so the form can't be sent without a pick. */}
      <input type="text" name={name} value="" required readOnly tabIndex={-1} aria-hidden className="pointer-events-none absolute inset-0 opacity-0" onInvalid={(e) => (e.target as HTMLInputElement).setCustomValidity("Pick someone from the list.")} />
      {open && q.trim().length >= 2 ? (
        <div className="absolute z-20 mt-1 max-h-80 w-full overflow-y-auto rounded-xl border border-slate-200 bg-white shadow-lg">
          {busy && !hits.length ? <div className="px-3 py-2 text-sm text-slate-500">Searching…</div> : null}
          {!busy && !hits.length ? <div className="px-3 py-2 text-sm text-slate-500">No matches for “{q.trim()}”.</div> : null}
          {hits.map((h) => (
            <button key={`${h.type}:${h.id}`} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setPicked(h); setOpen(false); }} className="block w-full px-3 py-2 text-left hover:bg-slate-50">
              <div className="text-sm font-medium text-slate-900">{tag(h)}{h.name}{h.legalName ? <span className="font-normal text-slate-500"> ({h.legalName})</span> : null}</div>
              <div className="truncate text-xs text-slate-500">{[h.sub, h.email].filter(Boolean).join(" · ")}</div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
