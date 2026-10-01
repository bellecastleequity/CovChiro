import { hoursLabel } from "@cm/core";
import type { timeclock } from "@cm/services";
import { Badge } from "@/components/ui/badge";
import { cn } from "@/lib/cn";

type View = Awaited<ReturnType<typeof timeclock.timesheetView>>;

const STATUS: Record<string, { label: string; tone: "gray" | "amber" | "green" | "red" | "blue" }> = {
  OPEN: { label: "On the clock", tone: "blue" },
  SUBMITTED: { label: "Waiting for sign-off", tone: "amber" },
  APPROVED: { label: "Signed off", tone: "green" },
  DISPUTED: { label: "Problem reported", tone: "red" },
};
const SOURCE: Record<string, string> = { MANUAL: "added by hand", AUTO: "closed automatically", ADMIN: "added by admin" };

export function TimesheetStatus({ status }: { status: string }) {
  const s = STATUS[status] ?? STATUS.OPEN;
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** Punches, totals, flags and the sign-off record. Shared by provider, clinic, link page and admin. */
export function TimesheetPanel({ v, compact }: { v: View; compact?: boolean }) {
  const t = v.timesheet;
  const time = (d: Date) => d.toLocaleTimeString("en-US", { timeZone: v.timeZone, hour: "numeric", minute: "2-digit" });
  return (
    <div className="space-y-3 text-sm">
      {v.punches.length ? (
        <ol className="divide-y divide-slate-100 rounded-xl border border-slate-200">
          {v.punches.map((p) => (
            <li key={p.id} className="flex items-center justify-between gap-3 px-3 py-2">
              <span className="font-medium text-slate-800">{p.label}</span>
              <span className="text-right">
                <span className="tabular-nums">{time(p.at)}</span>
                {SOURCE[p.source] || (p.distanceMiles != null && p.distanceMiles > v.farMiles) ? (
                  <span className="block text-xs text-amber-700">{[SOURCE[p.source], p.distanceMiles != null && p.distanceMiles > v.farMiles ? `${p.distanceMiles.toFixed(1)} mi from the clinic` : null].filter(Boolean).join(" · ")}{p.note ? `: ${p.note}` : ""}</span>
                ) : null}
              </span>
            </li>
          ))}
        </ol>
      ) : <p className="text-slate-500">No punches yet.</p>}
      {t ? (
        <div className="grid grid-cols-3 gap-2 text-center">
          <div className="rounded-xl bg-slate-50 py-2"><div className="text-xs text-slate-500">Worked</div><div className="font-semibold tabular-nums">{hoursLabel(t.workedMinutes)}</div></div>
          <div className="rounded-xl bg-slate-50 py-2"><div className="text-xs text-slate-500">Lunch</div><div className="font-semibold tabular-nums">{hoursLabel(t.breakMinutes)}</div></div>
          <div className="rounded-xl bg-slate-50 py-2"><div className="text-xs text-slate-500">Scheduled</div><div className="font-semibold tabular-nums">{time(v.startsAt)}–{time(v.endsAt)}</div></div>
        </div>
      ) : null}
      {t?.flags.length ? <div className="rounded-xl bg-amber-50 px-3 py-2 text-xs text-amber-900"><b>Worth a look:</b> {t.flags.join("; ")}.</div> : null}
      {t?.providerNote ? <p className="text-xs text-slate-600"><b>Provider&apos;s note:</b> {t.providerNote}</p> : null}
      {!compact && t?.status === "APPROVED" ? (
        <div className={cn("rounded-xl border border-emerald-200 bg-emerald-50 px-3 py-2 text-xs text-emerald-900")}>
          {t.approvalMethod === "AUTO" ? "Approved automatically (no response from the clinic)" : <>Signed off by <b>{t.approverName}</b>{t.approverTitle ? `, ${t.approverTitle}` : ""} {t.approvalMethod === "ONSITE" ? "on site" : t.approvalMethod === "EMAIL_LINK" ? "by email link" : t.approvalMethod === "ADMIN" ? "by the platform" : "in the clinic portal"}</>}
          {t.approvedAt ? ` · ${t.approvedAt.toLocaleString("en-US", { timeZone: v.timeZone, month: "short", day: "numeric", hour: "numeric", minute: "2-digit" })}` : ""}
          {t.clinicNote ? <div className="mt-1">Note: {t.clinicNote}</div> : null}
          {/* eslint-disable-next-line @next/next/no-img-element */}
          {t.signature ? <img src={t.signature} alt={`Signature of ${t.approverName}`} className="mt-2 h-16 rounded bg-white" /> : null}
        </div>
      ) : null}
    </div>
  );
}
