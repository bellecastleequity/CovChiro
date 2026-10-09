"use client";

import { useEffect, useState } from "react";
import { Building2, CalendarDays, CalendarX2, Users } from "lucide-react";
import { coverageEstimate } from "@cm/core";
import type { CalcPrices } from "@/app/(public)/tools/cost-of-closing/calculator";
import { cn } from "@/lib/cn";

/**
 * Personal injury landing page calculators. Every coverage price comes from the live Light / Busy
 * full-day rate (core coverageEstimate, same rule as posting); every revenue figure is the clinic's
 * own number. Estimates before premiums, mileage and lodging, never a promise.
 */

const money = (n: number) => `${n < 0 ? "−" : ""}$${Math.abs(Math.round(n)).toLocaleString("en-US")}`;
const num = (s: string) => Math.max(0, parseFloat(s.replace(/[^0-9.]/g, "")) || 0);
const PER_VISIT_KEY = "cm.perVisit.calculator";
const WEEKS_PER_MONTH = 4.33;

type Tab = "missed" | "second" | "timeoff" | "turnover";
const TABS: { key: Tab; label: string; icon: typeof CalendarX2 }[] = [
  { key: "missed", label: "A missed day", icon: CalendarX2 },
  { key: "second", label: "Second location", icon: Building2 },
  { key: "timeoff", label: "Time off for your doctors", icon: CalendarDays },
  { key: "turnover", label: "Turnover gap", icon: Users },
];

function Slider({ id, label, value, min, max, step = 1, onChange, suffix, hint }: { id: string; label: string; value: number; min: number; max: number; step?: number; onChange: (n: number) => void; suffix?: string; hint?: string }) {
  return (
    <div>
      <div className="flex items-baseline justify-between gap-3 text-sm font-medium text-slate-700">
        <label htmlFor={id}>{label}</label>
        <span className="shrink-0 text-lg font-semibold tabular-nums text-slate-900">{value}{suffix ?? ""}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-2 w-full accent-brand-600" />
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

function MoneyInput({ id, label, value, onChange, hint, placeholder }: { id: string; label: string; value: string; onChange: (v: string) => void; hint?: string; placeholder?: string }) {
  return (
    <div>
      <label htmlFor={id} className="text-sm font-medium text-slate-700">{label}</label>
      <div className="relative mt-1.5">
        <span className="pointer-events-none absolute inset-y-0 left-3 flex items-center text-slate-400">$</span>
        <input id={id} inputMode="decimal" value={value} placeholder={placeholder} onChange={(e) => onChange(e.target.value.replace(/[^0-9.]/g, ""))} className="h-10 w-full rounded-lg border border-slate-300 bg-white pl-7 pr-3 text-sm focus:border-brand-500 focus:outline-none focus:ring-2 focus:ring-brand-200" />
      </div>
      {hint ? <div className="mt-1 text-xs text-slate-500">{hint}</div> : null}
    </div>
  );
}

/** Two horizontal bars: what's at stake vs what coverage costs. */
function CompareBars({ kept, cost, keptLabel, costLabel }: { kept: number; cost: number; keptLabel: string; costLabel: string }) {
  const max = Math.max(kept, cost, 1);
  return (
    <div className="space-y-3" aria-hidden="true">
      {[
        { label: keptLabel, value: kept, cls: "bg-accent-500" },
        { label: costLabel, value: cost, cls: "bg-brand-600" },
      ].map((b) => (
        <div key={b.label}>
          <div className="flex justify-between text-xs font-medium text-slate-600"><span>{b.label}</span><span className="tabular-nums">{money(b.value)}</span></div>
          <div className="mt-1 h-3 rounded-full bg-slate-100"><div className={cn("h-3 rounded-full transition-all", b.cls)} style={{ width: `${Math.max(2, (b.value / max) * 100)}%` }} /></div>
        </div>
      ))}
    </div>
  );
}

function Result({ items, note }: { items: { label: string; value: string; strong?: boolean }[]; note: string }) {
  return (
    <div>
      <dl className="grid grid-cols-2 gap-3">
        {items.map((i) => (
          <div key={i.label} className={cn("rounded-xl p-3", i.strong ? "bg-brand-600 text-white" : "bg-slate-50")}>
            <dt className={cn("text-xs", i.strong ? "text-brand-100" : "text-slate-500")}>{i.label}</dt>
            <dd className="mt-0.5 text-xl font-semibold tabular-nums">{i.value}</dd>
          </div>
        ))}
      </dl>
      <p className="mt-3 text-xs text-slate-500">{note}</p>
    </div>
  );
}

const NOTE = "An estimate from your own numbers and our current full-day rate, before weekend/holiday/short-notice premiums, mileage and lodging. Not a guarantee of results.";

export function PiCalculators({ prices }: { prices: CalcPrices | null }) {
  const [tab, setTab] = useState<Tab>("missed");
  const [group, setGroup] = useState(prices?.groups[0]?.tier ?? 1);
  const [perVisit, setPerVisit] = useState("");
  useEffect(() => {
    try { setPerVisit(localStorage.getItem(PER_VISIT_KEY) ?? ""); } catch {}
  }, []);
  const updatePerVisit = (v: string) => {
    setPerVisit(v);
    try { if (v) localStorage.setItem(PER_VISIT_KEY, v); else localStorage.removeItem(PER_VISIT_KEY); } catch {}
  };
  const g = prices?.groups.find((x) => x.tier === group) ?? prices?.groups[0];
  /** Coverage cost in dollars for `days` days at `visits` a day. */
  const coverage = (visits: number, days: number) =>
    g && prices ? coverageEstimate({ visitsPerDay: visits, days, lightCents: g.lightCents, busyCents: g.busyCents, lightCeiling: prices.lightCeiling, busyCeiling: prices.busyCeiling, graceVisits: prices.graceVisits, overagePerVisitCents: prices.overagePerVisitCents }).totalCents / 100 : 0;
  const pv = num(perVisit);

  return (
    <div className="rounded-3xl border border-slate-200 bg-white shadow-card">
      <div className="flex gap-1 overflow-x-auto border-b border-slate-100 p-2" role="tablist">
        {TABS.map((t) => (
          <button
            key={t.key}
            role="tab"
            aria-selected={tab === t.key}
            onClick={() => setTab(t.key)}
            className={cn("flex shrink-0 items-center gap-2 rounded-xl px-3.5 py-2 text-sm font-medium", tab === t.key ? "bg-brand-600 text-white" : "text-slate-600 hover:bg-slate-50")}
          >
            <t.icon className="size-4" />{t.label}
          </button>
        ))}
      </div>
      <div className="grid gap-4 border-b border-slate-100 p-5 sm:grid-cols-2">
        <MoneyInput id="pi-per-visit" label="Average collected per visit" value={perVisit} onChange={updatePerVisit} placeholder="e.g. 85" hint="From your own records. Remembered on this device only." />
        {prices && prices.groups.length > 1 ? (
          <div>
            <span className="text-sm font-medium text-slate-700">Where your clinic is</span>
            <div className="mt-1.5 flex gap-2">
              {prices.groups.map((x) => (
                <button key={x.tier} type="button" onClick={() => setGroup(x.tier)} className={cn("h-10 flex-1 rounded-lg border px-2 text-sm font-medium", group === x.tier ? "border-brand-600 bg-brand-50 text-brand-700" : "border-slate-300 text-slate-600")}>{x.label}</button>
              ))}
            </div>
          </div>
        ) : null}
      </div>
      <div className="p-5">
        {tab === "missed" ? <Missed pv={pv} coverage={coverage} /> : null}
        {tab === "second" ? <Second pv={pv} coverage={coverage} /> : null}
        {tab === "timeoff" ? <TimeOff pv={pv} coverage={coverage} /> : null}
        {tab === "turnover" ? <Turnover pv={pv} coverage={coverage} /> : null}
        {!pv ? <p className="mt-4 rounded-xl bg-amber-50 px-3 py-2 text-sm text-amber-900">Enter your average collected per visit above to see the comparison.</p> : null}
      </div>
    </div>
  );
}

type CalcProps = { pv: number; coverage: (visits: number, days: number) => number };

function Missed({ pv, coverage }: CalcProps) {
  const [visits, setVisits] = useState(30);
  const [days, setDays] = useState(2);
  const [newPts, setNewPts] = useState(2);
  const [caseValue, setCaseValue] = useState("");
  const cost = coverage(visits, days);
  const visitsKept = visits * days * pv;
  const newKept = newPts * days * num(caseValue);
  const kept = visitsKept + newKept;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-5">
        <Slider id="m-visits" label="Patients on the schedule each day" value={visits} min={5} max={60} onChange={setVisits} />
        <Slider id="m-days" label="Days the doctor is out" value={days} min={1} max={10} onChange={setDays} />
        <Slider id="m-new" label="New injury patients you'd see each of those days" value={newPts} min={0} max={10} onChange={setNewPts} hint="Accident patients often can't wait for you to come back; they go to the next office that can see them." />
        <MoneyInput id="m-case" label="What a new patient is worth to you (optional)" value={caseValue} onChange={setCaseValue} placeholder="your own estimate" hint="Your own average for a full course of care. Leave blank to count scheduled visits only." />
      </div>
      <div className="space-y-5">
        <CompareBars kept={kept} cost={cost} keptLabel="Visits and new patients kept open" costLabel="Coverage" />
        <Result
          items={[
            { label: "Scheduled visits kept", value: money(visitsKept) },
            { label: "New patients not turned away", value: newKept ? money(newKept) : `${newPts * days} patients` },
            { label: "Coverage estimate", value: money(cost) },
            { label: "Kept open, after coverage", value: money(kept - cost), strong: true },
          ]}
          note={NOTE}
        />
      </div>
    </div>
  );
}

const WEEKDAYS = ["Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function Second({ pv, coverage }: CalcProps) {
  const [open, setOpen] = useState(5);
  const [mine, setMine] = useState(2);
  const [visits, setVisits] = useState(20);
  const you = Math.min(mine, open);
  const covered = open - you;
  const monthlyDays = covered * WEEKS_PER_MONTH;
  const cost = coverage(visits, 1) * monthlyDays;
  const kept = visits * pv * monthlyDays;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-5">
        <Slider id="s-open" label="Days a week the new location is open" value={open} min={1} max={6} onChange={setOpen} />
        <Slider id="s-mine" label="Days you can be there yourself" value={you} min={0} max={open} onChange={setMine} />
        <Slider id="s-visits" label="Patients a day at the new location" value={visits} min={5} max={50} onChange={setVisits} />
        <div>
          <div className="text-sm font-medium text-slate-700">Your week at the new location</div>
          <div className="mt-2 grid grid-cols-6 gap-1.5">
            {WEEKDAYS.map((d, i) => (
              <div key={d} className={cn("rounded-lg py-2 text-center text-xs font-semibold", i >= open ? "bg-slate-100 text-slate-400" : i < you ? "bg-brand-600 text-white" : "bg-accent-500 text-brand-900")}>
                {d}
                <div className="mt-0.5 text-[10px] font-medium opacity-80">{i >= open ? "closed" : i < you ? "you" : "covered"}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-5">
        <CompareBars kept={kept} cost={cost} keptLabel="Covered days' visits each month" costLabel="Coverage each month" />
        <Result
          items={[
            { label: "Days open a month", value: `${Math.round(open * WEEKS_PER_MONTH)}` },
            { label: "Covered by a doctor from us", value: `${Math.round(monthlyDays)}` },
            { label: "Coverage estimate / month", value: money(cost) },
            { label: "Kept open, after coverage", value: money(kept - cost), strong: true },
          ]}
          note={`${NOTE} Book the same doctor every week with a standing booking.`}
        />
      </div>
    </div>
  );
}

function TimeOff({ pv, coverage }: CalcProps) {
  const [doctors, setDoctors] = useState(2);
  const [vacation, setVacation] = useState(10);
  const [ce, setCe] = useState(3);
  const [visits, setVisits] = useState(30);
  const days = doctors * (vacation + ce);
  const cost = coverage(visits, days);
  const kept = visits * pv * days;
  const weeks = Math.min(52, Math.ceil(days / 5));
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-5">
        <Slider id="t-docs" label="Doctors at your practice" value={doctors} min={1} max={10} onChange={setDoctors} />
        <Slider id="t-vac" label="Vacation days per doctor a year" value={vacation} min={0} max={30} onChange={setVacation} />
        <Slider id="t-ce" label="CE / seminar days per doctor a year" value={ce} min={0} max={10} onChange={setCe} />
        <Slider id="t-visits" label="Patients a doctor sees a day" value={visits} min={5} max={60} onChange={setVisits} />
        <div>
          <div className="text-sm font-medium text-slate-700">A year of covered time off ({days} days)</div>
          <div className="mt-2 grid gap-1" style={{ gridTemplateColumns: "repeat(26, minmax(0, 1fr))" }} aria-hidden="true">
            {Array.from({ length: 52 }, (_, i) => (
              // `weeks` covered weeks spread evenly across the year
              <div key={i} className={cn("h-3 rounded-sm", Math.floor(((i + 1) * weeks) / 52) > Math.floor((i * weeks) / 52) ? "bg-accent-500" : "bg-slate-100")} />
            ))}
          </div>
          <div className="mt-1 text-xs text-slate-500">About {weeks} week{weeks === 1 ? "" : "s"} of coverage across the year, without closing.</div>
        </div>
      </div>
      <div className="space-y-5">
        <CompareBars kept={kept} cost={cost} keptLabel="Visits kept open in a year" costLabel="Coverage in a year" />
        <Result
          items={[
            { label: "Days covered a year", value: `${days}` },
            { label: "Coverage estimate / year", value: money(cost) },
            { label: "Visits kept open / year", value: money(kept) },
            { label: "Kept open, after coverage", value: money(kept - cost), strong: true },
          ]}
          note={`${NOTE} Rested doctors stay longer: time off without closing is a retention tool.`}
        />
      </div>
    </div>
  );
}

function Turnover({ pv, coverage }: CalcProps) {
  const [weeks, setWeeks] = useState(10);
  const [daysPerWeek, setDaysPerWeek] = useState(5);
  const [visits, setVisits] = useState(30);
  const days = weeks * daysPerWeek;
  const cost = coverage(visits, days);
  const kept = visits * pv * days;
  return (
    <div className="grid gap-6 lg:grid-cols-2">
      <div className="space-y-5">
        <Slider id="v-weeks" label="Weeks to hire and onboard a replacement" value={weeks} min={2} max={26} onChange={setWeeks} />
        <Slider id="v-days" label="Days a week the departing doctor worked" value={daysPerWeek} min={1} max={6} onChange={setDaysPerWeek} />
        <Slider id="v-visits" label="Their patients a day" value={visits} min={5} max={60} onChange={setVisits} />
        <div aria-hidden="true">
          <div className="text-sm font-medium text-slate-700">The gap, bridged</div>
          <div className="relative mt-3 h-14">
            <div className="absolute inset-x-0 top-3 h-2 rounded-full bg-slate-100" />
            <div className="absolute left-[8%] right-[8%] top-3 h-2 rounded-full bg-accent-500" />
            {[
              { x: "0%", t: "Notice given" },
              { x: "50%", t: `${weeks} weeks of coverage` },
              { x: "100%", t: "New hire starts" },
            ].map((p, i) => (
              <div key={p.t} className="absolute top-0 -translate-x-1/2 text-center" style={{ left: p.x === "0%" ? "8%" : p.x === "100%" ? "92%" : "50%" }}>
                <div className={cn("mx-auto size-8 rounded-full border-4 border-white shadow", i === 1 ? "bg-accent-500" : "bg-brand-600")} />
                <div className="mt-1 whitespace-nowrap text-[11px] font-medium text-slate-600">{p.t}</div>
              </div>
            ))}
          </div>
        </div>
      </div>
      <div className="space-y-5">
        <CompareBars kept={kept} cost={cost} keptLabel="That doctor's visits kept open" costLabel="Coverage for the gap" />
        <Result
          items={[
            { label: "Days to cover", value: `${days}` },
            { label: "Coverage estimate", value: money(cost) },
            { label: "Visits kept open", value: money(kept) },
            { label: "Kept open, after coverage", value: money(kept - cost), strong: true },
          ]}
          note={`${NOTE} Like a covering doctor? You can ask to hire them through us.`}
        />
      </div>
    </div>
  );
}
