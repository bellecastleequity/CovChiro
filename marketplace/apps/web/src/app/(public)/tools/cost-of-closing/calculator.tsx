"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarCheck, DoorClosed, DoorOpen, HeartHandshake, Users } from "lucide-react";
import { closingComparison } from "@cm/core";
import { Field, Input } from "@/components/ui/form";
import { trackProspect } from "@/components/site/analytics";

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const num = (s: string) => Math.max(0, parseFloat(s) || 0);

/**
 * Cost of closing vs. staying open with coverage, on the clinic's own numbers (core closingComparison).
 * Coverage defaults to our current full-day price × days (editable). A comparison, not a promise.
 */
export function CostOfClosing({ prices }: { prices: { low: number; high: number; typical: number } | null }) {
  const search = useSearchParams();
  const [daily, setDaily] = useState("");
  const [days, setDays] = useState("2");
  const [cost, setCost] = useState("");
  const [costEdited, setCostEdited] = useState(false);
  const [recovered, setRecovered] = useState("0");
  const tracked = useRef(false);
  const d = num(daily);
  const n = Math.min(60, num(days));
  // Until they type their own quote, coverage follows days × our typical full-day price.
  const estimate = prices ? Math.round(prices.typical * n) : 0;
  const c = costEdited ? num(cost) : estimate;
  const r = closingComparison({ dailyCollections: d, days: n, coverageCost: c, recoveredPercent: num(recovered) });
  const ready = d > 0 && n > 0 && c > 0;

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
        <Field label="Average daily collections" htmlFor="daily" hint="What a typical open day brings in. Use your own records.">
          <Input id="daily" inputMode="decimal" placeholder="e.g. 2500" value={daily} onChange={(e) => setDaily(e.target.value.replace(/[^0-9.]/g, ""))} />
        </Field>
        <Field label="Days you'll be away" htmlFor="days">
          <Input id="days" inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9.]/g, ""))} />
        </Field>
        <Field
          label="Coverage cost (total)"
          htmlFor="cost"
          hint={prices ? (costEdited ? "Your figure." : `Estimated at $${Math.round(prices.typical).toLocaleString("en-US")} per full day (our current rates run $${Math.round(prices.low).toLocaleString("en-US")}–$${Math.round(prices.high).toLocaleString("en-US")}, before weekend, holiday or short-notice premiums and mileage). Type your quote to replace it.`) : "Get an exact quote by starting a coverage request."}
        >
          <Input id="cost" inputMode="decimal" placeholder="Your quote" value={costEdited ? cost : estimate ? String(estimate) : ""} onChange={(e) => (setCostEdited(true), setCost(e.target.value.replace(/[^0-9.]/g, "")))} />
        </Field>
        <Field label="Visits you'd get back by rescheduling (%)" htmlFor="recovered" hint="If you close, some patients rebook for later. Leave at 0 if they'd mostly be lost or go elsewhere.">
          <div className="flex items-center gap-3">
            <input id="recovered" type="range" min={0} max={100} step={5} value={num(recovered)} onChange={(e) => setRecovered(e.target.value)} className="flex-1 accent-brand-600" />
            <span className="w-12 text-right text-sm font-semibold tabular-nums">{num(recovered)}%</span>
          </div>
        </Field>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2" aria-live="polite">
        <div className="rounded-xl border border-red-100 bg-red-50/60 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-800"><DoorClosed className="size-4" /> If you close</div>
          <div className="mt-2 text-xs text-slate-600">Collections not brought in</div>
          <div className="text-2xl font-semibold tabular-nums text-red-800">{d && n ? money(r.closingCost) : "—"}</div>
          {r.recovered > 0 ? <div className="mt-1 text-xs text-slate-500">after {money(r.recovered)} back from rescheduled visits</div> : null}
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800"><DoorOpen className="size-4" /> If you stay open</div>
          <div className="mt-2 text-xs text-slate-600">Collections after paying for coverage</div>
          <div className="text-2xl font-semibold tabular-nums text-emerald-800">{ready ? money(r.openAfterCoverage) : "—"}</div>
          {ready ? <div className="mt-1 text-xs text-slate-500">{money(r.atStake)} in collections − {money(c)} coverage</div> : null}
        </div>
      </div>

      {ready ? (
        <div className={`mt-3 rounded-xl p-4 ${r.difference > 0 ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-800"}`}>
          {r.difference > 0 ? (
            <>
              <div className="text-sm text-brand-100">With your numbers, staying open keeps</div>
              <div className="text-3xl font-semibold tabular-nums">{money(r.difference)} more</div>
              <div className="mt-1 text-sm text-brand-100">than closing for {n} day{n === 1 ? "" : "s"}. Coverage is {Math.round((r.coverageShare ?? 0) * 100)}% of what those days normally bring in.</div>
            </>
          ) : (
            <>
              <div className="text-sm">With these numbers, closing comes out about {money(-r.difference)} ahead on collections alone.</div>
              <div className="mt-1 text-xs text-slate-600">Patient continuity and your team&apos;s hours below may still matter more to you.</div>
            </>
          )}
          {r.breakEvenDaily != null ? (
            <div className={`mt-3 border-t pt-3 text-sm ${r.difference > 0 ? "border-white/20 text-white" : "border-slate-200"}`}>
              <b>Break-even:</b> coverage pays for itself on days that bring in at least <b>{money(r.breakEvenDaily)}</b>.
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Enter your average daily collections to see the comparison.</p>
      )}

      <div className="mt-5">
        <div className="text-sm font-semibold text-slate-900">What staying open keeps that numbers don&apos;t show</div>
        <ul className="mt-2 space-y-1.5 text-sm text-slate-700">
          <li className="flex gap-2"><HeartHandshake className="mt-0.5 size-4 shrink-0 text-accent-600" />Patients keep their visits and their care plans stay on track.</li>
          <li className="flex gap-2"><Users className="mt-0.5 size-4 shrink-0 text-accent-600" />Your team keeps its hours instead of a week of reschedule calls.</li>
          <li className="flex gap-2"><CalendarCheck className="mt-0.5 size-4 shrink-0 text-accent-600" />New patients find you open, not a closed sign.</li>
        </ul>
      </div>

      <div className="mt-5 flex flex-wrap items-center gap-3">
        <Link href="/signup?role=clinic" className="rounded-xl bg-brand-600 px-4 py-2.5 text-sm font-semibold text-white hover:bg-brand-700">Get an exact quote</Link>
        <Link href="/for-clinics" className="text-sm font-medium text-brand-700 hover:underline">See pricing</Link>
      </div>

      <p className="mt-5 text-xs text-slate-500">
        Based only on the numbers you enter; past or typical collections don&apos;t guarantee future ones. Costs that continue either way (rent, salaries, utilities) are left out because they&apos;re the same whether you close or stay open.
      </p>
    </div>
  );
}
