-- Spam management: Spam folder flags on escalations and leads, and the blocked-sender list. Re-runnable.
ALTER TABLE "Escalation" ADD COLUMN IF NOT EXISTS "spamCategory" TEXT;
ALTER TABLE "Escalation" ADD COLUMN IF NOT EXISTS "spamReasons" TEXT[] DEFAULT ARRAY[]::TEXT[];
CREATE INDEX IF NOT EXISTS "Escalation_spamCategory_createdAt_idx" ON "Escalation"("spamCategory", "createdAt");

ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "spamCategory" TEXT;
ALTER TABLE "Lead" ADD COLUMN IF NOT EXISTS "spamReasons" TEXT[] DEFAULT ARRAY[]::TEXT[];

CREATE TABLE IF NOT EXISTS "BlockedSender" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "value" CITEXT NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BlockedSender_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BlockedSender_value_key" ON "BlockedSender"("value");
