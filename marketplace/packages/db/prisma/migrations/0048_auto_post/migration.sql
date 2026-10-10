-- Waiting drafts the clinic asked to post automatically once a provider is available.
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "autoPostWhenAvailable" BOOLEAN NOT NULL DEFAULT false;
