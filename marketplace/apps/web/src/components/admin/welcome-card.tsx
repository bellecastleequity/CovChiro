import Link from "next/link";
import { prisma } from "@cm/db";
import { requireActor } from "@/lib/session";
import { welcome } from "@cm/services";
import { ActionForm, SubmitButton } from "@/components/ui/action-form";
import { Card, CardBody, CardHeader } from "@/components/ui/card";
import { Input } from "@/components/ui/form";
import { dateLabel, money } from "@/lib/format";
import { welcomeAdjustAction } from "@/app/admin/actions";

const YMD: Intl.DateTimeFormatOptions = { month: "short", day: "numeric", year: "numeric" };
const STATUS: Record<string, string> = { RESERVED: "Reserved", REDEEMED: "Used", RELEASED: "Released" };

/** Admin → clinic: the clinic's Welcome Discount, its history, and documented exceptions (every one audited). */
export async function AdminWelcomeCard({ clinicOrgId }: { clinicOrgId: string }) {
  const { actor } = await requireActor("admin");
  const w = await welcome.adminClinicWelcome(actor, clinicOrgId).catch(() => null);
  if (!w) return null;
  const { entitlement: e, counts: c } = w;
  const shifts = await prisma.shift.findMany({ where: { id: { in: w.rows.map((r) => r.shiftId) } }, select: { id: true, startsAt: true } });
  const when = new Map(shifts.map((s) => [s.id, s.startsAt]));
  const hidden = <input type="hidden" name="clinicOrgId" value={clinicOrgId} />;
  const note = <Input name="note" required minLength={3} placeholder="Why (saved to the audit log)" className="h-9 min-w-0 flex-1 sm:max-w-xs" />;
  return (
    <Card id="welcome">
      <CardHeader
        title="Welcome Discount"
        description={`${e.percent}% off the first ${e.totalBookings} completed bookings · ${c.used} used${e.priorCompleted ? ` (${e.priorCompleted} before the offer)` : ""} · ${c.reserved} reserved · ${c.pending} on posted shifts · ${c.available} available`}
      />
      <CardBody className="space-y-3 text-sm">
        {e.status === "REVIEW" ? (
          <div className="rounded-lg border border-amber-200 bg-amber-50 px-3 py-2">
            <p className="font-medium text-amber-900">Waiting for review: {e.reviewReason}</p>
            <ActionForm action={welcomeAdjustAction} className="mt-2 flex flex-wrap items-center gap-2">{hidden}<input type="hidden" name="op" value="approve" />{note}<SubmitButton size="sm">Approve</SubmitButton></ActionForm>
          </div>
        ) : null}
        {w.rows.length ? (
          <ul className="divide-y divide-slate-100">
            {w.rows.map((r) => (
              <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-1.5">
                <span>
                  <Link className="text-brand-700" href={`/admin/shifts/${r.shiftId}`}>{when.get(r.shiftId) ? dateLabel(when.get(r.shiftId)!, undefined, YMD) : "Shift"}</Link>
                  {" · "}{STATUS[r.status] ?? r.status} · −{money(r.discountCents)} of {money(r.standardCents)}
                  {r.releaseReason ? <span className="text-slate-500"> · {r.releaseReason}</span> : null}
                  {r.disputed ? <span className="font-medium text-red-700"> · disputed</span> : null}
                </span>
                {r.status === "REDEEMED" ? (
                  <ActionForm action={welcomeAdjustAction} className="flex items-center gap-2" confirm="Make this discount available again?">{hidden}<input type="hidden" name="op" value="restore" /><input type="hidden" name="redemptionId" value={r.id} />{note}<SubmitButton size="sm" variant="outline">Restore</SubmitButton></ActionForm>
                ) : null}
              </li>
            ))}
          </ul>
        ) : <p className="text-slate-500">No Welcome bookings yet.</p>}
        <ActionForm action={welcomeAdjustAction} className="flex flex-wrap items-center gap-2" confirm="Give this clinic one more Welcome booking?">{hidden}<input type="hidden" name="op" value="add" />{note}<SubmitButton size="sm" variant="outline">Add one booking</SubmitButton></ActionForm>
        <ActionForm action={welcomeAdjustAction} className="flex flex-wrap items-center gap-2">{hidden}<input type="hidden" name="op" value="note" />{note}<SubmitButton size="sm" variant="outline">Add note</SubmitButton></ActionForm>
        {e.note ? <p className="whitespace-pre-line rounded-lg bg-slate-50 px-3 py-2 text-xs text-slate-600">{e.note}</p> : null}
        <p className="text-xs text-slate-500"><Link className="text-brand-700" href="/admin/welcome">Welcome Discount report →</Link></p>
      </CardBody>
    </Card>
  );
}
