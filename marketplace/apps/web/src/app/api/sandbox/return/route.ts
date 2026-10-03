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
    // Nothing to return to: go to the admin area (it asks to sign in if needed).
    return new NextResponse(null, { status: 303, headers: { Location: "/admin/sandbox" } });
  }
  if (demo && demo !== back) await auth.destroySession(demo).catch(() => undefined);
  await setSessionCookie(back!);
  jar.delete(ADMIN_RETURN_COOKIE);
  // Relative: behind Passenger req.url is the internal address.
  return new NextResponse(null, { status: 303, headers: { Location: "/admin/sandbox" } });
}
