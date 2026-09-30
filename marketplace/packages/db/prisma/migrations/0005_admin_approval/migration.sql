-- Admin can push a provider or clinic through onboarding at any stage.
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "adminApprovedAt" TIMESTAMPTZ(3);
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "adminApprovedById" TEXT;
ALTER TABLE "ClinicOrg" ADD COLUMN IF NOT EXISTS "adminApprovedAt" TIMESTAMPTZ(3);
ALTER TABLE "ClinicOrg" ADD COLUMN IF NOT EXISTS "adminApprovedById" TEXT;
