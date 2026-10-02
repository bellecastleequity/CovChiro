import { NextResponse } from "next/server";
import { push } from "@cm/services";
import { getSession } from "@/lib/session";

export const dynamic = "force-dynamic";

/** For the service worker: the newest unread notification (title, body, link). */
export async function GET() {
  const s = await getSession();
  if (!s) return NextResponse.json({ notification: null }, { status: 401 });
  return NextResponse.json({ notification: await push.latestForUser(s.user.id) }, { headers: { "Cache-Control": "no-store" } });
}
