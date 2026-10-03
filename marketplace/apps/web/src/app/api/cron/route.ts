import { timingSafeEqual } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import { env } from "@cm/config";
import { jobByName, jobsDueAt, runJobs } from "@cm/services";

/**
 * External once-a-minute tick for hosts without an always-on worker (cPanel
 * cron, Cloud Scheduler). Runs whatever background sweeps are due now; every
 * sweep is idempotent, so a duplicate or missed tick is harmless.
 *   curl -fsS --max-time 50 -H "Authorization: Bearer $CRON_SECRET" https://<domain>/api/cron
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
  if (names) {
    // Named jobs (manual checks): wait and report.
    const jobs = names.split(",").map((n) => jobByName.get(n.trim())).filter((j) => !!j);
    const results = await runJobs(jobs, { background: true });
    const failed = results.filter((r) => !r.ok);
    return NextResponse.json({ ran: results.length, failed: failed.length, results }, { status: failed.length ? 500 : 200 });
  }
  // Scheduled tick: answer at once and run in the background, and never start a second tick while
  // the last one is still going. Each waiting request keeps a web-server process busy, and on shared
  // hosting those count against the account's process limit.
  const g = globalThis as { __cmCronBusySince?: number };
  if (g.__cmCronBusySince && Date.now() - g.__cmCronBusySince < 15 * 60_000) {
    return NextResponse.json({ skipped: "previous tick still running", since: new Date(g.__cmCronBusySince).toISOString() }, { status: 202 });
  }
  g.__cmCronBusySince = Date.now();
  const jobs = jobsDueAt(new Date());
  void runJobs(jobs, { background: true })
    .then((results) => {
      const failed = results.filter((r) => !r.ok);
      if (failed.length) console.error(JSON.stringify({ msg: "cron.failed", failed }));
    })
    .catch((e) => console.error(JSON.stringify({ msg: "cron.crashed", error: String(e) })))
    .finally(() => {
      g.__cmCronBusySince = 0;
    });
  return NextResponse.json({ started: jobs.length, jobs: jobs.map((j) => j.name) }, { status: 202 });
}

export const GET = handle;
export const POST = handle;
