-- "Same provider for all days" on multi-day bookings: ask-then-split bookkeeping.
ALTER TABLE "ShiftGroup" ADD COLUMN IF NOT EXISTS "splitAskedAt" TIMESTAMPTZ(3);
ALTER TABLE "ShiftGroup" ADD COLUMN IF NOT EXISTS "splitAt" TIMESTAMPTZ(3);
ALTER TABLE "ShiftGroup" ADD COLUMN IF NOT EXISTS "splitBy" TEXT;
