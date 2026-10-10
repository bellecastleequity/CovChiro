-- Rebilling failsafe: an admin can exclude a failed clinic charge from automatic collection.
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "collectionExcludedAt" TIMESTAMPTZ(3);
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "collectionExcludedById" TEXT;
ALTER TABLE "Payment" ADD COLUMN IF NOT EXISTS "collectionExcludedNote" TEXT;
