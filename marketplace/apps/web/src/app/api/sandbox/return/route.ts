import { NextResponse } from "next/server";
import { cookies } from "next/headers";
import { isSandbox } from "@cm/config";
import { auth } from "@cm/services";
import { SESSION_COOKIE, setSessionCookie } from "@/lib/session";

const ADMIN_RETURN_COOKIE = "cm_sandbox_admin";

/** Test site: leave the demo account you opened with "Act as" and return to your admin session. */
export async function GET() {
  if (!isSandbox()) return new NextResponse("Not found", { status: 404 });
  const jar = await cookies();
  const back = jar.get(ADMIN_RETURN_COOKIE)?.value;
  const demo = jar.get(SESSION_COOKIE)?.value;
  const admin = back ? await auth.sessionFromToken(back) : null;
  if (!admin || admin.user.role !== "PLATFORM_ADMIN") {
    // Nothing to return to (the 12-hour return cookie ran out or that admin session ended). Sign the demo
    // account out first: sent to /admin while still signed in as a demo provider, the admin area would just
    // bounce back to /provider.
    if (demo) await auth.destroySession(demo).catch(() => undefined);
    jar.delete(SESSION_COOKIE);
    jar.delete(ADMIN_RETURN_COOKIE);
    return new NextResponse(null, { status: 303, headers: { Location: "/login?next=%2Fadmin%2Fsandbox" } });
  }
  if (demo && demo !== back) await auth.destroySession(demo).catch(() => undefined);
  await setSessionCookie(back!);
  jar.delete(ADMIN_RETURN_COOKIE);
  // Relative: behind Passenger req.url is the internal address.
  return new NextResponse(null, { status: 303, headers: { Location: "/admin/sandbox" } });
}
