-- Referral program: personal codes and two-sided rewards after the invited person's first shift. Re-runnable.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "referralCode" CITEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_referralCode_key" ON "User"("referralCode");

CREATE TABLE IF NOT EXISTS "Referral" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "referrerUserId" TEXT NOT NULL,
    "refereeUserId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'PENDING',
    "flagReasons" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "qualifyingAssignmentId" TEXT,
    "qualifiedAt" TIMESTAMPTZ(3),
    "rewardedAt" TIMESTAMPTZ(3),
    "referrerRewardCents" INTEGER NOT NULL DEFAULT 0,
    "refereeRewardCents" INTEGER NOT NULL DEFAULT 0,
    "referrerPayoutId" TEXT,
    "refereePayoutId" TEXT,
    "referrerCreditCode" TEXT,
    "refereeCreditCode" TEXT,
    "decidedById" TEXT,
    "note" TEXT,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Referral_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Referral_refereeUserId_key" ON "Referral"("refereeUserId");
CREATE INDEX IF NOT EXISTS "Referral_status_idx" ON "Referral"("status");
CREATE INDEX IF NOT EXISTS "Referral_referrerUserId_idx" ON "Referral"("referrerUserId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Referral_referrerUserId_fkey') THEN
    ALTER TABLE "Referral" ADD CONSTRAINT "Referral_referrerUserId_fkey" FOREIGN KEY ("referrerUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Referral_refereeUserId_fkey') THEN
    ALTER TABLE "Referral" ADD CONSTRAINT "Referral_refereeUserId_fkey" FOREIGN KEY ("refereeUserId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
