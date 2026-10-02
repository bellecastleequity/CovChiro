"use client";

import { useEffect, useState } from "react";
import { ChevronDown, DoorClosed, DoorOpen, Scale } from "lucide-react";
import { closingComparison } from "@cm/core";
import { cn } from "@/lib/cn";

const dollars = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const num = (s: string) => Math.max(0, parseFloat(s) || 0);
const storeKey = (locationId: string) => `cm.perVisit.${locationId}`;

/** Average collected per visit, remembered per location in this browser only (nothing is stored on our side). */
export function usePerVisit(locationId: string) {
  const [perVisit, setPerVisit] = useState("");
  useEffect(() => {
    try {
      setPerVisit(localStorage.getItem(storeKey(locationId)) ?? "");
    } catch {
      setPerVisit("");
    }
  }, [locationId]);
  const update = (v: string) => {
    const clean = v.replace(/[^0-9.]/g, "");
    setPerVisit(clean);
    try {
      if (clean) localStorage.setItem(storeKey(locationId), clean);
      else localStorage.removeItem(storeKey(locationId));
    } catch {}
  };
  return [perVisit, update] as const;
}

/**
 * "Cost of closing" next to the post-a-shift form: expected visits (from the form) × the clinic's
 * own average collected per visit, against this booking's coverage price. Same math as the public
 * calculator (core closingComparison). A comparison of their own numbers, never a promise.
 */
export function ClosingPanel({
  visits,
  days,
  coverageCents,
  perVisit,
  onPerVisit,
  collapsible = false,
}: {
  visits: number | null;
  days: number;
  coverageCents: number | null;
  perVisit: string;
  onPerVisit: (v: string) => void;
  collapsible?: boolean;
}) {
  const [recovered, setRecovered] = useState(0);
  const [open, setOpen] = useState(!collapsible);
  const pv = num(perVisit);
  const n = Math.max(1, days);
  const coverage = (coverageCents ?? 0) / 100;
  const daily = (visits ?? 0) * pv;
  const r = closingComparison({ dailyCollections: daily, days: n, coverageCost: coverage, recoveredPercent: recovered });
  const ready = !!visits && pv > 0 && coverage > 0;
  const breakEvenVisits = r.breakEvenDaily != null && pv > 0 ? Math.ceil(r.breakEvenDaily / pv) : null;

  const body = (
    <div className="space-y-3 text-sm">
      <label className="block">
        <span className="text-xs font-medium text-slate-600">Average collected per visit ($)</span>
        <input
          inputMode="decimal"
          value={perVisit}
          onChange={(e) => onPerVisit(e.target.value)}
          placeholder="e.g. 65"
          className="mt-1 block w-full rounded-xl border border-slate-300 bg-white px-3 py-2 text-sm focus:border-brand-500 focus:outline-none"
        />
        <span className="mt-1 block text-[11px] text-slate-500">From your own records. Remembered on this device only.</span>
      </label>
      <label className="block">
        <span className="flex justify-between text-xs font-medium text-slate-600"><span>Visits you&apos;d get back by rescheduling</span><span className="tabular-nums">{recovered}%</span></span>
        <input type="range" min={0} max={100} step={5} value={recovered} onChange={(e) => setRecovered(Number(e.target.value))} className="mt-1 w-full accent-brand-600" />
      </label>

      {!visits ? (
        <p className="rounded-xl bg-slate-50 p-3 text-slate-600">Enter the patients the covering provider will see to compare closing with staying open.</p>
      ) : !pv ? (
        <p className="rounded-xl bg-slate-50 p-3 text-slate-600">Add your average collected per visit to see the comparison.</p>
      ) : !coverage ? (
        <p className="rounded-xl bg-slate-50 p-3 text-slate-600">Waiting for the price…</p>
      ) : null}

      {visits && pv ? (
        <div className="grid grid-cols-2 gap-2" aria-live="polite">
          <div className="rounded-xl border border-red-100 bg-red-50/60 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-red-800"><DoorClosed className="size-3.5" /> If you close</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-red-800">{dollars(r.closingCost)}</div>
            <div className="text-[11px] text-slate-500">not brought in</div>
          </div>
          <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-3">
            <div className="flex items-center gap-1.5 text-xs font-semibold text-emerald-800"><DoorOpen className="size-3.5" /> If you stay open</div>
            <div className="mt-1 text-lg font-semibold tabular-nums text-emerald-800">{ready ? dollars(r.openAfterCoverage) : "—"}</div>
            <div className="text-[11px] text-slate-500">kept after coverage</div>
          </div>
        </div>
      ) : null}

      {ready ? (
        <div className={cn("rounded-xl p-3", r.difference > 0 ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-800")}>
          {r.difference > 0 ? (
            <>
              <div className="text-xs text-brand-100">Staying open keeps</div>
              <div className="text-2xl font-semibold tabular-nums">{dollars(r.difference)} more</div>
              <div className="text-xs text-brand-100">
                {visits} patients × {dollars(pv)} × {n} day{n === 1 ? "" : "s"} = {dollars(r.atStake)}; coverage {dollars(coverage)}.
              </div>
            </>
          ) : (
            <div className="text-sm">With these numbers, closing comes out about {dollars(-r.difference)} ahead on collections alone.</div>
          )}
          {breakEvenVisits != null ? (
            <div className={cn("mt-2 border-t pt-2 text-xs", r.difference > 0 ? "border-white/20" : "border-slate-200")}>
              <Scale className="mr-1 inline size-3.5" />Break-even: about <b>{breakEvenVisits} visits a day</b> pays for the coverage.
            </div>
          ) : null}
        </div>
      ) : null}
      <p className="text-[11px] leading-snug text-slate-500">Your own numbers only; past collections don&apos;t guarantee future ones. Coverage price shown before mileage and any extra visits.</p>
    </div>
  );

  return (
    <div className="rounded-2xl border border-slate-200 bg-white shadow-card">
      <button
        type="button"
        onClick={() => collapsible && setOpen((o) => !o)}
        className={cn("flex w-full items-center justify-between gap-2 px-5 py-4 text-left", !collapsible && "cursor-default")}
        aria-expanded={open}
      >
        <span>
          <span className="block font-semibold text-slate-900">Cost of closing</span>
          {ready && !open ? <span className="text-xs text-slate-500">Staying open keeps {dollars(r.difference)} {r.difference >= 0 ? "more" : "less"}</span> : <span className="text-xs text-slate-500">Lose this provider&apos;s patients, or keep them with coverage?</span>}
        </span>
        {collapsible ? <ChevronDown className={cn("size-4 shrink-0 text-slate-400 transition-transform", open && "rotate-180")} /> : null}
      </button>
      {open ? <div className="border-t border-slate-100 px-5 py-4">{body}</div> : null}
    </div>
  );
}
