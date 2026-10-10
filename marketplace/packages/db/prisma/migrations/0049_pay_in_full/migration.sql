-- Overdue clinic payments: retries, notices, and charging in full at confirmation.
ALTER TABLE "ClinicOrg" ADD COLUMN IF NOT EXISTS "payInFull" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ClinicOrg" ADD COLUMN IF NOT EXISTS "payInFullSince" TIMESTAMPTZ(3);
ALTER TABLE "ClinicOrg" ADD COLUMN IF NOT EXISTS "payInFullReason" TEXT;
ALTER TABLE "ClinicOrg" ADD COLUMN IF NOT EXISTS "payInFullClearedAt" TIMESTAMPTZ(3);
ALTER TABLE "ClinicOrg" ADD COLUMN IF NOT EXISTS "payInFullClearedById" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "firstFailedAt" TIMESTAMPTZ(3);
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "retryCount" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "lastAttemptAt" TIMESTAMPTZ(3);
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "failureNotifiedAt" TIMESTAMPTZ(3);
CREATE INDEX IF NOT EXISTS "Payment_status_firstFailedAt_idx" ON "Payment"("status", "firstFailedAt");
-- Charges already failed before this update: the 48-hour clock starts now, and the clinic is told by the next sweep.
UPDATE "Payment" SET "firstFailedAt" = CURRENT_TIMESTAMP WHERE status = 'FAILED' AND "firstFailedAt" IS NULL;
