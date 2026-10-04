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
  "0007_emergency_cover",
  "0008_provider_feedback",
  "0009_standing_esign_moderation",
  "0010_pre_licensure",
  "0011_growth",
  "0012_prospecting",
  "0013_blog",
  "0014_growth_expansion",
  "0015_provider_acquisition",
  "0016_linked_transfers",
  "0017_spam",
  "0018_referrals",
  "0019_timeclock",
  "0020_backups",
  "0021_push_calendar",
  "0022_volume_pricing",
  "0023_support",
  "0024_shift_recruit",
  "0025_instagram_follow",
  "0026_shift_changes",
  "0027_clinic_set_rate",
  "0028_sandbox",
  "0029_sandbox_reports",
  "0030_shift_lunch",
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
