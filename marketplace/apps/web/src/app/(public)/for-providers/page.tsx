import { Banknote, CalendarCheck, Car, ShieldCheck } from "lucide-react";
import { LinkButton } from "@/components/ui/button";
import { pageMeta } from "@/lib/seo";

export const metadata = pageMeta({
  title: "Per diem & locum chiropractor jobs",
  description: "Pick up fill-in shifts at chiropractic clinics near you. Choose your days and drive radius, see pay up front, and get paid after every shift.",
  path: "/for-providers",
});

export default function ForProviders() {
  return (
    <div className="container-page py-16">
      <div className="max-w-2xl">
        <div className="text-sm font-semibold uppercase tracking-wider text-brand-700">For providers</div>
        <h1 className="mt-2 text-4xl font-semibold">Fill your open days with coverage shifts</h1>
        <p className="mt-4 text-lg text-slate-600">Set your availability and how far you'll drive. See pay and mileage up front, apply in a tap, and get paid to your bank after every shift.</p>
        <div className="mt-8 flex gap-3">
          <LinkButton href="/signup?role=provider" size="lg">
            Create your profile
          </LinkButton>
        </div>
      </div>
      <div className="mt-12 grid gap-5 sm:grid-cols-2 lg:grid-cols-4">
        {[
          { Icon: CalendarCheck, t: "Work when you want", d: "Weekly availability plus one-off open days and blackouts." },
          { Icon: Car, t: "Mileage paid", d: "Mileage is passed through to you in full; lodging too when the clinic allows it." },
          { Icon: Banknote, t: "Fast, direct pay", d: "Payments go straight to your bank through Stripe, with a year-end 1099." },
          { Icon: ShieldCheck, t: "Verified once", d: "Upload your license and malpractice once — we handle re-verification reminders." },
        ].map(({ Icon, t, d }) => (
          <div key={t} className="rounded-2xl border border-slate-200 p-6">
            <Icon className="size-6 text-accent-600" />
            <div className="mt-3 font-semibold">{t}</div>
            <p className="mt-1.5 text-sm text-slate-600">{d}</p>
          </div>
        ))}
      </div>
      <div className="mt-12 rounded-2xl bg-slate-50 p-6 text-sm text-slate-700">
        <h2 className="font-semibold text-slate-900">What you'll need</h2>
        <p className="mt-2">An active license for your profession in each state you want to work, a current malpractice certificate that lists your profession, your NPI (for professions that use one), and a bank account for payouts through Stripe.</p>
      </div>
    </div>
  );
}
