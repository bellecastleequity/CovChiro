import { neonConfig } from "@neondatabase/serverless";
import { PrismaNeon } from "@prisma/adapter-neon";
import { PrismaClient } from "@prisma/client";

export { Prisma, PrismaClient } from "@prisma/client";
export type * from "@prisma/client";

type AdapterFactory = NonNullable<ConstructorParameters<typeof PrismaClient>[0]>["adapter"];
const g = globalThis as unknown as { __cmPrisma?: PrismaClient; __cmPrismaAdapter?: AdapterFactory };

/**
 * How the app reaches Postgres:
 * - default: direct TCP on the URL's port (5432);
 * - DATABASE_TRANSPORT=websocket: Neon's WebSocket proxy over HTTPS port 443,
 *   for hosts whose firewall blocks outgoing 5432 (e.g. shared cPanel);
 * - tests may inject any driver adapter via globalThis.__cmPrismaAdapter.
 */
function driverAdapter(): AdapterFactory | undefined {
  if (g.__cmPrismaAdapter) return g.__cmPrismaAdapter;
  if (process.env.DATABASE_TRANSPORT !== "websocket") return undefined;
  if (typeof globalThis.WebSocket !== "function") throw new Error("DATABASE_TRANSPORT=websocket needs Node.js 22 or newer (built-in WebSocket).");
  neonConfig.webSocketConstructor = globalThis.WebSocket;
  return new PrismaNeon({ connectionString: process.env.DATABASE_URL });
}

/** One client per process (Next.js dev hot-reload safe). */
export const prisma: PrismaClient =
  g.__cmPrisma ?? new PrismaClient({ adapter: driverAdapter() ?? null, log: process.env.PRISMA_LOG ? ["query", "warn", "error"] : ["warn", "error"] });
if (process.env.NODE_ENV !== "production") g.__cmPrisma = prisma;

export type Tx = Omit<PrismaClient, "$connect" | "$disconnect" | "$on" | "$transaction" | "$use" | "$extends">;

/** Postgres check_violation / exclusion_violation raised by our invariant triggers and constraints. */
export function isInvariantViolation(e: unknown): { message: string } | null {
  const msg = e instanceof Error ? e.message : String(e);
  if (/INV-\d|SCOPE:|no_provider_overlap|one_live_assignment_per_shift|check_violation|exclusion constraint|violates check constraint/i.test(msg)) {
    const m = msg.match(/(INV-\d[^\n"]*|SCOPE:[^\n"]*|no_provider_overlap|one_live_assignment_per_shift)/);
    return { message: m ? m[1] : msg };
  }
  return null;
}
export { seedBase } from "../prisma/seedData";
export { EXPECTED_MIGRATIONS, missingMigrations } from "./migrations";
