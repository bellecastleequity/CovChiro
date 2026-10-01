"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { Field, Input } from "@/components/ui/form";
import { trackProspect } from "@/components/site/analytics";

const money = (n: number) => `$${Math.round(n).toLocaleString("en-US")}`;

/**
 * Educational comparison only (spec §9): normal collections associated with
 * the days away vs. an estimated coverage cost. No ROI, profit or savings.
 */
export function CostOfClosing() {
  const search = useSearchParams();
  const [daily, setDaily] = useState("");
  const [days, setDays] = useState("2");
  const [cost, setCost] = useState("");
  const tracked = useRef(false);
  const d = Math.max(0, parseFloat(daily) || 0);
  const n = Math.max(0, Math.min(60, parseFloat(days) || 0));
  const c = Math.max(0, parseFloat(cost) || 0);
  useEffect(() => {
    const token = search.get("c");
    if (!tracked.current && d > 0 && n > 0 && token && /^[a-f0-9]{40}$/.test(token)) {
      tracked.current = true;
      trackProspect(token, "calculator_used", n);
    }
  }, [d, n, search]);
  return (
    <div className="rounded-2xl border border-slate-200 p-6 shadow-card">
      <div className="space-y-4">
        <Field label="Average daily collections" htmlFor="daily" hint="What a typical open day has brought in. Use your own records.">
          <Input id="daily" inputMode="decimal" placeholder="e.g. 2500" value={daily} onChange={(e) => setDaily(e.target.value.replace(/[^0-9.]/g, ""))} />
        </Field>
        <Field label="Number of days away" htmlFor="days">
          <Input id="days" inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9.]/g, ""))} />
        </Field>
        <Field label="Expected coverage cost (total)" htmlFor="cost" hint="Get an exact quote by starting a coverage request. Prices depend on region and shift length.">
          <Input id="cost" inputMode="decimal" placeholder="Your quote" value={cost} onChange={(e) => setCost(e.target.value.replace(/[^0-9.]/g, ""))} />
        </Field>
      </div>
      <dl className="mt-6 space-y-3" aria-live="polite">
        <div className="flex items-baseline justify-between gap-4 rounded-xl bg-slate-50 px-4 py-3">
          <dt className="text-sm text-slate-600">Normal collections associated with those days</dt>
          <dd className="text-2xl font-semibold tabular-nums">{d && n ? money(d * n) : "—"}</dd>
        </div>
        <div className="flex items-baseline justify-between gap-4 rounded-xl bg-brand-50 px-4 py-3">
          <dt className="text-sm text-brand-800">Estimated coverage cost</dt>
          <dd className="text-2xl font-semibold tabular-nums text-brand-800">{c ? money(c) : "—"}</dd>
        </div>
      </dl>
      <p className="mt-4 rounded-xl border-l-4 border-amber-400 bg-amber-50 px-4 py-3 text-xs text-amber-900">
        <strong>An educational comparison, not a guarantee.</strong> Historical or typical collections don&apos;t guarantee future collections. Actual results depend on your schedule, patient attendance, payer mix and other factors. This tool doesn&apos;t estimate profit, savings or return on investment.
      </p>
    </div>
  );
}
