import { Suspense } from "react";
import { prisma } from "@cm/db";
import { LinkButton } from "@/components/ui/button";
import { CostOfClosing } from "./calculator";

export const metadata = {
  title: "Cost of closing calculator",
  description: "Compare what your office normally brings in on the days you're away with what temporary coverage would cost. An educational comparison, not a guarantee.",
  alternates: { canonical: "/tools/cost-of-closing" },
};

export const dynamic = "force-dynamic";

/** Current full-day clinic prices (live professions, open states), for the calculator's estimate. */
async function fullDayPrices() {
  const states = (await prisma.stateConfig.findMany({ where: { enabled: true }, select: { state: true } })).map((x) => x.state);
  const cards = await prisma.rateCard.findMany({
    where: { durationTier: "FULL_DAY", effectiveTo: null, profession: { active: true }, rateRegion: { state: { in: states } } },
    select: { clinicPriceCents: true, volumeTier: true },
  });
  const p = cards.map((c) => c.clinicPriceCents).sort((a, b) => a - b);
  if (!p.length) return null;
  // Typical = a Busy (standard) day; Light days are the low end of the range.
  const busy = cards.filter((c) => c.volumeTier !== "LIGHT").map((c) => c.clinicPriceCents).sort((a, b) => a - b);
  const mid = busy.length ? busy : p;
  return { low: p[0] / 100, high: p[p.length - 1] / 100, typical: mid[Math.floor((mid.length - 1) / 2)] / 100 };
}

export default async function CostOfClosingPage() {
  const prices = await fullDayPrices();
  return (
    <div className="container-page grid max-w-6xl gap-10 py-16 lg:grid-cols-2">
      <div>
        <div className="text-sm font-semibold uppercase tracking-wider text-brand-700">Cost of closing</div>
        <h1 className="mt-2 text-4xl font-semibold">Your office doesn&apos;t have to close because you&apos;re away.</h1>
        <p className="mt-4 text-lg text-slate-600">When the doctor is out for a vacation, a CE weekend, a sick day or a family event, many offices close and reschedule. This comparison puts what those days normally bring in next to what temporary coverage would cost, so you can decide with your own numbers.</p>
        <ul className="mt-6 space-y-2 text-slate-700">
          <li>• Scheduled patients keep their visits and their care continues.</li>
          <li>• Your team keeps working instead of rescheduling a full calendar.</li>
          <li>• A licensed, verified provider follows your protocols and techniques.</li>
        </ul>
        <div className="mt-8 flex flex-wrap gap-3">
          <LinkButton href="/signup?role=clinic" size="lg">Start a coverage request</LinkButton>
          <LinkButton href="/how-it-works" size="lg" variant="outline">How it works</LinkButton>
        </div>
      </div>
      <Suspense fallback={null}>
        <CostOfClosing prices={prices} />
      </Suspense>
    </div>
  );
}
