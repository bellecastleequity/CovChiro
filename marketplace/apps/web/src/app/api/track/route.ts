import { randomBytes } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { track } from "@cm/services";
import { getSession } from "@/lib/session";

const ALLOWED = new Set(["PAGE_VIEW", "CTA_CLICK"]);

export async function POST(req: NextRequest) {
  let body: Record<string, any> = {};
  try {
    body = JSON.parse(await req.text());
  } catch {
    return new NextResponse(null, { status: 204 });
  }
  if (!ALLOWED.has(body.type)) return new NextResponse(null, { status: 204 });
  if (/bot|crawl|spider|slurp|preview/i.test(req.headers.get("user-agent") ?? "")) return new NextResponse(null, { status: 204 });
  let vid = req.cookies.get("cm_vid")?.value;
  const res = new NextResponse(null, { status: 204 });
  if (!vid || !/^[a-f0-9]{24}$/.test(vid)) {
    vid = randomBytes(12).toString("hex");
    res.cookies.set("cm_vid", vid, { httpOnly: true, sameSite: "lax", secure: process.env.NODE_ENV === "production", path: "/", maxAge: 365 * 86_400 });
  }
  const s = await getSession();
  await track({ type: body.type, path: String(body.path ?? "").slice(0, 300), referrer: body.referrer, visitorId: vid, userId: s?.user.id ?? null, utm: body.utm, props: body.props });
  return res;
}
