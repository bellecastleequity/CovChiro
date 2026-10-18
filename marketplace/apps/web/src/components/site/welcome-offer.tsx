import Link from "next/link";
import { Gift } from "lucide-react";
import { getSettings } from "@cm/services";
import { cn } from "@/lib/cn";

/**
 * Welcome Discount on clinic-facing pages (docs/specs/welcome-discount.md §6). Never on provider pages;
 * nothing while new enrollment is off in Settings.
 */
export async function WelcomeOffer({ variant = "band", className }: { variant?: "band" | "inline"; className?: string }) {
  const s = await getSettings();
  if (!s["welcome.enabled"]) return null;
  const pct = s["welcome.percent"], n = s["welcome.bookings"];
  if (variant === "inline")
    return (
      <p className={cn("flex items-start gap-2 rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm text-emerald-900", className)}>
        <Gift className="mt-0.5 size-4 shrink-0" />
        <span><b>Save {pct}% on your first {n} coverage bookings.</b> No code. No expiration. Applied automatically when you book.</span>
      </p>
    );
  return (
    <section className={cn("border-y border-emerald-200 bg-gradient-to-r from-emerald-50 via-white to-brand-50", className)}>
      <div className="container-page flex flex-col gap-3 py-5 sm:flex-row sm:items-center sm:justify-between">
        <div className="flex items-start gap-3">
          <Gift className="mt-1 size-6 shrink-0 text-emerald-700" />
          <div>
            <p className="text-base font-semibold text-slate-900 sm:text-lg">{pct}% off your first {n} coverage bookings</p>
            <p className="text-sm text-slate-600">Dependable coverage for your practice, and your discount is applied automatically. No promo code. Your welcome benefits never expire.</p>
          </div>
        </div>
        <Link href="/signup?role=clinic" className="shrink-0 self-start rounded-xl bg-brand-600 px-4 py-2 text-sm font-semibold text-white hover:bg-brand-700 sm:self-auto">Claim your welcome benefits</Link>
      </div>
    </section>
  );
}
