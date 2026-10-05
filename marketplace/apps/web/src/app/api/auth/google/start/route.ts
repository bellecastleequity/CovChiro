import { NextResponse, type NextRequest } from "next/server";
import { google } from "@cm/services";
import { GOOGLE_FLOW_COOKIE } from "@/lib/google";

/** "Continue with Google": remembers state/nonce/PKCE (+ where to go after) for 10 minutes, then off to Google. */
export async function GET(req: NextRequest) {
  // Relative redirects: behind cPanel/Passenger req.url is the internal address.
  if (!google.googleEnabled()) return new NextResponse(null, { status: 303, headers: { Location: "/login?google=off" } });
  const q = req.nextUrl.searchParams;
  const r = google.googleRequest();
  const next = q.get("next") ?? "";
  const flow = {
    state: r.state,
    nonce: r.nonce,
    verifier: r.verifier,
    role: q.get("role") === "provider" ? "provider" : q.get("role") === "clinic" ? "clinic" : "",
    next: next.startsWith("/") && !next.startsWith("//") ? next.slice(0, 300) : "",
    campaign: (q.get("campaign") ?? "").slice(0, 60),
    code: (q.get("code") ?? "").slice(0, 40),
  };
  const res = new NextResponse(null, { status: 303, headers: { Location: google.googleAuthUrl(r) } });
  res.cookies.set(GOOGLE_FLOW_COOKIE, Buffer.from(JSON.stringify(flow)).toString("base64url"), {
    httpOnly: true,
    secure: process.env.NODE_ENV === "production",
    sameSite: "lax",
    path: "/api/auth/google",
    maxAge: 600,
  });
  return res;
}
