-- "Recruit a colleague" links for a shift (/s/<token>) and who signed up through them. Re-runnable.
CREATE TABLE IF NOT EXISTS "ShiftRecruitLink" (
    "id" TEXT NOT NULL,
    "token" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "createdById" TEXT,
    "label" TEXT,
    "views" INTEGER NOT NULL DEFAULT 0,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShiftRecruitLink_pkey" PRIMARY KEY ("id")
);
CREATE TABLE IF NOT EXISTS "ShiftRecruitClaim" (
    "id" TEXT NOT NULL,
    "linkId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "invitedAt" TIMESTAMPTZ(3),
    "offerId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShiftRecruitClaim_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ShiftRecruitLink_token_key" ON "ShiftRecruitLink"("token");
CREATE INDEX IF NOT EXISTS "ShiftRecruitLink_shiftId_idx" ON "ShiftRecruitLink"("shiftId");
CREATE INDEX IF NOT EXISTS "ShiftRecruitClaim_providerId_idx" ON "ShiftRecruitClaim"("providerId");
CREATE UNIQUE INDEX IF NOT EXISTS "ShiftRecruitClaim_linkId_providerId_key" ON "ShiftRecruitClaim"("linkId", "providerId");
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShiftRecruitLink_shiftId_fkey') THEN
    ALTER TABLE "ShiftRecruitLink" ADD CONSTRAINT "ShiftRecruitLink_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShiftRecruitClaim_linkId_fkey') THEN
    ALTER TABLE "ShiftRecruitClaim" ADD CONSTRAINT "ShiftRecruitClaim_linkId_fkey" FOREIGN KEY ("linkId") REFERENCES "ShiftRecruitLink"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ShiftRecruitClaim_providerId_fkey') THEN
    ALTER TABLE "ShiftRecruitClaim" ADD CONSTRAINT "ShiftRecruitClaim_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
