import { NextResponse } from "next/server";
import { earningsFor, payoutsCsv } from "@cm/services";
import { getSession } from "@/lib/session";

export async function GET() {
  const s = await getSession();
  if (!s?.actor.providerId) return new NextResponse("Unauthorized", { status: 401 });
  const e = await earningsFor(s.actor.providerId);
  const csv = payoutsCsv(e.rows.map((r) => ({ id: r.id, providerName: s.user.name, kind: r.kind, description: r.description, amountCents: r.amountCents, status: r.status, releaseAt: r.releaseAt, paidAt: r.paidAt })));
  return new NextResponse(csv, { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="earnings-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
