-- Provider tax info status (read from Stripe; no tax ID is stored) and the Stripe account type to create.
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "taxEntity" TEXT NOT NULL DEFAULT 'INDIVIDUAL';
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "taxInfoStatus" TEXT NOT NULL DEFAULT 'UNKNOWN';
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "taxCheckedAt" TIMESTAMPTZ(3);
