import { NextResponse } from "next/server";
import { health } from "@cm/services";

/**
 * Public watchdog for an uptime monitor (e.g. UptimeRobot, every 5 minutes):
 * 200 = fine or warnings, 503 = a critical problem or the site can't reach its
 * database. Only check names are returned, never details. Each call also runs
 * the health checks (at most every ~4 minutes), so alert emails still go out
 * when the background cron itself has stopped.
 */
export const dynamic = "force-dynamic";

export async function GET() {
  try {
    const s = await health.healthSummary();
    return NextResponse.json(s, { status: s.status === "critical" ? 503 : 200, headers: { "Cache-Control": "no-store" } });
  } catch {
    return NextResponse.json({ status: "critical", checks: ["app"] }, { status: 503, headers: { "Cache-Control": "no-store" } });
  }
}
