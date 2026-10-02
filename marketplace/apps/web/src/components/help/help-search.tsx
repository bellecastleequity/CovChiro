"use client";

import { useMemo, useState } from "react";
import Link from "next/link";
import { ArrowRight, LifeBuoy, Search } from "lucide-react";

export interface HelpSearchItem {
  kind: "article" | "answer";
  title: string;
  summary: string;
  keywords: string;
  href?: string;
  answer?: string;
  category: string;
}

const norm = (t: string) => t.toLowerCase().normalize("NFKD").replace(/[^a-z0-9 ]/g, " ");

/** Instant search across this area's help articles and our approved answers. */
export function HelpSearch({ items, contactHref, autoFocus = false }: { items: HelpSearchItem[]; contactHref: string; autoFocus?: boolean }) {
  const [q, setQ] = useState("");
  const results = useMemo(() => {
    const words = norm(q).split(/\s+/).filter((w) => w.length > 1);
    if (!words.length) return [];
    return items
      .map((it) => {
        const title = norm(it.title);
        const hay = `${title} ${norm(it.summary)} ${norm(it.keywords)} ${norm(it.answer ?? "")}`;
        let score = 0;
        for (const w of words) {
          if (title.includes(w)) score += 3;
          else if (hay.includes(w)) score += 1;
          else if (w.length > 4 && hay.includes(w.slice(0, -1))) score += 0.5; // plurals
          else return null;
        }
        return { it, score };
      })
      .filter((x): x is { it: HelpSearchItem; score: number } => !!x)
      .sort((a, b) => b.score - a.score)
      .slice(0, 12)
      .map((x) => x.it);
  }, [q, items]);
  return (
    <div>
      <label className="relative block">
        <span className="sr-only">Search help</span>
        <Search className="pointer-events-none absolute left-4 top-1/2 size-5 -translate-y-1/2 text-slate-400" />
        <input
          type="search"
          value={q}
          onChange={(e) => setQ(e.target.value)}
          autoFocus={autoFocus}
          placeholder="Search help: e.g. “when am I charged”, “missed punch”, “cancel”"
          className="block w-full rounded-2xl border border-slate-300 bg-white py-3.5 pl-12 pr-4 text-base shadow-card focus:border-brand-500 focus:outline-none"
        />
      </label>
      {q.trim().length > 1 ? (
        <div className="mt-3 rounded-2xl border border-slate-200 bg-white shadow-card" aria-live="polite">
          {results.length ? (
            <ul className="divide-y divide-slate-100">
              {results.map((r, i) => (
                <li key={i}>
                  {r.kind === "article" ? (
                    <Link href={r.href!} className="flex items-start gap-3 px-5 py-3 hover:bg-slate-50">
                      <div className="min-w-0 flex-1">
                        <div className="font-medium text-slate-900">{r.title}</div>
                        <div className="text-sm text-slate-500">{r.summary}</div>
                      </div>
                      <ArrowRight className="mt-1 size-4 shrink-0 text-slate-400" />
                    </Link>
                  ) : (
                    <details className="px-5 py-3">
                      <summary className="cursor-pointer font-medium text-slate-900">{r.title}</summary>
                      <p className="mt-2 whitespace-pre-line text-sm text-slate-600">{r.answer}</p>
                    </details>
                  )}
                </li>
              ))}
            </ul>
          ) : (
            <div className="px-5 py-4 text-sm text-slate-600">No articles match “{q.trim()}”.</div>
          )}
          <Link href={`${contactHref}?subject=${encodeURIComponent(q.trim().slice(0, 120))}`} className="flex items-center gap-2 border-t border-slate-100 px-5 py-3 text-sm font-medium text-brand-700 hover:bg-slate-50">
            <LifeBuoy className="size-4" /> Didn&apos;t find it? Ask our team
          </Link>
        </div>
      ) : null}
    </div>
  );
}
