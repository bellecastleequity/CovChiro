import { execSync } from "node:child_process";
import path from "node:path";

/**
 * Recreates the throwaway test database, applies every migration (including
 * the invariant triggers) and seeds the launch configuration. Refuses to run
 * against anything whose name doesn't end in _test.
 */
export default async function setup() {
  const url = new URL(process.env.TEST_DATABASE_URL ?? "postgresql://cm:cm@localhost:5432/coverage_test");
  const dbName = url.pathname.slice(1);
  if (!dbName.endsWith("_test")) throw new Error(`Refusing to reset non-test database "${dbName}"`);
  const admin = new URL(url);
  admin.pathname = "/postgres";
  const psql = (sql: string) => execSync(`psql "${admin}" -v ON_ERROR_STOP=1 -q -c "${sql}"`, { stdio: "pipe" });
  psql(`DROP DATABASE IF EXISTS ${dbName} WITH (FORCE)`);
  psql(`CREATE DATABASE ${dbName}`);
  const dbDir = path.resolve(__dirname, "../packages/db");
  const env = { ...process.env, DATABASE_URL: url.toString() };
  execSync("npx prisma migrate deploy", { cwd: dbDir, env, stdio: "pipe" });
  execSync("npx tsx -e \"import('./prisma/seedData.ts').then(async m => { const { PrismaClient } = await import('@prisma/client'); const p = new PrismaClient(); await m.seedBase(p); await p.\\$disconnect(); })\"", { cwd: dbDir, env, stdio: "pipe" });
}
