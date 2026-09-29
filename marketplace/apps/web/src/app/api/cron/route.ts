import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@cm/config";
import { jobByName, jobsDueAt, runJobs } from "@cm/services";

/**
 * External once-a-minute tick for hosts without an always-on worker (cPanel
 * cron, Cloud Scheduler). Runs whatever background sweeps are due now; every
 * sweep is idempotent, so a duplicate or missed tick is harmless.
 *   curl -fsS -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron
 * `?jobs=a,b` runs specific jobs instead.
 */
export const dynamic = "force-dynamic";

function authorized(req: NextRequest, secret: string) {
  const given = req.headers.get("authorization")?.replace(/^Bearer\s+/i, "") ?? req.nextUrl.searchParams.get("key") ?? "";
  const a = Buffer.from(given);
  const b = Buffer.from(secret);
  return a.length === b.length && timingSafeEqual(a, b);
}

async function handle(req: NextRequest) {
  const secret = env().CRON_SECRET;
  if (!secret || secret.length < 16) return new NextResponse("Not found", { status: 404 });
  if (!authorized(req, secret)) return new NextResponse("Unauthorized", { status: 401 });
  const names = req.nextUrl.searchParams.get("jobs");
  const jobs = names ? names.split(",").map((n) => jobByName.get(n.trim())).filter((j) => !!j) : jobsDueAt(new Date());
  const results = await runJobs(jobs);
  const failed = results.filter((r) => !r.ok);
  if (failed.length) console.error(JSON.stringify({ msg: "cron.failed", failed }));
  return NextResponse.json({ ran: results.length, failed: failed.length, results }, { status: failed.length ? 500 : 200 });
}

export const GET = handle;
export const POST = handle;
