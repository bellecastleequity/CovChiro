import { BadgeCheck, Clock, ShieldCheck, Star } from "lucide-react";
import { trust } from "@cm/services";
import { dateLabel } from "@/lib/format";

function Row({ icon: Icon, ok, children }: { icon: typeof BadgeCheck; ok: boolean; children: React.ReactNode }) {
  return (
    <li className="flex gap-2">
      <Icon className={`mt-0.5 size-4 shrink-0 ${ok ? "text-emerald-600" : "text-amber-600"}`} />
      <span>{children}</span>
    </li>
  );
}

/** Verified credentials and track record of the booked provider (clinic shift page). */
export async function TrustPanel({ providerId, professionCode, state, tz }: { providerId: string; professionCode: string; state: string; tz: string }) {
  const t = await trust.providerTrust(providerId, professionCode, state);
  const long = { month: "short", day: "numeric", year: "numeric" } as const;
  return (
    <div className="rounded-xl bg-slate-50 p-3 text-sm">
      <div className="mb-2 text-xs font-semibold uppercase tracking-wide text-slate-500">Verified by us</div>
      <ul className="space-y-1.5 text-slate-700">
        <Row icon={BadgeCheck} ok={!!t.license?.current}>
          {t.license ? (
            <>
              {t.license.title ?? professionCode} license{t.license.state === "US" ? " (national registry)" : `, ${t.license.state}`}: verified{t.license.verifiedAt ? ` ${dateLabel(t.license.verifiedAt, tz)}` : ""}, valid through {dateLabel(t.license.expiresAt, tz, long)}
            </>
          ) : "License verification pending"}
        </Row>
        <Row icon={ShieldCheck} ok={!!t.malpractice?.current}>
          {t.malpractice ? <>Malpractice coverage ({t.malpractice.carrier}) verified, valid through {dateLabel(t.malpractice.expiresAt, tz, long)}</> : "Malpractice verification pending"}
        </Row>
        <Row icon={Star} ok>
          {t.completedShifts} shift{t.completedShifts === 1 ? "" : "s"} completed on the platform
          {t.rating ? ` · ${t.rating.toFixed(1)}★ from ${t.ratingCount} rating${t.ratingCount === 1 ? "" : "s"}` : ""}
          {t.noShows || t.lateCancels ? ` · ${t.noShows} no-show${t.noShows === 1 ? "" : "s"}, ${t.lateCancels} late cancel${t.lateCancels === 1 ? "" : "s"}` : " · no no-shows"}
        </Row>
        {t.onTimePct != null ? (
          <Row icon={Clock} ok={t.onTimePct >= 90}>
            Punched in on time {t.onTimePct}% of the time ({t.timesheets} timesheet{t.timesheets === 1 ? "" : "s"})
          </Row>
        ) : null}
      </ul>
    </div>
  );
}
