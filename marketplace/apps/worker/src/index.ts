import { createServer } from "node:http";
import { Queue, Worker } from "bullmq";
import { Redis } from "ioredis";
import { assertProductionEnv, env } from "@cm/config";
import { prisma } from "@cm/db";
import { JOBS, jobByName } from "./jobs";

/**
 * Background worker. With REDIS_URL set it registers every sweep as a BullMQ
 * job scheduler (one queue, repeatable jobs, single execution per tick across
 * replicas). Without Redis (local dev) it falls back to in-process timers.
 * A tiny HTTP server answers health checks so it can run on Cloud Run with
 * min-instances=1 and CPU always allocated.
 */
const QUEUE = "sweeps";
const log = (msg: string, extra: Record<string, unknown> = {}) => console.log(JSON.stringify({ t: new Date().toISOString(), msg, ...extra }));

async function runJob(name: string) {
  const job = jobByName.get(name);
  if (!job) throw new Error(`Unknown job ${name}`);
  const started = Date.now();
  const result = await job.run();
  const ms = Date.now() - started;
  if (ms > 1000 || (result && typeof result === "object" && Object.values(result).some((v) => typeof v === "number" && v > 0)) || (typeof result === "number" && result > 0)) {
    log("job.done", { job: name, ms, result });
  }
  return result;
}

async function withRedis(url: string) {
  const queue = new Queue(QUEUE, { connection: new Redis(url, { maxRetriesPerRequest: null }) });
  // Drop schedulers that no longer exist in JOBS.
  const existing = await queue.getJobSchedulers();
  for (const s of existing) if (s.key && !jobByName.has(s.key)) await queue.removeJobScheduler(s.key);
  for (const j of JOBS) {
    const repeat = "everySeconds" in j.schedule ? { every: j.schedule.everySeconds * 1000 } : { pattern: j.schedule.cron, tz: j.schedule.tz };
    await queue.upsertJobScheduler(j.name, repeat, { name: j.name, opts: { removeOnComplete: 100, removeOnFail: 500, attempts: 3, backoff: { type: "exponential", delay: 5000 } } });
  }
  const worker = new Worker(QUEUE, (job) => runJob(job.name), { connection: new Redis(url, { maxRetriesPerRequest: null }), concurrency: 4 });
  worker.on("failed", (job, err) => log("job.failed", { job: job?.name, attempt: job?.attemptsMade, error: err.message }));
  log("worker.started", { mode: "bullmq", jobs: JOBS.length });
  return async () => {
    await worker.close();
    await queue.close();
  };
}

function withTimers() {
  const running = new Set<string>();
  const timers: NodeJS.Timeout[] = [];
  const fire = (name: string) => {
    if (running.has(name)) return;
    running.add(name);
    runJob(name)
      .catch((err) => log("job.failed", { job: name, error: (err as Error).message }))
      .finally(() => running.delete(name));
  };
  for (const j of JOBS) {
    if ("everySeconds" in j.schedule) timers.push(setInterval(() => fire(j.name), j.schedule.everySeconds * 1000));
    else {
      // Dev fallback for cron jobs: once an hour, only runs during the 2 AM ET hour.
      const { tz } = j.schedule;
      const hour = Number(j.schedule.cron.split(" ")[1]);
      timers.push(setInterval(() => {
        const h = Number(new Intl.DateTimeFormat("en-US", { hour: "numeric", hourCycle: "h23", timeZone: tz }).format(new Date()));
        if (h === hour) fire(j.name);
      }, 3_600_000));
    }
  }
  log("worker.started", { mode: "timers", jobs: JOBS.length });
  return async () => timers.forEach(clearInterval);
}

async function main() {
  const e = env();
  assertProductionEnv(e, { worker: true });
  const stop = e.REDIS_URL ? await withRedis(e.REDIS_URL) : withTimers();
  const server = createServer((_req, res) => {
    res.writeHead(200, { "content-type": "text/plain" });
    res.end("ok");
  }).listen(Number(process.env.PORT ?? 8081));
  const shutdown = async () => {
    log("worker.stopping");
    server.close();
    await stop();
    await prisma.$disconnect();
    process.exit(0);
  };
  process.on("SIGTERM", shutdown);
  process.on("SIGINT", shutdown);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
