import { prisma } from "@cm/db";
import { JOBS, jobByName } from "./jobs";

/** Run one or all sweeps once and exit: `pnpm --filter @cm/worker once [jobName...]`. */
const names = process.argv.slice(2);
for (const n of names) if (!jobByName.has(n)) throw new Error(`Unknown job ${n}. Known: ${JOBS.map((j) => j.name).join(", ")}`);
for (const j of names.length ? names.map((n) => jobByName.get(n)!) : JOBS) {
  const result = await j.run();
  console.log(j.name, JSON.stringify(result));
}
await prisma.$disconnect();
