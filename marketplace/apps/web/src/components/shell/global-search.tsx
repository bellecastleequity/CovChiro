"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { createPortal } from "react-dom";
import { useRouter } from "next/navigation";
import { CornerDownLeft, FileText, Loader2, Search, SlidersHorizontal, User, X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Backend search bar (console style): pages and settings match instantly in the browser;
 * people, clinics, shifts and other records come from /api/search (scoped to the user's role).
 * "/" or Ctrl/⌘+K focuses it; ↑ ↓ to move, Enter to open, Esc to close.
 */
export interface SearchEntry {
  label: string;
  href: string;
  section: string;
  keywords?: string;
  kind?: "page" | "setting";
}
interface Hit {
  group: string;
  label: string;
  sub?: string;
  href: string;
  kind: "page" | "setting" | "record";
}

function score(e: SearchEntry, terms: string[]): number {
  const label = e.label.toLowerCase();
  const hay = `${label} ${e.section.toLowerCase()} ${(e.keywords ?? "").toLowerCase()}`;
  let s = 0;
  for (const t of terms) {
    if (label.startsWith(t)) s += 6;
    else if (label.split(/[\s:&/(),-]+/).some((w) => w.startsWith(t))) s += 4;
    else if (label.includes(t)) s += 3;
    else if (hay.includes(t)) s += 1;
    else return 0;
  }
  return s + (e.kind === "setting" ? 0 : 1);
}

export function GlobalSearch({ entries, placeholder }: { entries: SearchEntry[]; placeholder: string }) {
  const router = useRouter();
  const [q, setQ] = useState("");
  const [open, setOpen] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [active, setActive] = useState(0);
  const [records, setRecords] = useState<Hit[]>([]);
  const [loading, setLoading] = useState(false);
  const input = useRef<HTMLInputElement>(null);
  const mobileInput = useRef<HTMLInputElement>(null);
  const box = useRef<HTMLDivElement>(null);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const t = e.target as HTMLElement | null;
      const typing = t && (t.tagName === "INPUT" || t.tagName === "TEXTAREA" || t.tagName === "SELECT" || t.isContentEditable);
      if ((e.key === "k" && (e.metaKey || e.ctrlKey)) || (e.key === "/" && !typing)) {
        e.preventDefault();
        if (window.matchMedia("(min-width: 768px)").matches) input.current?.focus();
        else setMobileOpen(true);
      }
    };
    const onClick = (e: MouseEvent) => {
      if (box.current && !box.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("keydown", onKey);
    document.addEventListener("mousedown", onClick);
    return () => {
      document.removeEventListener("keydown", onKey);
      document.removeEventListener("mousedown", onClick);
    };
  }, []);
  useEffect(() => {
    if (mobileOpen) setTimeout(() => mobileInput.current?.focus(), 30);
  }, [mobileOpen]);

  // Records: debounced, latest query wins.
  useEffect(() => {
    const term = q.trim();
    if (term.length < 2) {
      setRecords([]);
      setLoading(false);
      return;
    }
    setLoading(true);
    const ctl = new AbortController();
    const t = setTimeout(async () => {
      try {
        const r = await fetch(`/api/search?q=${encodeURIComponent(term)}`, { signal: ctl.signal });
        const j = (await r.json()) as { hits?: Omit<Hit, "kind">[] };
        setRecords((j.hits ?? []).map((h) => ({ ...h, kind: "record" as const })));
      } catch {
        /* aborted or offline */
      } finally {
        if (!ctl.signal.aborted) setLoading(false);
      }
    }, 200);
    return () => {
      clearTimeout(t);
      ctl.abort();
    };
  }, [q]);

  const pages = useMemo<Hit[]>(() => {
    const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
    if (!terms.length) return [];
    return entries
      .map((e) => ({ e, s: score(e, terms) }))
      .filter((x) => x.s > 0)
      .sort((a, b) => b.s - a.s)
      .slice(0, 8)
      .map(({ e }) => ({ group: e.kind === "setting" ? "Settings" : "Pages", label: e.label, sub: e.section, href: e.href, kind: e.kind === "setting" ? "setting" : "page" }));
  }, [q, entries]);

  const hits = useMemo(() => {
    const p = pages.filter((h) => h.kind === "page");
    const s = pages.filter((h) => h.kind === "setting").slice(0, 4);
    return [...p, ...records, ...s];
  }, [pages, records]);
  useEffect(() => setActive(0), [q]);

  const go = (h: Hit | undefined) => {
    if (!h) return;
    setOpen(false);
    setMobileOpen(false);
    setQ("");
    router.push(h.href);
  };
  const onKeyDown = (e: React.KeyboardEvent) => {
    if (e.key === "ArrowDown") (e.preventDefault(), setActive((a) => Math.min(a + 1, hits.length - 1)));
    else if (e.key === "ArrowUp") (e.preventDefault(), setActive((a) => Math.max(a - 1, 0)));
    else if (e.key === "Enter") (e.preventDefault(), go(hits[active]));
    else if (e.key === "Escape") (setOpen(false), setMobileOpen(false), (e.target as HTMLInputElement).blur());
  };

  const results = (
    <div role="listbox" className="max-h-[70dvh] overflow-y-auto py-1">
      {q.trim() && !hits.length && !loading ? <div className="px-4 py-6 text-center text-sm text-slate-500">No matches for “{q.trim()}”.</div> : null}
      {hits.map((h, i) => {
        const header = i === 0 || hits[i - 1].group !== h.group;
        const Icon = h.kind === "page" ? FileText : h.kind === "setting" ? SlidersHorizontal : User;
        return (
          <div key={`${h.href}-${i}`}>
            {header ? <div className="px-4 pb-1 pt-3 text-[11px] font-semibold uppercase tracking-wide text-slate-400">{h.group}</div> : null}
            <button
              type="button"
              role="option"
              aria-selected={i === active}
              onMouseEnter={() => setActive(i)}
              onMouseDown={(e) => e.preventDefault()}
              onClick={() => go(h)}
              className={cn("flex w-full items-center gap-3 px-4 py-2 text-left text-sm", i === active ? "bg-brand-50 text-brand-900" : "text-slate-700")}
            >
              <Icon className="size-4 shrink-0 text-slate-400" />
              <span className="min-w-0 flex-1">
                <span className="block truncate font-medium">{h.label}</span>
                {h.sub ? <span className="block truncate text-xs text-slate-500">{h.sub}</span> : null}
              </span>
              {i === active ? <CornerDownLeft className="size-3.5 shrink-0 text-slate-400" /> : null}
            </button>
          </div>
        );
      })}
      {loading ? <div className="flex items-center gap-2 px-4 py-2 text-xs text-slate-400"><Loader2 className="size-3.5 animate-spin" /> Searching records…</div> : null}
    </div>
  );

  return (
    <>
      {/* Desktop / tablet: a wide bar in the header. */}
      <div ref={box} className="relative hidden w-full max-w-xl md:block">
        <div className={cn("flex items-center gap-2 rounded-xl border bg-slate-50 px-3 transition", open ? "border-brand-300 bg-white shadow-sm ring-2 ring-brand-100" : "border-slate-200")}>
          <Search className="size-4 shrink-0 text-slate-400" />
          <input
            ref={input}
            value={q}
            onChange={(e) => (setQ(e.target.value), setOpen(true))}
            onFocus={() => setOpen(true)}
            onKeyDown={onKeyDown}
            placeholder={placeholder}
            aria-label="Search"
            className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-slate-400"
          />
          {q ? (
            <button type="button" onClick={() => (setQ(""), input.current?.focus())} aria-label="Clear search" className="text-slate-400 hover:text-slate-600"><X className="size-4" /></button>
          ) : (
            <kbd className="hidden rounded border border-slate-200 bg-white px-1.5 text-[11px] text-slate-400 lg:block">/</kbd>
          )}
        </div>
        {open && q.trim() ? <div className="absolute inset-x-0 top-12 z-50 overflow-hidden rounded-xl border border-slate-200 bg-white shadow-xl">{results}</div> : null}
      </div>

      {/* Phones: an icon that opens a full-screen search. */}
      <button type="button" onClick={() => setMobileOpen(true)} className="grid size-10 place-items-center rounded-lg text-slate-600 hover:bg-slate-100 md:hidden" aria-label="Search">
        <Search className="size-5" />
      </button>
      {/* Portal: the sticky, blurred header would otherwise trap a fixed overlay inside it. */}
      {mobileOpen ? createPortal(
        <div className="fixed inset-0 z-50 flex flex-col bg-white md:hidden" role="dialog" aria-modal="true" aria-label="Search">
          <div className="flex items-center gap-2 border-b border-slate-200 px-3 py-2">
            <Search className="size-5 shrink-0 text-slate-400" />
            <input ref={mobileInput} value={q} onChange={(e) => setQ(e.target.value)} onKeyDown={onKeyDown} placeholder={placeholder} aria-label="Search" className="h-11 min-w-0 flex-1 bg-transparent text-base outline-none" />
            <button type="button" onClick={() => (setMobileOpen(false), setQ(""))} className="rounded-lg px-2 py-2 text-sm text-slate-600 hover:bg-slate-100">Cancel</button>
          </div>
          <div className="flex-1 overflow-y-auto">{q.trim() ? results : <p className="px-4 py-6 text-sm text-slate-500">Search pages, settings{entries.some((e) => e.section === "Admin") ? ", providers, clinics, shifts, leads and more" : " and your records"}.</p>}</div>
        </div>,
        document.body,
      ) : null}
    </>
  );
}
