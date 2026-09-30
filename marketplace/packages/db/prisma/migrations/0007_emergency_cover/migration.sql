-- Emergency cover for no-shows and late cancellations, and clinic "Provider arrived".
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "emergencyAt" TIMESTAMPTZ(3);
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "emergencySource" TEXT;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "emergencyReason" TEXT;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "emergencyBonusPercent" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "emergencyBasePayCents" INTEGER;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "rescueOfShiftId" TEXT;
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "arrivedAt" TIMESTAMPTZ(3);
CREATE INDEX IF NOT EXISTS "Shift_emergencyAt_idx" ON "Shift" ("emergencyAt") WHERE "emergencyAt" IS NOT NULL;
