import type { PrismaClient } from "@prisma/client";

/**
 * Every migration this build expects, in order. A test keeps it in step with
 * prisma/migrations. The admin area warns when the database is missing any
 * (on cPanel that means an update-NNN.sql file hasn't been run in Neon yet).
 */
export const EXPECTED_MIGRATIONS = [
  "0001_init",
  "0002_invariants",
  "0003_national_credentials_digests",
  "0004_personal_injury_experience",
  "0005_admin_approval",
  "0006_attendance",
] as const;

/** Migrations the connected database hasn't applied yet (empty = up to date). */
export async function missingMigrations(db: PrismaClient): Promise<string[]> {
  try {
    const rows = await db.$queryRawUnsafe<{ name: string }[]>(`SELECT migration_name::text AS name FROM "_prisma_migrations" WHERE finished_at IS NOT NULL AND rolled_back_at IS NULL`);
    const have = new Set(rows.map((r) => r.name));
    return EXPECTED_MIGRATIONS.filter((m) => !have.has(m));
  } catch {
    return [];
  }
}
