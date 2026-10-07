-- Provider active status: inactivity pauses + "I'm still available" taps. Everyone's clock starts now. Re-runnable.
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "breakReason" TEXT;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "activeConfirmedAt" TIMESTAMPTZ(3);
UPDATE "Provider" SET "activeConfirmedAt" = now() WHERE "activeConfirmedAt" IS NULL;
