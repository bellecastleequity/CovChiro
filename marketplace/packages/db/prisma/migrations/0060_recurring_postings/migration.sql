-- Recurring open postings: a weekly pattern posted as ordinary open shifts a few weeks ahead.
CREATE TABLE IF NOT EXISTS "RecurringPosting" (
  "id" TEXT NOT NULL,
  "clinicOrgId" TEXT NOT NULL,
  "locationId" TEXT NOT NULL,
  "professionCode" TEXT NOT NULL,
  "weekdays" INTEGER[],
  "startTime" TEXT NOT NULL,
  "endTime" TEXT NOT NULL,
  "lunchMinutes" INTEGER NOT NULL DEFAULT 0,
  "lunchStartTime" TEXT,
  "expectedPatients" INTEGER,
  "minYearsExperience" INTEGER,
  "notes" TEXT,
  "startsOn" DATE NOT NULL,
  "endsOn" DATE,
  "preferLastProvider" BOOLEAN NOT NULL DEFAULT true,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "createdById" TEXT NOT NULL,
  "generatedThrough" DATE,
  "lastError" TEXT,
  "lastErrorAt" TIMESTAMPTZ(3),
  "endedAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "RecurringPosting_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "RecurringPosting_clinicOrgId_status_idx" ON "RecurringPosting"("clinicOrgId", "status");

ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "recurringPostingId" TEXT;
CREATE INDEX IF NOT EXISTS "Shift_recurringPostingId_idx" ON "Shift"("recurringPostingId");
DO $$ BEGIN
  ALTER TABLE "Shift" ADD CONSTRAINT "Shift_recurringPostingId_fkey" FOREIGN KEY ("recurringPostingId") REFERENCES "RecurringPosting"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
