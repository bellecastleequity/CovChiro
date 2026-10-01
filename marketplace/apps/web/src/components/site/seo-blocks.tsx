import Link from "next/link";
import { CalendarClock, ChevronRight, MapPin } from "lucide-react";
import { cityLabel, slugify } from "@cm/core";
import type { seo } from "@cm/services";
import { dateLabel, money, timeRange } from "@/lib/format";

/** Building blocks for the search landing pages (state, city, jobs). */

export function Breadcrumbs({ items }: { items: { name: string; path: string }[] }) {
  return (
    <nav aria-label="Breadcrumb" className="mb-6 text-sm text-slate-500">
      <ol className="flex flex-wrap items-center gap-1">
        {items.map((it, i) => (
          <li key={it.path} className="flex items-center gap-1">
            {i > 0 ? <ChevronRight className="size-3.5 text-slate-300" aria-hidden /> : null}
            {i === items.length - 1 ? <span aria-current="page" className="text-slate-700">{it.name}</span> : <Link href={it.path} className="hover:text-brand-700">{it.name}</Link>}
          </li>
        ))}
      </ol>
    </nav>
  );
}

export function CityLinks({ cities, base, title }: { cities: string[]; base: string; title: string }) {
  if (!cities.length) return null;
  return (
    <section className="mt-14">
      <h2 className="text-xl font-semibold">{title}</h2>
      <ul className="mt-4 grid grid-cols-2 gap-2 sm:grid-cols-3 lg:grid-cols-4">
        {cities.map((c) => (
          <li key={c}>
            <Link href={`${base}/${slugify(c)}`} className="flex items-center gap-1.5 rounded-lg border border-slate-200 px-3 py-2 text-sm text-slate-700 hover:border-brand-300 hover:text-brand-700">
              <MapPin className="size-3.5 shrink-0 text-accent-600" aria-hidden />
              {cityLabel(c)}
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}

export function FaqBlock({ qa, title = "Frequently asked questions" }: { qa: [string, string][]; title?: string }) {
  return (
    <section className="mt-14 max-w-3xl">
      <h2 className="text-xl font-semibold">{title}</h2>
      <div className="mt-4 divide-y divide-slate-200 rounded-2xl border border-slate-200">
        {qa.map(([q, a]) => (
          <details key={q} className="group p-5">
            <summary className="flex cursor-pointer list-none items-center justify-between gap-4 marker:hidden">
              <h3 className="text-base font-medium">{q}</h3>
              <span className="text-slate-400 transition group-open:rotate-45" aria-hidden>+</span>
            </summary>
            <p className="mt-3 text-sm text-slate-600">{a}</p>
          </details>
        ))}
      </div>
    </section>
  );
}

export function JobCard({ j }: { j: seo.PublicJob }) {
  return (
    <Link href={`/jobs/shift/${j.id}`} className="block rounded-2xl border border-slate-200 p-5 transition hover:border-brand-300 hover:shadow-card">
      <div className="flex items-start justify-between gap-3">
        <div>
          <div className="font-semibold text-slate-900">{j.professionName} · {cityLabel(j.city)}, {j.state}</div>
          <div className="mt-1 flex items-center gap-1.5 text-sm text-slate-600">
            <CalendarClock className="size-4 text-accent-600" aria-hidden />
            {dateLabel(j.startsAt, j.timeZone)} · {timeRange(j.startsAt, j.endsAt, j.timeZone)}
          </div>
        </div>
        <div className="text-right">
          <div className="text-lg font-semibold text-brand-700">{money(j.providerPayCents)}</div>
          <div className="text-xs text-slate-500">your pay{j.travelBudget ? " + mileage" : ""}</div>
        </div>
      </div>
      {j.urgent ? <div className="mt-2 inline-block rounded-full bg-amber-50 px-2 py-0.5 text-xs font-medium text-amber-800">Urgent cover</div> : null}
    </Link>
  );
}

export function Stats({ items }: { items: { label: string; value: string }[] }) {
  if (!items.length) return null;
  return (
    <dl className="mt-8 grid max-w-2xl grid-cols-1 gap-3 sm:grid-cols-3">
      {items.map((s) => (
        <div key={s.label} className="rounded-2xl border border-slate-200 p-4">
          <dt className="text-xs uppercase tracking-wide text-slate-500">{s.label}</dt>
          <dd className="mt-1 text-2xl font-semibold text-slate-900">{s.value}</dd>
        </div>
      ))}
    </dl>
  );
}
