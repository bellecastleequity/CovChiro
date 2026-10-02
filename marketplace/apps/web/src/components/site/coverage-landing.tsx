import Link from "next/link";
import { Check, MapPin } from "lucide-react";
import { breadcrumbLd, citiesByRateGroup, faqLd, serviceLd, type ServiceArea, type StateAreas } from "@cm/core";
import { brand } from "@cm/config";
import type { SettingsMap } from "@cm/config";
import { LinkButton } from "@/components/ui/button";
import { JsonLd } from "@/components/site/json-ld";
import { money } from "@/lib/format";
import { priceRange, serviceWord, siteUrl, type RateGroup } from "@/lib/seo";

type Prof = { code: string; displayName: string; slug: string; credentialSuffix: string; volumePricingEnabled: boolean };

const DUR: Record<string, string> = { HALF_DAY: "Half day", FULL_DAY: "Full day", HOURLY: "Per hour" };

/** Rows for a rate group: half/full × light/busy, sorted. */
function rows(g: RateGroup, s: SettingsMap) {
  const visits = (dur: string, vt: string | null) =>
    vt ? s[`pricing.volume${vt === "LIGHT" ? "Light" : "Busy"}Visits${dur === "HALF_DAY" ? "HalfDay" : "FullDay"}` as "pricing.volumeLightVisitsFullDay"] : null;
  return [...g.cards]
    .sort((a, b) => (a.durationTier === b.durationTier ? (a.volumeTier === "BUSY" ? 1 : -1) : a.durationTier === "HALF_DAY" ? -1 : 1))
    .map((c) => ({ key: `${c.durationTier}:${c.volumeTier}`, label: `${DUR[c.durationTier] ?? c.durationTier}${c.volumeTier ? ` · ${c.volumeTier === "LIGHT" ? "Light" : "Busy"} (up to ${visits(c.durationTier, c.volumeTier)} visits)` : ""}`, cents: c.clinicPriceCents }));
}

export function landingFaq(p: Prof, st: StateAreas, s: SettingsMap, where: string): [string, string][] {
  const noun = p.displayName.toLowerCase();
  return [
    [`How fast can I get a ${noun} to cover my practice in ${where}?`, `Post the day and hours and we start matching right away with licensed ${noun}s who work in your area. Many requests are filled the same day; planned coverage (vacations, conferences) is best posted a week or more ahead.`],
    [`Is every covering ${noun} licensed in ${st.name}?`, `Yes. Before they can apply or be offered a shift, each ${p.credentialSuffix}'s ${st.name} license is verified, along with malpractice coverage at or above ${st.name}'s limits. Licenses are re-checked when you book and again before each shift.`],
    [`What does ${serviceWord(p.slug).toLowerCase()} coverage cost in ${where}?`, `You pay a set price per half or full day based on your ZIP code${p.volumePricingEnabled ? " and how busy the day is (Light or Busy)" : ""}, shown before you post. Mileage is passed through at ${money(s["pricing.mileageRateCentsPerMile"], { exact: true })} a mile; if a provider stays overnight, lodging is a flat ${money(s["pricing.lodgingNightlyCents"])} a night. No negotiating.`],
    ["What kinds of coverage can I book?", "Single days, half days, several days in a row, recurring days (a standing booking), vacations, holidays, sick days, maternity or paternity leave, conferences, and an open associate seat while you hire."],
    ["Do covering providers see my patients' records on your platform?", `No. ${brand().name} never stores patient information. Your provider works in your own systems on the day, the same way an associate would.`],
  ];
}

export function CoverageLanding({ p, st, area, groups, s, path }: { p: Prof; st: StateAreas; area: ServiceArea | null; groups: RateGroup[]; s: SettingsMap; path: string }) {
  const base = siteUrl();
  const service = serviceWord(p.slug);
  const where = area ? area.name : st.name;
  const noun = p.displayName.toLowerCase();
  const cities = area ? area.cities : st.areas.flatMap((a) => a.cities);
  const byGroup = citiesByRateGroup(cities, groups);
  const faq = landingFaq(p, st, s, where);
  const range = priceRange(groups);
  const crumbs = [
    { name: brand().name, url: base },
    { name: `${service} coverage`, url: `${base}/${p.slug}` },
    { name: st.name, url: `${base}/${p.slug}/${st.slug}` },
    ...(area ? [{ name: area.name, url: `${base}${path}` }] : []),
  ];
  return (
    <div className="container-page py-14">
      <JsonLd
        data={[
          serviceLd({
            name: `${service} coverage in ${where}`,
            description: `Temporary and locum ${noun}s for ${where} practices: vacations, holidays, sick days, leave and conferences. Every provider's ${st.name} license and malpractice coverage is verified.`,
            url: `${base}${path}`, siteUrl: base, serviceType: `${service} practice coverage (locum tenens)`,
            areaServed: [st.name, ...cities.map((c) => `${c.name}, ${st.code}`)],
            lowPriceCents: range?.low, highPriceCents: range?.high,
          }),
          faqLd(faq),
          breadcrumbLd(crumbs),
        ]}
      />
      <nav aria-label="Breadcrumb" className="text-sm text-slate-500">
        <Link href={`/${p.slug}`} className="hover:underline">{service} coverage</Link>
        {" / "}
        {area ? <Link href={`/${p.slug}/${st.slug}`} className="hover:underline">{st.name}</Link> : <span>{st.name}</span>}
        {area ? <> / <span>{area.name}</span></> : null}
      </nav>
      <div className="mt-4 max-w-3xl">
        <h1 className="text-4xl font-semibold leading-tight">{service} coverage in {where}</h1>
        <p className="mt-4 text-lg text-slate-600">
          Temporary and locum {noun}s for {where} practices: vacations, holidays, sick days, leave, conferences, or an open associate seat. Every {p.credentialSuffix} holds a verified {st.name} license and malpractice coverage before they can take a shift.{area ? ` ${area.blurb}` : ""}
        </p>
        <div className="mt-6 flex flex-wrap gap-3">
          <LinkButton href="/signup?role=clinic" size="lg">Request coverage</LinkButton>
          <LinkButton href={`/signup?role=provider&profession=${p.code}`} size="lg" variant="outline">I&apos;m a {noun}: join</LinkButton>
        </div>
      </div>

      {!area ? (
        <section className="mt-12">
          <h2 className="text-2xl font-semibold">Where we cover in {st.name}</h2>
          <div className="mt-4 grid gap-4 md:grid-cols-3">
            {st.areas.map((a) => (
              <Link key={a.slug} href={`/${p.slug}/${st.slug}/${a.slug}`} className="rounded-2xl border border-slate-200 p-5 transition hover:border-brand-300 hover:shadow-sm">
                <div className="font-semibold text-slate-900">{service} coverage in {a.name}</div>
                <p className="mt-1 text-sm text-slate-600">{a.blurb}</p>
                <p className="mt-2 text-sm text-slate-500">{a.cities.map((c) => c.name).join(" · ")}</p>
              </Link>
            ))}
          </div>
        </section>
      ) : null}

      <section className="mt-12">
        <h2 className="text-2xl font-semibold">{where} {noun} coverage rates</h2>
        <p className="mt-2 text-slate-600">Set by your clinic&apos;s ZIP code and shown before you post. Weekend, holiday and short-notice premiums apply as listed on the pricing page.</p>
        <div className="mt-5 grid gap-5 md:grid-cols-2">
          {groups.filter((g) => !area || byGroup.has(g.id)).map((g) => (
            <div key={g.id} className={`rounded-2xl border p-6 ${g.tier === 1 ? "border-brand-200 bg-brand-50/40" : "border-slate-200"}`}>
              <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{g.tier === 1 ? "Major cities" : "Smaller cities & towns"}</div>
              {byGroup.get(g.id)?.length ? (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {byGroup.get(g.id)!.map((c) => (
                    <span key={c.name} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-sm font-medium text-slate-700 ring-1 ring-slate-200"><MapPin className="size-3.5 text-accent-600" />{c.name}</span>
                  ))}
                </div>
              ) : null}
              <div className="mt-4 divide-y divide-slate-100">
                {rows(g, s).map((r) => (
                  <div key={r.key} className="flex items-baseline justify-between py-2.5">
                    <span className="text-sm text-slate-600">{r.label}</span>
                    <span className="text-xl font-semibold tabular-nums">{money(r.cents)}</span>
                  </div>
                ))}
              </div>
            </div>
          ))}
        </div>
        <ul className="mt-5 grid gap-2 text-sm text-slate-700 sm:grid-cols-2">
          {[
            `Mileage at ${money(s["pricing.mileageRateCentsPerMile"], { exact: true })}/mile, paid to your provider`,
            `Flat ${money(s["pricing.lodgingNightlyCents"])}/night lodging only if your provider stays over`,
            `Free cancellation ${s["payments.clinicFreeCancelHours"]}+ hours before the shift`,
            "Replacement search if a provider cancels",
          ].map((t) => <li key={t} className="flex gap-2"><Check className="mt-0.5 size-4 shrink-0 text-accent-600" />{t}</li>)}
        </ul>
      </section>

      <section className="mt-12 grid gap-6 md:grid-cols-3">
        {[
          ["1. Post the day", "Date, hours and what the day looks like. You see the price before you post."],
          [`2. We match a licensed ${p.credentialSuffix}`, `Only ${noun}s with a verified ${st.name} license, malpractice and the right drive time are offered your shift.`],
          ["3. Your office stays open", "Your provider clocks in and out on their phone, you sign off the timesheet, and payment runs through the platform."],
        ].map(([t, d]) => (
          <div key={t} className="rounded-2xl bg-slate-50 p-5"><div className="font-semibold">{t}</div><p className="mt-1 text-sm text-slate-600">{d}</p></div>
        ))}
      </section>

      <section className="mt-12 max-w-3xl">
        <h2 className="text-2xl font-semibold">Questions from {where} practices</h2>
        <div className="mt-4 divide-y divide-slate-200 rounded-2xl border border-slate-200">
          {faq.map(([q, a]) => (
            <details key={q} className="group p-5">
              <summary className="cursor-pointer list-none font-medium marker:hidden"><span className="flex items-center justify-between gap-4">{q}<span className="text-slate-400 transition group-open:rotate-45">+</span></span></summary>
              <p className="mt-3 text-sm text-slate-600">{a}</p>
            </details>
          ))}
        </div>
      </section>

      {area ? (
        <p className="mt-10 text-sm text-slate-600">
          Also covering: {st.areas.filter((a) => a.slug !== area.slug).map((a, i) => <span key={a.slug}>{i ? " · " : ""}<Link href={`/${p.slug}/${st.slug}/${a.slug}`} className="text-brand-700 hover:underline">{a.name}</Link></span>)}
          {" · "}<Link href={`/${p.slug}/${st.slug}`} className="text-brand-700 hover:underline">all of {st.name}</Link>
        </p>
      ) : null}
    </div>
  );
}
