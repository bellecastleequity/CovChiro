-- Open states gated by supply: drafts waiting for a doctor, and refused postings logged as demand.
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "waitingForProviderSince" TIMESTAMPTZ(3);
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "providerAvailableNotifiedAt" TIMESTAMPTZ(3);
CREATE INDEX IF NOT EXISTS "Shift_waitingForProviderSince_idx" ON "Shift"("waitingForProviderSince") WHERE "waitingForProviderSince" IS NOT NULL;

CREATE TABLE IF NOT EXISTS "PostingDemand" (
  "id" TEXT NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "clinicOrgId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "shiftId" TEXT,
  "professionCode" TEXT NOT NULL,
  "state" CHAR(2) NOT NULL,
  "city" TEXT NOT NULL,
  "zip" TEXT NOT NULL,
  "lat" DOUBLE PRECISION NOT NULL,
  "lng" DOUBLE PRECISION NOT NULL,
  "startsAt" TIMESTAMPTZ(3) NOT NULL,
  "gap" TEXT NOT NULL,
  "needed" INTEGER NOT NULL DEFAULT 1,
  "available" INTEGER NOT NULL DEFAULT 0,
  "nearby" INTEGER NOT NULL DEFAULT 0,
  "postedAt" TIMESTAMPTZ(3),
  CONSTRAINT "PostingDemand_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "PostingDemand_state_createdAt_idx" ON "PostingDemand"("state", "createdAt");
CREATE INDEX IF NOT EXISTS "PostingDemand_createdAt_idx" ON "PostingDemand"("createdAt");
