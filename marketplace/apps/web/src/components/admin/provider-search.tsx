"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { Input } from "@/components/ui/form";
import { findProvidersAction } from "@/app/admin/actions";

type Hit = Awaited<ReturnType<typeof findProvidersAction>>[number];

/** Pick a provider by typing their name (or login email). Posts `providerId`. */
export function ProviderSearch({ name = "providerId" }: { name?: string }) {
  const [q, setQ] = useState("");
  const [hits, setHits] = useState<Hit[]>([]);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [picked, setPicked] = useState<Hit | null>(null);
  const seq = useRef(0);

  useEffect(() => {
    if (picked || q.trim().length < 2) {
      setHits([]);
      return;
    }
    const n = ++seq.current;
    setBusy(true);
    const t = setTimeout(async () => {
      const r = await findProvidersAction(q).catch(() => []);
      if (n !== seq.current) return; // a newer search is on its way
      setHits(r);
      setBusy(false);
      setOpen(true);
    }, 250);
    return () => clearTimeout(t);
  }, [q, picked]);

  if (picked)
    return (
      <div className="flex items-center justify-between gap-2 rounded-xl border border-brand-200 bg-brand-50/50 px-3 py-2 text-sm">
        <div className="min-w-0">
          <div className="font-medium text-slate-900">{picked.name}</div>
          <div className="truncate text-xs text-slate-500">{[picked.sub, picked.email].filter(Boolean).join(" · ")}</div>
        </div>
        <button type="button" onClick={() => { setPicked(null); setQ(""); }} className="shrink-0 rounded-full p-1 text-slate-500 hover:bg-white hover:text-slate-800" aria-label="Choose someone else"><X className="size-4" /></button>
        <input type="hidden" name={name} value={picked.id} />
      </div>
    );

  return (
    <div className="relative">
      <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
      <Input value={q} onChange={(e) => setQ(e.target.value)} onFocus={() => hits.length && setOpen(true)} onBlur={() => setTimeout(() => setOpen(false), 150)} placeholder="Type a provider's name" className="pl-9" autoComplete="off" aria-label="Search providers by name" />
      {/* Required, so the form can't be sent without a pick. */}
      <input type="text" name={name} value="" required readOnly tabIndex={-1} aria-hidden className="pointer-events-none absolute inset-0 opacity-0" onInvalid={(e) => (e.target as HTMLInputElement).setCustomValidity("Pick a provider from the list.")} />
      {open && q.trim().length >= 2 ? (
        <div className="absolute z-20 mt-1 w-full overflow-hidden rounded-xl border border-slate-200 bg-white shadow-lg">
          {busy && !hits.length ? <div className="px-3 py-2 text-sm text-slate-500">Searching…</div> : null}
          {!busy && !hits.length ? <div className="px-3 py-2 text-sm text-slate-500">No providers match “{q.trim()}”.</div> : null}
          {hits.map((h) => (
            <button key={h.id} type="button" onMouseDown={(e) => e.preventDefault()} onClick={() => { setPicked(h); setOpen(false); }} className="block w-full px-3 py-2 text-left hover:bg-slate-50">
              <div className="text-sm font-medium text-slate-900">{h.name}{h.legalName ? <span className="font-normal text-slate-500"> ({h.legalName})</span> : null}</div>
              <div className="truncate text-xs text-slate-500">{[h.sub, h.email].filter(Boolean).join(" · ")}</div>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}
