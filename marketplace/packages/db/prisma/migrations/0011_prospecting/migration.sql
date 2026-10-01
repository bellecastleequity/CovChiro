-- Automatic prospecting: registry dedupe key + NPIs, AI web-research status and cited sources. Re-runnable.
-- AlterTable
ALTER TABLE "ClinicProspect" ADD COLUMN IF NOT EXISTS "addressKey" TEXT,
ADD COLUMN IF NOT EXISTS "nameFromRegistry" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "npis" TEXT[] DEFAULT ARRAY[]::TEXT[],
ADD COLUMN IF NOT EXISTS "researchAttempts" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "researchConfidence" DOUBLE PRECISION,
ADD COLUMN IF NOT EXISTS "researchStatus" TEXT NOT NULL DEFAULT 'PENDING',
ADD COLUMN IF NOT EXISTS "researchedAt" TIMESTAMPTZ(3),
ADD COLUMN IF NOT EXISTS "sourceUrls" TEXT[] DEFAULT ARRAY[]::TEXT[];

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ClinicProspect_addressKey_key" ON "ClinicProspect"("addressKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClinicProspect_researchStatus_idx" ON "ClinicProspect"("researchStatus");
