import { NextResponse } from "next/server";
import { payoutsCsv, payoutsOverview } from "@cm/services";
import { getSession } from "@/lib/session";

export async function GET() {
  const s = await getSession();
  if (!s || s.actor.role !== "PLATFORM_ADMIN" || !s.mfaVerified) return new NextResponse("Unauthorized", { status: 401 });
  const o = await payoutsOverview(s.actor);
  const rows = o.providers.flatMap((p) => p.rows.map((r) => ({ id: r.id, providerName: p.provider.displayName, kind: r.kind, description: r.description, amountCents: r.amountCents, status: r.onHold ? "ON_HOLD" : r.status, releaseAt: r.releaseAt, paidAt: r.paidAt })));
  return new NextResponse(payoutsCsv(rows), { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="provider-pay-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
