import { Check, MapPin } from "lucide-react";
import { prisma } from "@cm/db";
import { getSettings } from "@cm/services";
import { LinkButton } from "@/components/ui/button";
import { money } from "@/lib/format";

export const metadata = { title: "Pricing for clinics" };
export const dynamic = "force-dynamic";

export default async function ForClinics() {
  const s = await getSettings();
  const regions = await prisma.rateRegion.findMany({
    where: { state: { in: (await prisma.stateConfig.findMany({ where: { enabled: true }, select: { state: true } })).map((x) => x.state) } },
    include: { rateCards: { where: { effectiveTo: null, profession: { active: true } }, include: { profession: true } } },
    orderBy: [{ state: "asc" }, { tier: "asc" }],
  });
  const visits = { FULL_DAY: { LIGHT: s["pricing.volumeLightVisitsFullDay"], BUSY: s["pricing.volumeBusyVisitsFullDay"] }, HALF_DAY: { LIGHT: s["pricing.volumeLightVisitsHalfDay"], BUSY: s["pricing.volumeBusyVisitsHalfDay"] } };
  const tiers = priceTiers(regions, visits);
  return (
    <div className="container-page py-16">
      <div className="max-w-2xl">
        <div className="text-sm font-semibold uppercase tracking-wider text-brand-700">For clinics</div>
        <h1 className="mt-2 text-4xl font-semibold">Simple per-shift pricing</h1>
        {s["features.comparisonClaim"] ? <p className="mt-3 text-xl font-semibold text-accent-700">We charge our clinics less and get our doctors paid more.</p> : null}
        <p className="mt-4 text-lg text-slate-600">
          Prices are set by region, shift length and how busy the day is: a Light day costs less, a Busy day covers more visits. No negotiating, no surprises. Mileage (and lodging, if you allow it) passes straight through to your provider at cost.
        </p>
      </div>
      <div className="mt-10 grid gap-5 md:grid-cols-2">
        {tiers.map((t) => (
          <div key={t.tier} className={`rounded-2xl border p-6 ${t.tier === 1 ? "border-brand-200 bg-brand-50/40" : "border-slate-200"}`}>
            <div className="text-xs font-semibold uppercase tracking-wider text-slate-500">{t.intro}</div>
            <div className="mt-2 flex flex-wrap gap-1.5">
              {t.cities.map((c) => (
                <span key={c} className="inline-flex items-center gap-1 rounded-full bg-white px-2.5 py-1 text-sm font-medium text-slate-700 ring-1 ring-slate-200">
                  <MapPin className="size-3.5 text-accent-600" />
                  {c}
                </span>
              ))}
            </div>
            <div className="mt-5 divide-y divide-slate-100">
              {t.prices.map((c) => (
                <div key={c.key} className="flex items-baseline justify-between py-2.5">
                  <span className="text-sm text-slate-600">{c.label}</span>
                  <span className="text-2xl font-semibold tabular-nums">
                    {c.from ? <span className="mr-1 text-sm font-normal text-slate-500">from</span> : null}
                    {money(c.cents)}
                  </span>
                </div>
              ))}
            </div>
          </div>
        ))}
      </div>
      <p className="mt-3 text-sm text-slate-500">Your rate is set by your clinic&apos;s ZIP code and shown before you post.</p>
      <div className="mt-10 grid gap-8 lg:grid-cols-2">
        <div className="rounded-2xl bg-slate-50 p-6">
          <h2 className="font-semibold">What's included</h2>
          <ul className="mt-4 space-y-2.5 text-sm text-slate-700">
            {[
              "State license, malpractice and NPI verification for every provider",
              "Matching by drive time, skills, reliability and ratings",
              "Messaging with your provider, arrival notes shared after confirmation",
              "Replacement search if a provider cancels",
              "One invoice trail — deposit at confirmation, balance after the shift",
            ].map((t) => (
              <li key={t} className="flex gap-2">
                <Check className="mt-0.5 size-4 shrink-0 text-accent-600" /> {t}
              </li>
            ))}
          </ul>
        </div>
        <div className="rounded-2xl bg-slate-50 p-6 text-sm text-slate-700">
          <h2 className="font-semibold text-slate-900">Terms at a glance</h2>
          <dl className="mt-4 space-y-2.5">
            <div className="flex justify-between gap-4"><dt>Deposit at confirmation</dt><dd className="font-medium">{s["payments.depositPercent"]}%</dd></div>
            <div className="flex justify-between gap-4"><dt>Free cancellation</dt><dd className="font-medium">{s["payments.clinicFreeCancelHours"]}h+ before start</dd></div>
            <div className="flex justify-between gap-4"><dt>Extra visits past your tier (+{s["pricing.volumeGraceVisits"]} free)</dt><dd className="font-medium">{money(s["pricing.volumeOverageClinicCents"])}/visit</dd></div>
            <div className="flex justify-between gap-4"><dt>Overtime beyond 8 hours</dt><dd className="font-medium">{money(s["pricing.overtimeClinicCentsPerHour"])}/hr</dd></div>
            <div className="flex justify-between gap-4"><dt>Mileage</dt><dd className="font-medium">{money(s["pricing.mileageRateCentsPerMile"], { exact: true })}/mile {s["pricing.mileageRoundTrip"] ? "round-trip" : "one-way"}</dd></div>
            <div className="flex justify-between gap-4"><dt>Weekend / holiday / &lt;48h</dt><dd className="font-medium">+{s["pricing.premiumWeekendPercent"]}% / +{s["pricing.premiumHolidayPercent"]}% / +{s["pricing.premiumUrgentPercent"]}%</dd></div>
            {s["pricing.premiumRushPercent"] > 0 ? <div className="flex justify-between gap-4"><dt>Rush (posted &lt;{s["pricing.rushWithinHours"]}h before)</dt><dd className="font-medium">+{s["pricing.premiumRushPercent"]}% instead of +{s["pricing.premiumUrgentPercent"]}%</dd></div> : null}
          </dl>
        </div>
      </div>
      <div className="mt-10 flex flex-wrap gap-3">
        <LinkButton href="/signup?role=clinic" size="lg">
          Create a clinic account
        </LinkButton>
        <LinkButton href="/tools/cost-of-closing" size="lg" variant="outline">
          Cost of closing calculator
        </LinkButton>
      </div>
    </div>
  );
}

/** Example cities shown for each rate tier (tier 1 = major cities, higher rate). */
const TIER_COPY: Record<number, { intro: string; cities: string[] }> = {
  1: { intro: "Major cities, like", cities: ["Miami", "Orlando", "Tampa", "Jacksonville", "Atlanta", "Dallas", "Phoenix"] },
  2: { intro: "Smaller cities & towns, like", cities: ["Gainesville", "Ocala", "Tallahassee", "Pensacola", "Savannah", "Chattanooga"] },
};

type Region = { tier: number; name: string; rateCards: { clinicPriceCents: number; durationTier: string; volumeTier: string | null; professionCode: string; profession: { displayName: string; sortOrder: number } }[] };
type Visits = Record<"FULL_DAY" | "HALF_DAY", Record<"LIGHT" | "BUSY", number>>;

/** One card per tier: the lowest current price per profession and shift length across that tier's regions. */
function priceTiers(regions: Region[], visits: Visits) {
  const byTier = new Map<number, Region[]>();
  for (const r of regions) if (r.rateCards.length) byTier.set(r.tier, [...(byTier.get(r.tier) ?? []), r]);
  const order = { HALF_DAY: 0, FULL_DAY: 1, HOURLY: 2 } as Record<string, number>;
  return [...byTier.entries()]
    .sort(([a], [b]) => a - b)
    .map(([tier, rs]) => {
      const cells = new Map<string, { key: string; label: string; cents: number; from: boolean; sort: number }>();
      for (const c of rs.flatMap((r) => r.rateCards)) {
        const key = `${c.professionCode}:${c.durationTier}:${c.volumeTier ?? ""}`;
        const vt = c.volumeTier as "LIGHT" | "BUSY" | null;
        const dur = c.durationTier as "HALF_DAY" | "FULL_DAY";
        const volume = vt && visits[dur] ? ` · ${vt === "LIGHT" ? "Light" : "Busy"}, up to ${visits[dur][vt]} visits` : "";
        const label = `${c.profession.displayName} · ${c.durationTier === "HALF_DAY" ? "Half day (under 4h)" : c.durationTier === "FULL_DAY" ? "Full day (4–8h)" : "Per hour"}${volume}`;
        const prev = cells.get(key);
        if (!prev) cells.set(key, { key, label, cents: c.clinicPriceCents, from: false, sort: c.profession.sortOrder * 100 + (order[c.durationTier] ?? 9) * 10 + (vt === "BUSY" ? 1 : 0) });
        else if (prev.cents !== c.clinicPriceCents) cells.set(key, { ...prev, cents: Math.min(prev.cents, c.clinicPriceCents), from: true });
      }
      const copy = TIER_COPY[tier] ?? { intro: "Areas like", cities: rs.map((r) => r.name) };
      return { tier, ...copy, prices: [...cells.values()].sort((a, b) => a.sort - b.sort) };
    });
}
