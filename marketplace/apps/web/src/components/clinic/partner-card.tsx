import Link from "next/link";
import { Handshake } from "lucide-react";
import { partners, type Actor } from "@cm/services";
import { dateLabel } from "@/lib/format";

const YMD: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };

/** Clinic home: a partner offer to review, or the "Partner clinic" chip with its terms. Nothing when the program is off. */
export async function PartnerCard({ actor }: { actor: Actor }) {
  const v = await partners.partnershipForClinic(actor).catch(() => null);
  if (!v) return null;
  if (v.kind === "OFFERED")
    return (
      <Link href="/clinic/partner" className="mb-6 flex items-center justify-between gap-3 rounded-2xl border border-accent-200 bg-gradient-to-r from-accent-50 to-brand-50 px-4 py-3 text-sm hover:border-accent-300">
        <span className="flex items-center gap-2 text-slate-800"><Handshake className="size-5 shrink-0 text-accent-700" /><span><b>Partner offer:</b> {v.p.discountPercent}% off every shift and rates locked for {v.p.termMonths} months.</span></span>
        <span className="shrink-0 font-semibold text-brand-700">Review →</span>
      </Link>
    );
  return (
    <Link href="/clinic/partner" className="mb-6 inline-flex items-center gap-2 rounded-full border border-accent-200 bg-accent-50 px-3 py-1 text-xs font-semibold text-accent-800 hover:border-accent-300">
      <Handshake className="size-3.5" />Partner clinic · {v.p.discountPercent}% off · rates locked until {dateLabel(v.p.term.termEnd, undefined, YMD)}
    </Link>
  );
}
