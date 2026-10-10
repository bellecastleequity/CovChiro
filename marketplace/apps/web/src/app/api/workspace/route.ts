import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@cm/services";
import { SESSION_COOKIE } from "@/lib/session";

/** One login with a clinic and a provider side: switch this session to the other side, then go to its home. */
export async function POST(req: NextRequest) {
  const s = await auth.sessionFromToken(req.cookies.get(SESSION_COOKIE)?.value);
  if (!s) return new NextResponse(null, { status: 303, headers: { Location: "/login" } });
  const to = String((await req.formData()).get("to") ?? "").toUpperCase() === "CLINIC" ? "CLINIC" : "PROVIDER";
  try {
    await auth.switchWorkspace(s.sessionId, to);
  } catch {
    return new NextResponse(null, { status: 303, headers: { Location: "/workspace" } });
  }
  // Relative on purpose (behind cPanel/Passenger req.url is the internal address).
  return new NextResponse(null, { status: 303, headers: { Location: to === "CLINIC" ? "/clinic" : "/provider" } });
}
