-- Unpaid lunch on shifts. Existing shifts get none, so their prices are unchanged. Re-runnable.
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "lunchMinutes" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "lunchStartsAt" TIMESTAMPTZ(3);
