import Link from "next/link";
import { prisma } from "@cm/db";
import { dateLabel } from "@/lib/format";

/** Clinic changes waiting for this provider's answer (shift pages, home, My shifts). */
export async function PendingChanges({ providerId, assignmentId }: { providerId: string; assignmentId?: string }) {
  const changes = await prisma.shiftChange.findMany({
    where: { providerId, status: "PENDING", ...(assignmentId ? { assignmentId } : {}) },
    include: { shift: { include: { location: { include: { clinicOrg: true } } } } },
    orderBy: { respondBy: "asc" },
  });
  if (!changes.length) return null;
  return (
    <div className="mb-5 space-y-2">
      {changes.map((c) => (
        <Link key={c.id} href={`/provider/changes/${c.id}`} className="block rounded-2xl border border-amber-300 bg-amber-50 p-4 text-sm hover:bg-amber-100">
          <div className="font-semibold text-amber-900">{c.shift.location.clinicOrg.displayName} asked to change your {dateLabel(c.shift.startsAt, c.shift.location.timeZone)} shift</div>
          <div className="text-amber-800">
            Please accept or decline by {dateLabel(c.respondBy, c.shift.location.timeZone, { weekday: "short", hour: "numeric", minute: "2-digit" })}. Review the change →
          </div>
        </Link>
      ))}
    </div>
  );
}
