import { NextResponse, type NextRequest } from "next/server";
import { leads } from "@cm/services";
import { getSession } from "@/lib/session";

export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s || s.actor.role !== "PLATFORM_ADMIN" || !s.mfaVerified) return new NextResponse("Unauthorized", { status: 401 });
  const p = req.nextUrl.searchParams;
  const { rows } = await leads.listLeads(s.actor, { q: p.get("q") ?? undefined, status: (p.get("status") || undefined) as never, audience: (p.get("audience") || undefined) as never, source: p.get("source") || undefined, take: 10_000 });
  return new NextResponse(leads.leadsCsv(rows), { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="leads-${new Date().toISOString().slice(0, 10)}.csv"` } });
}
