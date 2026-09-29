import { PrismaClient } from "@prisma/client";

export { Prisma, PrismaClient } from "@prisma/client";
export type * from "@prisma/client";

const g = globalThis as unknown as { __cmPrisma?: PrismaClient };

/** One client per process (Next.js dev hot-reload safe). */
export const prisma: PrismaClient = g.__cmPrisma ?? new PrismaClient({ log: process.env.PRISMA_LOG ? ["query", "warn", "error"] : ["warn", "error"] });
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
