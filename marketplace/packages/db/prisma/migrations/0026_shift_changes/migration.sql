-- Shift changes after confirmation: the provider accepts or declines (declined/expired = released, shift reopens). Re-runnable.
DO $$ BEGIN
  CREATE TYPE "ShiftChangeStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "ShiftChange" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "before" JSONB NOT NULL,
    "after" JSONB NOT NULL,
    "message" TEXT,
    "status" "ShiftChangeStatus" NOT NULL DEFAULT 'PENDING',
    "respondBy" TIMESTAMPTZ(3) NOT NULL,
    "respondedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "ShiftChange_pkey" PRIMARY KEY ("id")
);

CREATE INDEX IF NOT EXISTS "ShiftChange_shiftId_status_idx" ON "ShiftChange"("shiftId", "status");
CREATE INDEX IF NOT EXISTS "ShiftChange_status_respondBy_idx" ON "ShiftChange"("status", "respondBy");
-- At most one change waiting per shift.
CREATE UNIQUE INDEX IF NOT EXISTS "ShiftChange_one_pending" ON "ShiftChange"("shiftId") WHERE "status" = 'PENDING';

DO $$ BEGIN
  ALTER TABLE "ShiftChange" ADD CONSTRAINT "ShiftChange_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
