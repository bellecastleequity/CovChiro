-- Provider "Taking a break": no new shifts from breakStartsAt until breakEndsAt. Re-runnable.
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "breakStartsAt" TIMESTAMPTZ(3);
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "breakEndsAt" TIMESTAMPTZ(3);
