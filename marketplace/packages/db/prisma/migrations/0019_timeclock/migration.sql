-- Time clock: punches (in / lunch / out) and the day's timesheet with the clinic's sign-off. Re-runnable.
CREATE TABLE IF NOT EXISTS "TimePunch" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "at" TIMESTAMPTZ(3) NOT NULL,
    "source" TEXT NOT NULL DEFAULT 'LIVE',
    "note" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "accuracyM" INTEGER,
    "distanceMiles" DOUBLE PRECISION,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "TimePunch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TimePunch_assignmentId_at_idx" ON "TimePunch"("assignmentId", "at");

CREATE TABLE IF NOT EXISTS "Timesheet" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "workedMinutes" INTEGER NOT NULL DEFAULT 0,
    "breakMinutes" INTEGER NOT NULL DEFAULT 0,
    "firstIn" TIMESTAMPTZ(3),
    "lastOut" TIMESTAMPTZ(3),
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "providerNote" TEXT,
    "submittedAt" TIMESTAMPTZ(3),
    "approvalMethod" TEXT,
    "approvedAt" TIMESTAMPTZ(3),
    "approvedByUserId" TEXT,
    "approverName" TEXT,
    "approverTitle" TEXT,
    "signature" TEXT,
    "approverIp" TEXT,
    "approverDevice" TEXT,
    "clinicNote" TEXT,
    "disputeId" TEXT,
    "remindedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "Timesheet_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "Timesheet_assignmentId_key" ON "Timesheet"("assignmentId");
CREATE INDEX IF NOT EXISTS "Timesheet_status_submittedAt_idx" ON "Timesheet"("status", "submittedAt");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'TimePunch_assignmentId_fkey') THEN
    ALTER TABLE "TimePunch" ADD CONSTRAINT "TimePunch_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Timesheet_assignmentId_fkey') THEN
    ALTER TABLE "Timesheet" ADD CONSTRAINT "Timesheet_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;
