"use client";

import { useEffect, useRef, useState } from "react";
import { Search, X } from "lucide-react";
import { cn } from "@/lib/cn";

/**
 * Admin Settings: instant filter over the rows the server rendered (data-setting / data-text), plus
 * "Changed from default" and "Owner decision" filters. Groups are <details data-group>: a search opens
 * every group with a match and hides the rest; a #s-<key> link (header search, other pages) opens the
 * group holding that setting first.
 */
export function SettingsFilter({ total }: { total: number }) {
  const [q, setQ] = useState("");
  const [changed, setChanged] = useState(false);
  const [owner, setOwner] = useState(false);
  const [shown, setShown] = useState(total);
  const input = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const words = q.toLowerCase().split(/\s+/).filter(Boolean);
    const filtering = words.length > 0 || changed || owner;
    let n = 0;
    document.querySelectorAll<HTMLDetailsElement>("details[data-group]").forEach((g) => {
      let inGroup = 0;
      g.querySelectorAll<HTMLElement>("[data-setting]").forEach((row) => {
        const text = row.dataset.text ?? "";
        const ok = words.every((w) => text.includes(w)) && (!changed || row.dataset.changed === "1") && (!owner || row.dataset.flag === "1");
        row.hidden = !ok;
        if (ok) inGroup++;
      });
      n += inGroup;
      g.hidden = filtering && inGroup === 0;
      if (filtering) g.open = inGroup > 0;
      const count = g.querySelector<HTMLElement>("[data-count]");
      if (count) count.textContent = filtering ? `${inGroup} match${inGroup === 1 ? "" : "es"}` : `${count.dataset.total}`;
    });
    document.querySelectorAll<HTMLElement>("[data-index-group]").forEach((a) => {
      const g = document.getElementById(a.dataset.indexGroup!);
      a.hidden = !!g?.hidden;
    });
    setShown(n);
  }, [q, changed, owner]);

  // Open the group that holds a linked setting (#s-<key>) or group (#g-<slug>).
  useEffect(() => {
    const openTarget = () => {
      const id = decodeURIComponent(location.hash.slice(1));
      if (!id) return;
      const el = document.getElementById(id);
      if (!el) return;
      const g = el.tagName === "DETAILS" ? (el as HTMLDetailsElement) : el.closest("details");
      if (g) g.open = true;
      requestAnimationFrame(() => el.scrollIntoView({ block: "start" }));
    };
    openTarget();
    window.addEventListener("hashchange", openTarget);
    return () => window.removeEventListener("hashchange", openTarget);
  }, []);

  const chip = (on: boolean) => cn("rounded-full px-3 py-1.5 text-sm font-medium ring-1 transition", on ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-200 hover:bg-slate-50");
  return (
    <div className="sticky top-16 z-10 -mx-1 space-y-2 rounded-2xl bg-slate-50/95 px-1 py-2 backdrop-blur">
      <div className="relative">
        <Search className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-slate-400" />
        <input
          ref={input}
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          placeholder="Find a setting: provider, deposit, apollo, reminder…"
          aria-label="Find a setting"
          className="h-11 w-full rounded-xl border border-slate-300 bg-white pl-9 pr-9 text-sm shadow-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-500/30"
        />
        {q ? (
          <button type="button" onClick={() => { setQ(""); input.current?.focus(); }} aria-label="Clear" className="absolute right-2 top-1/2 -translate-y-1/2 rounded-lg p-1 text-slate-400 hover:text-slate-600">
            <X className="size-4" />
          </button>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={chip(changed)} aria-pressed={changed} onClick={() => setChanged((v) => !v)}>Changed from default</button>
        <button type="button" className={chip(owner)} aria-pressed={owner} onClick={() => setOwner((v) => !v)}>Owner decisions</button>
        <span className="ml-auto text-xs text-slate-500">{shown === total ? `${total} settings` : `${shown} of ${total} settings`}</span>
      </div>
    </div>
  );
}
