import { NextResponse, type NextRequest } from "next/server";
import { auth, google } from "@cm/services";
import { GOOGLE_FLOW_COOKIE, GOOGLE_PENDING_COOKIE } from "@/lib/google";
import { SESSION_COOKIE } from "@/lib/session";

interface Flow { state: string; nonce: string; verifier: string; role: string; next: string; campaign: string; code: string; intent?: string }

const cookieOpts = { httpOnly: true, secure: process.env.NODE_ENV === "production", sameSite: "lax" as const, path: "/" };

/** Back from Google: sign in, link by email, or go on to finish sign-up. Every redirect is relative (cPanel). */
export async function GET(req: NextRequest) {
  const q = req.nextUrl.searchParams;
  let flow: Flow | null = null;
  try {
    flow = JSON.parse(Buffer.from(req.cookies.get(GOOGLE_FLOW_COOKIE)?.value ?? "", "base64url").toString("utf8")) as Flow;
  } catch {
    flow = null;
  }
  const back = (problem: string) => {
    const to = flow?.intent === "connect" ? `${flow.next || "/login"}${(flow.next || "").includes("?") ? "&" : "?"}google=${problem}#google` : flow?.role ? `/signup?role=${flow.role}&google=${problem}` : `/login?google=${problem}`;
    const res = new NextResponse(null, { status: 303, headers: { Location: to } });
    res.cookies.delete({ name: GOOGLE_FLOW_COOKIE, path: "/api/auth/google" });
    return res;
  };
  if (q.get("error")) return back(q.get("error") === "access_denied" ? "cancelled" : "failed");
  if (!flow?.state || q.get("state") !== flow.state || !q.get("code")) return back("expired");
  try {
    const profile = await google.exchangeGoogleCode(q.get("code")!, flow.verifier, flow.nonce);
    if (flow.intent === "connect") {
      // Link to whoever is signed in on this browser.
      const session = await auth.sessionFromToken(req.cookies.get(SESSION_COOKIE)?.value);
      if (!session) return back("signin");
      const r = await google.connectGoogle(session.user.id, profile);
      return back(r.ok ? "connected" : r.problem);
    }
    const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? "local";
    const r = await google.googleSignIn(profile, { ip, userAgent: req.headers.get("user-agent") ?? undefined });
    if (r.kind === "problem") return back(r.problem);
    if (r.kind === "signup") {
      const params = new URLSearchParams({ ...(flow.role ? { role: flow.role } : {}), ...(flow.campaign ? { campaign: flow.campaign } : {}), ...(flow.code ? { code: flow.code } : {}) });
      const res = new NextResponse(null, { status: 303, headers: { Location: `/signup/google${params.size ? `?${params}` : ""}` } });
      res.cookies.delete({ name: GOOGLE_FLOW_COOKIE, path: "/api/auth/google" });
      res.cookies.set(GOOGLE_PENDING_COOKIE, r.pending, { ...cookieOpts, maxAge: 1800 });
      return res;
    }
    const to = r.mfaRequired ? "/mfa" : flow.next || "/workspace";
    const res = new NextResponse(null, { status: 303, headers: { Location: to } });
    res.cookies.delete({ name: GOOGLE_FLOW_COOKIE, path: "/api/auth/google" });
    res.cookies.set(SESSION_COOKIE, r.token, { ...cookieOpts, maxAge: auth.SESSION_DAYS * 86_400 });
    return res;
  } catch (e) {
    console.error("google sign-in failed", e);
    return back("failed");
  }
}
