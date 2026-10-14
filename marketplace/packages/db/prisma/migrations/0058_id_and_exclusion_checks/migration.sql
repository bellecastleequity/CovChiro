-- Photo ID check (Stripe Identity; outcome only) and federal exclusion list checks. Re-runnable.
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "idStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "idSessionId" TEXT;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "idAttempts" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "idVerifiedAt" TIMESTAMPTZ(3);
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "idNote" TEXT;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "idReviewedById" TEXT;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "exclusionStatus" TEXT NOT NULL DEFAULT 'UNCHECKED';
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "exclusionCheckedAt" TIMESTAMPTZ(3);
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "exclusionNote" TEXT;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "exclusionMatchKey" TEXT;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "exclusionClearedKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "idDueAt" TIMESTAMPTZ(3);
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "idRemindedAt" TIMESTAMPTZ(3);
CREATE INDEX IF NOT EXISTS "Assignment_idDueAt_idx" ON "Assignment"("idDueAt") WHERE "idDueAt" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "ExclusionRecord" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "lastName" TEXT NOT NULL,
  "firstName" TEXT NOT NULL,
  "middleName" TEXT NOT NULL DEFAULT '',
  "businessName" TEXT NOT NULL DEFAULT '',
  "npi" TEXT,
  "state" TEXT,
  "specialty" TEXT NOT NULL DEFAULT '',
  "exclType" TEXT NOT NULL DEFAULT '',
  "exclDate" TEXT,
  "nameKey" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ExclusionRecord_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ExclusionRecord_npi_idx" ON "ExclusionRecord"("npi");
CREATE INDEX IF NOT EXISTS "ExclusionRecord_nameKey_idx" ON "ExclusionRecord"("nameKey");
CREATE INDEX IF NOT EXISTS "ExclusionRecord_source_idx" ON "ExclusionRecord"("source");
