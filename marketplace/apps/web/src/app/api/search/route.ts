import { NextResponse, type NextRequest } from "next/server";
import { search } from "@cm/services";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** Backend search bar: records the signed-in person can see (services/search.ts scopes by role). */
export async function GET(req: NextRequest) {
  const s = await getSession();
  if (!s) return NextResponse.json({ hits: [] }, { status: 401 });
  if ((s.user.role === "PLATFORM_ADMIN" || s.user.mfaEnabled) && !s.mfaVerified) return NextResponse.json({ hits: [] }, { status: 401 });
  const hits = await search.searchRecords(s.actor, req.nextUrl.searchParams.get("q") ?? "").catch((e) => {
    console.error("search failed", e);
    return [];
  });
  return NextResponse.json({ hits }, { headers: { "Cache-Control": "no-store" } });
}
