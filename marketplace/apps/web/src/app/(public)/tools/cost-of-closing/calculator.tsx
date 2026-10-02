"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";
import { CalendarCheck, DoorClosed, DoorOpen, HeartHandshake, Scale, Users } from "lucide-react";
import { closingComparison, coverageEstimate } from "@cm/core";
import { Field, Input } from "@/components/ui/form";
import { trackProspect } from "@/components/site/analytics";
import { cn } from "@/lib/cn";

export type CalcPrices = {
  groups: { tier: number; label: string; lightCents: number; busyCents: number }[];
  lightCeiling: number;
  busyCeiling: number;
  graceVisits: number;
  overagePerVisitCents: number;
};

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const num = (s: string) => Math.max(0, parseFloat(s) || 0);
const PER_VISIT_KEY = "cm.perVisit.calculator";

/**
 * Cost of closing vs. staying open with coverage, on the clinic's own numbers. Same inputs as the
 * post-a-shift panel (patients a day × average collected per visit), with coverage priced from the
 * live Light / Busy rate for the visit count (core coverageEstimate). A comparison, not a promise.
 */
export function CostOfClosing({ prices }: { prices: CalcPrices | null }) {
  const search = useSearchParams();
  const [visits, setVisits] = useState(20);
  const [perVisit, setPerVisit] = useState("");
  const [days, setDays] = useState("2");
  const [group, setGroup] = useState(prices?.groups[0]?.tier ?? 1);
  const [recovered, setRecovered] = useState(0);
  const [ownQuote, setOwnQuote] = useState("");
  const tracked = useRef(false);

  useEffect(() => {
    try { setPerVisit(localStorage.getItem(PER_VISIT_KEY) ?? ""); } catch {}
  }, []);
  const updatePerVisit = (v: string) => {
    const clean = v.replace(/[^0-9.]/g, "");
    setPerVisit(clean);
    try { if (clean) localStorage.setItem(PER_VISIT_KEY, clean); else localStorage.removeItem(PER_VISIT_KEY); } catch {}
  };

  const pv = num(perVisit);
  const n = Math.min(60, num(days));
  const g = prices?.groups.find((x) => x.tier === group) ?? prices?.groups[0];
  const est = g && prices ? coverageEstimate({ visitsPerDay: visits, days: n, lightCents: g.lightCents, busyCents: g.busyCents, lightCeiling: prices.lightCeiling, busyCeiling: prices.busyCeiling, graceVisits: prices.graceVisits, overagePerVisitCents: prices.overagePerVisitCents }) : null;
  const coverage = ownQuote ? num(ownQuote) : (est?.totalCents ?? 0) / 100;
  const r = closingComparison({ dailyCollections: visits * pv, days: n, coverageCost: coverage, recoveredPercent: recovered });
  const ready = visits > 0 && pv > 0 && n > 0 && coverage > 0;
  const breakEvenVisits = r.breakEvenDaily != null && pv > 0 ? Math.ceil(r.breakEvenDaily / pv) : null;

  useEffect(() => {
    const token = search.get("c");
    if (!tracked.current && pv > 0 && n > 0 && token && /^[a-f0-9]{40}$/.test(token)) {
      tracked.current = true;
      trackProspect(token, "calculator_used", n);
    }
  }, [pv, n, search]);

  return (
    <div className="rounded-2xl border border-slate-200 p-6 shadow-card">
      <div className="space-y-5">
        <div>
          <div className="flex items-baseline justify-between text-sm font-medium text-slate-700">
            <label htmlFor="visits">Patients the covering doctor would see each day</label>
            <span className="text-lg font-semibold tabular-nums text-slate-900">{visits}</span>
          </div>
          <input id="visits" type="range" min={1} max={60} step={1} value={visits} onChange={(e) => setVisits(Number(e.target.value))} className="mt-2 w-full accent-brand-600" />
          {prices ? <div className="mt-1 text-xs text-slate-500">{visits <= prices.lightCeiling ? `Light day (up to ${prices.lightCeiling} visits)` : `Busy day (up to ${prices.busyCeiling} visits${est?.extraVisitsPerDay ? `, plus ${est.extraVisitsPerDay} extra` : ""})`}</div> : null}
        </div>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Average collected per visit ($)" htmlFor="perVisit" hint="From your own records. Remembered on this device only.">
            <Input id="perVisit" inputMode="decimal" placeholder="e.g. 65" value={perVisit} onChange={(e) => updatePerVisit(e.target.value)} />
          </Field>
          <Field label="Days you'll be away" htmlFor="days">
            <Input id="days" inputMode="decimal" value={days} onChange={(e) => setDays(e.target.value.replace(/[^0-9.]/g, ""))} />
          </Field>
        </div>
        {prices && prices.groups.length > 1 ? (
          <div>
            <div className="text-sm font-medium text-slate-700">Where is your office?</div>
            <div className="mt-2 flex flex-wrap gap-2">
              {prices.groups.map((x) => (
                <button key={x.tier} type="button" onClick={() => setGroup(x.tier)} className={cn("rounded-full px-3 py-1.5 text-sm font-medium ring-1", group === x.tier ? "bg-brand-600 text-white ring-brand-600" : "bg-white text-slate-700 ring-slate-200 hover:ring-brand-300")}>
                  {x.label}
                </button>
              ))}
            </div>
          </div>
        ) : null}
        <div>
          <div className="flex items-baseline justify-between text-sm font-medium text-slate-700">
            <label htmlFor="recovered">Visits you&apos;d get back by rescheduling</label>
            <span className="tabular-nums">{recovered}%</span>
          </div>
          <input id="recovered" type="range" min={0} max={100} step={5} value={recovered} onChange={(e) => setRecovered(Number(e.target.value))} className="mt-2 w-full accent-brand-600" />
          <div className="mt-1 text-xs text-slate-500">If you close, some patients rebook for later. Leave at 0 if they&apos;d mostly be lost or go elsewhere.</div>
        </div>
        <div className="rounded-xl bg-slate-50 p-3 text-sm text-slate-700">
          {est && !ownQuote ? (
            <>Coverage: <b>{money(est.perDayCents / 100)}</b> a day × {n} day{n === 1 ? "" : "s"} = <b>{money(est.totalCents / 100)}</b>{est.extraVisitsPerDay ? <span className="text-slate-500"> (includes {est.extraVisitsPerDay} extra visits a day)</span> : null}. <span className="text-slate-500">Before weekend, holiday or short-notice premiums and mileage.</span></>
          ) : !prices ? (
            <>Get an exact price by starting a coverage request.</>
          ) : null}
          <div className={cn(est && !ownQuote ? "mt-2" : "")}>
            <label className="text-xs text-slate-500">
              Have a quote already?{" "}
              <input inputMode="decimal" value={ownQuote} onChange={(e) => setOwnQuote(e.target.value.replace(/[^0-9.]/g, ""))} placeholder="Total $" className="ml-1 w-24 rounded-lg border border-slate-300 px-2 py-1 text-xs" />
            </label>
          </div>
        </div>
      </div>

      <div className="mt-6 grid gap-3 sm:grid-cols-2" aria-live="polite">
        <div className="rounded-xl border border-red-100 bg-red-50/60 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-red-800"><DoorClosed className="size-4" /> If you close</div>
          <div className="mt-2 text-xs text-slate-600">Collections not brought in</div>
          <div className="text-2xl font-semibold tabular-nums text-red-800">{pv && n ? money(r.closingCost) : "—"}</div>
          {r.recovered > 0 ? <div className="mt-1 text-xs text-slate-500">after {money(r.recovered)} back from rescheduled visits</div> : null}
        </div>
        <div className="rounded-xl border border-emerald-100 bg-emerald-50/60 p-4">
          <div className="flex items-center gap-2 text-sm font-semibold text-emerald-800"><DoorOpen className="size-4" /> If you stay open</div>
          <div className="mt-2 text-xs text-slate-600">Collections after paying for coverage</div>
          <div className="text-2xl font-semibold tabular-nums text-emerald-800">{ready ? money(r.openAfterCoverage) : "—"}</div>
          {ready ? <div className="mt-1 text-xs text-slate-500">{money(r.atStake)} in collections − {money(coverage)} coverage</div> : null}
        </div>
      </div>

      {ready ? (
        <div className={`mt-3 rounded-xl p-4 ${r.difference > 0 ? "bg-brand-600 text-white" : "bg-slate-100 text-slate-800"}`}>
          {r.difference > 0 ? (
            <>
              <div className="text-sm text-brand-100">With your numbers, staying open keeps</div>
              <div className="text-3xl font-semibold tabular-nums">{money(r.difference)} more</div>
              <div className="mt-1 text-sm text-brand-100">{visits} patients × {money(pv)} × {n} day{n === 1 ? "" : "s"} = {money(r.atStake)}; coverage {money(coverage)}.</div>
            </>
          ) : (
            <>
              <div className="text-sm">With these numbers, closing comes out about {money(-r.difference)} ahead on collections alone.</div>
              <div className="mt-1 text-xs text-slate-600">Patient continuity and your team&apos;s hours below may still matter more to you.</div>
            </>
          )}
          {breakEvenVisits != null ? (
            <div className={`mt-3 border-t pt-3 text-sm ${r.difference > 0 ? "border-white/20 text-white" : "border-slate-200"}`}>
              <Scale className="mr-1 inline size-4" /><b>Break-even:</b> about <b>{breakEvenVisits} visits a day</b> pays for the coverage.
            </div>
          ) : null}
        </div>
      ) : (
        <p className="mt-3 rounded-xl bg-slate-50 p-4 text-sm text-slate-600">Add your average collected per visit to see the comparison.</p>
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
