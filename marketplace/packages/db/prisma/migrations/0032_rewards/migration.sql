-- Rewards points history (providers and clinics). Re-runnable.
CREATE TABLE IF NOT EXISTS "RewardEvent" (
  "id" TEXT NOT NULL,
  "accountType" TEXT NOT NULL,
  "accountId" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "points" INTEGER NOT NULL,
  "refKey" TEXT NOT NULL,
  "note" TEXT,
  "createdById" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "RewardEvent_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RewardEvent_refKey_key" ON "RewardEvent"("refKey");
CREATE INDEX IF NOT EXISTS "RewardEvent_accountType_accountId_createdAt_idx" ON "RewardEvent"("accountType", "accountId", "createdAt");
CREATE INDEX IF NOT EXISTS "RewardEvent_accountType_createdAt_idx" ON "RewardEvent"("accountType", "createdAt");
