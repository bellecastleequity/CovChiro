import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@cm/services";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) await auth.destroySession(token);
  // Relative on purpose: behind cPanel/Passenger req.url is the internal
  // address (http://0.0.0.0:3000), which the browser can't open.
  const res = new NextResponse(null, { status: 303, headers: { Location: "/?signedout=1" } });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
