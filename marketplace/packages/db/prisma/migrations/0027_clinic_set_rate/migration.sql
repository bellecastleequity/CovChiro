-- Clinic-set rate (beta): a clinic's own lower price, release-to-market time and the receipt of the terms. Re-runnable.
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "rateMode" TEXT NOT NULL DEFAULT 'MARKET';
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "marketClinicPriceCents" INTEGER;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "marketProviderPayCents" INTEGER;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "releaseOnUnfilled" BOOLEAN;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "releaseHours" INTEGER;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "releaseAt" TIMESTAMPTZ(3);
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "releasedAt" TIMESTAMPTZ(3);
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "rateTerms" JSONB;
CREATE INDEX IF NOT EXISTS "Shift_rateMode_releaseAt_idx" ON "Shift"("rateMode", "releaseAt");
