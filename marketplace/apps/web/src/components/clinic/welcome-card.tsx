import Link from "next/link";
import { Gift } from "lucide-react";
import { welcome, type Actor } from "@cm/services";
import { cn } from "@/lib/cn";
import { dateLabel, money } from "@/lib/format";

const COPY = {
  NEW: { title: "Welcome to Coverage On Call", line: "Your introductory benefit is applied automatically at checkout. No promo code. No expiration date.", cta: "Book coverage" },
  TWO_LEFT: { title: "", line: "Your first coverage booking is complete! You still have two opportunities to save on coverage.", cta: "Book your next coverage day" },
  ONE_LEFT: { title: "", line: "Your final Welcome Discount is available whenever your practice needs coverage. Your benefit never expires.", cta: "Use your Welcome Discount" },
  DONE: { title: "Welcome offer completed", line: "Thank you for choosing Coverage On Call for your first coverage bookings. Keep scheduling dependable coverage whenever your practice needs support.", cta: "Book coverage" },
} as const;

const SLOT = { USED: "Used", RESERVED: "Reserved", AVAILABLE: "Available" } as const;

/** Clinic home: the Welcome Discount (3 → 2 → 1 → 0, never a countdown). Nothing when the clinic has no entitlement. */
export async function WelcomeCard({ actor }: { actor: Actor }) {
  const w = await welcome.clinicWelcome(actor).catch(() => null);
  // Clinics that had finished three bookings before the offer existed never see it.
  if (!w || (w.stage === "DONE" && !w.savedCents)) return null;
  if (w.status === "REVIEW")
    return <p className="mb-6 rounded-2xl border border-slate-200 bg-slate-50 px-4 py-3 text-sm text-slate-600"><Gift className="mr-1.5 inline size-4 text-brand-700" />Your Welcome Discount is being set up. We&apos;ll email you when it&apos;s ready.</p>;
  const c = COPY[w.stage];
  const left = w.counts.remaining;
  const title = w.stage === "NEW" ? c.title : w.stage === "DONE" ? c.title : `${left} Welcome Booking${left === 1 ? "" : "s"} Remaining`;
  return (
    <section className={cn("mb-6 rounded-2xl border px-4 py-4 sm:px-5", w.stage === "DONE" ? "border-slate-200 bg-white" : "border-emerald-200 bg-gradient-to-r from-emerald-50 to-brand-50")}>
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div className="min-w-0">
          <p className="flex items-center gap-1.5 text-xs font-semibold uppercase tracking-wide text-emerald-800"><Gift className="size-4" />{w.percent}% off your first {w.total} coverage bookings</p>
          <h2 className="mt-1 text-lg font-semibold text-slate-900">{title}</h2>
          <p className="mt-1 text-sm text-slate-700">{c.line}</p>
        </div>
        <Link href="/clinic/shifts/new" className="shrink-0 rounded-xl bg-brand-600 px-3 py-2 text-sm font-semibold text-white hover:bg-brand-700">{c.cta}</Link>
      </div>
      {w.stage !== "DONE" ? (
        <ol className="mt-3 grid gap-2 sm:grid-cols-3">
          {w.slots.map((s) => (
            <li key={s.n} className={cn("rounded-xl border px-3 py-2 text-sm", s.status === "AVAILABLE" ? "border-emerald-200 bg-white" : s.status === "RESERVED" ? "border-amber-200 bg-amber-50" : "border-slate-200 bg-slate-50 text-slate-500")}>
              <span className="font-medium">Booking {s.n}</span> · {SLOT[s.status]}
              {s.status !== "AVAILABLE" && s.startsAt ? (
                <span className="block text-xs">
                  {s.shiftId ? <Link href={`/clinic/shifts/${s.shiftId}`} className="underline">{dateLabel(s.startsAt, s.timeZone ?? undefined)}</Link> : null}
                  {s.savedCents ? ` · −${money(s.savedCents)}` : ""}
                </span>
              ) : null}
            </li>
          ))}
        </ol>
      ) : null}
      {w.counts.pending ? <p className="mt-2 text-xs text-slate-600">{w.counts.pending} posted shift{w.counts.pending === 1 ? " is" : "s are"} already priced with a Welcome Discount; it&apos;s reserved when a provider is confirmed.</p> : null}
      {w.savedCents ? <p className="mt-2 text-xs font-medium text-emerald-800">Saved so far: {money(w.savedCents)}</p> : null}
    </section>
  );
}
