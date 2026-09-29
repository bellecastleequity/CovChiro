import { NextResponse, type NextRequest } from "next/server";
import { auth } from "@cm/services";
import { SESSION_COOKIE } from "@/lib/session";

export async function POST(req: NextRequest) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) await auth.destroySession(token);
  const res = NextResponse.redirect(new URL("/", req.url), { status: 303 });
  res.cookies.delete(SESSION_COOKIE);
  return res;
}
