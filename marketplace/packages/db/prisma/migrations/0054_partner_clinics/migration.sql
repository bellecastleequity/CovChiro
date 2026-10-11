-- Partner clinic program: partnerships (offered → signed/active → ended) and the partner share of
-- each shift's / booking's margin-funded discount. Re-runnable.
DO $$ BEGIN
  CREATE TYPE "PartnershipStatus" AS ENUM ('OFFERED', 'ACTIVE', 'ENDED', 'WITHDRAWN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ClinicPartnership" (
  "id" TEXT NOT NULL,
  "clinicOrgId" TEXT NOT NULL,
  "status" "PartnershipStatus" NOT NULL DEFAULT 'OFFERED',
  "discountPercent" INTEGER NOT NULL,
  "termMonths" INTEGER NOT NULL,
  "releaseHours" INTEGER NOT NULL,
  "noticeDays" INTEGER NOT NULL,
  "offeredById" TEXT,
  "offeredAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "startsAt" TIMESTAMPTZ(3),
  "endedAt" TIMESTAMPTZ(3),
  "endedById" TEXT,
  "endReason" TEXT,
  "signerUserId" TEXT,
  "typedSignature" TEXT,
  "signerTitle" TEXT,
  "signerEmail" TEXT,
  "signerIp" TEXT,
  "signerAgent" TEXT,
  "consentAt" TIMESTAMPTZ(3),
  "document" JSONB,
  "documentText" TEXT,
  "documentHash" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "ClinicPartnership_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ClinicPartnership_clinicOrgId_status_idx" ON "ClinicPartnership"("clinicOrgId", "status");
DO $$ BEGIN
  ALTER TABLE "ClinicPartnership" ADD CONSTRAINT "ClinicPartnership_clinicOrgId_fkey" FOREIGN KEY ("clinicOrgId") REFERENCES "ClinicOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "partnerDiscountCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "partnershipId" TEXT;
CREATE INDEX IF NOT EXISTS "Shift_partnershipId_idx" ON "Shift"("partnershipId");
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "partnerDiscountCents" INTEGER NOT NULL DEFAULT 0;
