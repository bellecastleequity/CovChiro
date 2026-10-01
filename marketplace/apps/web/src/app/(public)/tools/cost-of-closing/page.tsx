import { Suspense } from "react";
import { LinkButton } from "@/components/ui/button";
import { CostOfClosing } from "./calculator";

export const metadata = {
  title: "Cost of closing calculator",
  description: "Compare what your office normally brings in on the days you're away with what temporary coverage would cost. An educational comparison, not a guarantee.",
};

export default function CostOfClosingPage() {
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
        <CostOfClosing />
      </Suspense>
    </div>
  );
}
