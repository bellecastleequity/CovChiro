import Link from "next/link";
import { notFound } from "next/navigation";
import { CheckCircle2, Clock, MapPin, Navigation } from "lucide-react";
import { brand } from "@cm/config";
import { attendance } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Logo } from "@/components/site/header";
import { attendanceLinkAction } from "../../o/actions";

export const dynamic = "force-dynamic";
export const metadata = { title: "Your shift", robots: { index: false } };

/** One-tap page from the reconfirmation / check-in text and email. The signed link covers this one shift. */
export default async function AttendanceLink({ params }: { params: Promise<{ token: string }> }) {
  const { token } = await params;
  const a = await attendance.attendanceByToken(token);
  if (!a) notFound();
  const loc = a.shift.location;
  const tz = loc.timeZone;
  const t = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: tz, hour: "numeric", minute: "2-digit" });
  const live = a.status === "CONFIRMED" || a.status === "IN_PROGRESS";
  const hoursToStart = (+a.startsAt - Date.now()) / 3_600_000;
  const dayOf = hoursToStart <= 12 && hoursToStart > -2;
  const address = `${loc.addressLine1}${loc.addressLine2 ? `, ${loc.addressLine2}` : ""}, ${loc.city}, ${loc.state} ${loc.zip}`;
  return (
    <div className="min-h-dvh bg-slate-50 px-4 py-6">
      <div className="mx-auto max-w-md">
        <Logo name={brand().name} />
        <div className="mt-5 rounded-3xl bg-white p-5 shadow-card">
          <div className="text-xs font-semibold uppercase tracking-wider text-brand-700">{loc.clinicOrg.displayName}</div>
          <h1 className="mt-1 text-2xl font-semibold">{a.startsAt.toLocaleDateString("en-US", { timeZone: tz, weekday: "long", month: "short", day: "numeric" })}</h1>
          <div className="mt-3 space-y-2 text-sm text-slate-700">
            <div className="flex items-center gap-2"><Clock className="size-4 text-slate-400" />{t(a.startsAt)} – {t(a.endsAt)}</div>
            <div className="flex items-start gap-2"><MapPin className="mt-0.5 size-4 shrink-0 text-slate-400" />{address}</div>
          </div>

          {!live ? (
            <p className="mt-5 rounded-xl bg-slate-100 p-3 text-sm text-slate-700">
              {a.flags.includes("RECONFIRM_MISSED") ? "This shift was released because it wasn't confirmed by the deadline." : "This shift is no longer booked to you."}
            </p>
          ) : (
            <div className="mt-5 space-y-3">
              {a.reconfirmedAt ? (
                <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-800"><CheckCircle2 className="size-4" />You've confirmed you're coming.</div>
              ) : (
                <ActionForm action={attendanceLinkAction}>
                  <input type="hidden" name="token" value={token} />
                  <input type="hidden" name="do" value="confirm" />
                  <SubmitButton size="lg" className="w-full">I'm still coming</SubmitButton>
                </ActionForm>
              )}
              {dayOf ? (
                a.onMyWayAt ? (
                  <div className="flex items-center gap-2 rounded-xl bg-emerald-50 p-3 text-sm font-medium text-emerald-800"><Navigation className="size-4" />The clinic knows you're on your way.</div>
                ) : (
                  <ActionForm action={attendanceLinkAction}>
                    <input type="hidden" name="token" value={token} />
                    <input type="hidden" name="do" value="onway" />
                    <SubmitButton size="lg" variant={a.reconfirmedAt ? "primary" : "outline"} className="w-full">On my way</SubmitButton>
                  </ActionForm>
                )
              ) : null}
              <a href={`https://www.google.com/maps/dir/?api=1&destination=${encodeURIComponent(address)}`} className="flex items-center justify-center gap-2 rounded-xl border border-slate-200 py-3 text-sm font-medium text-brand-700">
                <Navigation className="size-4" /> Get directions
              </a>
              <p className="text-center text-xs text-slate-500">
                Can't make it? <Link href={`/provider/assignments/${a.id}`} className="font-medium text-brand-700">Sign in to cancel</Link> as early as you can so we can find cover.
              </p>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
