import { NextResponse } from "next/server";
import { tax } from "@cm/services";
import { getSession } from "@/lib/session";

export async function GET(req: Request) {
  const s = await getSession();
  if (!s || s.actor.role !== "PLATFORM_ADMIN" || !s.mfaVerified) return new NextResponse("Unauthorized", { status: 401 });
  const year = Number(new URL(req.url, "http://x").searchParams.get("year")) || new Date().getFullYear() - 1;
  const r = await tax.form1099Report(s.actor, year);
  return new NextResponse(tax.form1099Csv(r), { headers: { "Content-Type": "text/csv", "Content-Disposition": `attachment; filename="1099-review-${year}.csv"` } });
}
