import { Check } from "lucide-react";
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
  return (
    <div className="container-page py-16">
      <div className="max-w-2xl">
        <div className="text-sm font-semibold uppercase tracking-wider text-brand-700">For clinics</div>
        <h1 className="mt-2 text-4xl font-semibold">Simple per-shift pricing</h1>
        <p className="mt-4 text-lg text-slate-600">
          Prices are set by region and shift length — no negotiating, no surprises. Mileage (and lodging, if you allow it) passes straight through to your provider at cost.
        </p>
      </div>
      <div className="mt-10 grid gap-5 md:grid-cols-3">
        {regions.map((r) => (
          <div key={r.id} className="rounded-2xl border border-slate-200 p-6">
            <div className="text-sm font-medium text-slate-500">{r.name.replace("-", " · ")}</div>
            {r.rateCards
              .sort((a, b) => a.durationTier.localeCompare(b.durationTier))
              .map((c) => (
                <div key={c.id} className="mt-3 flex items-baseline justify-between">
                  <span className="text-sm text-slate-600">
                    {c.profession.displayName} · {c.durationTier === "HALF_DAY" ? "Half day (<4h)" : c.durationTier === "FULL_DAY" ? "Full day (4–8h)" : "Per hour"}
                  </span>
                  <span className="text-2xl font-semibold tabular-nums">{money(c.clinicPriceCents)}</span>
                </div>
              ))}
          </div>
        ))}
      </div>
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
            <div className="flex justify-between gap-4"><dt>Overtime beyond 8 hours</dt><dd className="font-medium">{money(s["pricing.overtimeClinicCentsPerHour"])}/hr</dd></div>
            <div className="flex justify-between gap-4"><dt>Mileage</dt><dd className="font-medium">{s["pricing.mileageRateCentsPerMile"]}¢/mile {s["pricing.mileageRoundTrip"] ? "round-trip" : "one-way"}</dd></div>
            <div className="flex justify-between gap-4"><dt>Weekend / holiday / &lt;48h</dt><dd className="font-medium">+{s["pricing.premiumWeekendPercent"]}% / +{s["pricing.premiumHolidayPercent"]}% / +{s["pricing.premiumUrgentPercent"]}%</dd></div>
          </dl>
        </div>
      </div>
      <div className="mt-10">
        <LinkButton href="/signup?role=clinic" size="lg">
          Create a clinic account
        </LinkButton>
      </div>
    </div>
  );
}
