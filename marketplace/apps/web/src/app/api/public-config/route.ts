import { NextResponse } from "next/server";
import { env } from "@cm/config";

export const dynamic = "force-dynamic";

/** Runtime values public pages need in the browser (read at request time, so cPanel env changes apply after a restart). */
export function GET() {
  return NextResponse.json({ turnstileSiteKey: env().TURNSTILE_SITE_KEY || null }, { headers: { "Cache-Control": "public, max-age=300" } });
}
