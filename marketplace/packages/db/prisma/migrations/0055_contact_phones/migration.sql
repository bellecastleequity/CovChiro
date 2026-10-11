-- Phone numbers on file: clinics keep two different numbers (main + second) for our team only. Re-runnable.
ALTER TABLE "ClinicOrg" ADD COLUMN IF NOT EXISTS "backupPhone" TEXT;
