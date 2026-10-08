-- Clinic ownership verification. Clinics already on the platform get 30 days (Setting clinicVerify.graceDays) to verify.
ALTER TABLE "ClinicOrg" ADD COLUMN IF NOT EXISTS "verificationStatus" TEXT NOT NULL DEFAULT 'NOT_STARTED';
ALTER TABLE "ClinicOrg" ADD COLUMN IF NOT EXISTS "verifiedAt" TIMESTAMPTZ(3);
ALTER TABLE "ClinicOrg" ADD COLUMN IF NOT EXISTS "verifiedUntil" TIMESTAMPTZ(3);
ALTER TABLE "ClinicOrg" ADD COLUMN IF NOT EXISTS "verificationGraceUntil" TIMESTAMPTZ(3);
ALTER TABLE "ClinicOrg" ADD COLUMN IF NOT EXISTS "verificationNote" TEXT;

CREATE TABLE IF NOT EXISTS "ClinicVerification" (
  "id" TEXT NOT NULL,
  "clinicOrgId" TEXT NOT NULL,
  "status" TEXT NOT NULL DEFAULT 'PENDING',
  "autoApproved" BOOLEAN NOT NULL DEFAULT false,
  "entityName" TEXT NOT NULL,
  "entityState" TEXT NOT NULL,
  "entityNumber" TEXT NOT NULL,
  "orgNpi" TEXT,
  "owners" JSONB NOT NULL,
  "facilityLicenseNumber" TEXT,
  "facilityExemptionNumber" TEXT,
  "documentKeys" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[],
  "attestName" TEXT NOT NULL,
  "attestText" TEXT NOT NULL,
  "attestIp" TEXT,
  "submittedById" TEXT,
  "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "checks" JSONB NOT NULL,
  "decidedAt" TIMESTAMPTZ(3),
  "decidedById" TEXT,
  "decisionNote" TEXT,
  CONSTRAINT "ClinicVerification_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ClinicVerification_status_idx" ON "ClinicVerification"("status");
CREATE INDEX IF NOT EXISTS "ClinicVerification_clinicOrgId_submittedAt_idx" ON "ClinicVerification"("clinicOrgId", "submittedAt");
DO $$ BEGIN
  ALTER TABLE "ClinicVerification" ADD CONSTRAINT "ClinicVerification_clinicOrgId_fkey" FOREIGN KEY ("clinicOrgId") REFERENCES "ClinicOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Existing clinics: grace period from install.
UPDATE "ClinicOrg" SET "verificationGraceUntil" = CURRENT_TIMESTAMP + INTERVAL '30 days'
WHERE "verificationGraceUntil" IS NULL AND "verificationStatus" = 'NOT_STARTED';
