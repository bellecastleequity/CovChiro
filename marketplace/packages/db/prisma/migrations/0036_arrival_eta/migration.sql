-- "On my way" arrival time shared with the clinic (no positions stored). Re-runnable.
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "etaAt" TIMESTAMPTZ(3);
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "etaMiles" DOUBLE PRECISION;
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "etaUpdatedAt" TIMESTAMPTZ(3);
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "etaNearNotifiedAt" TIMESTAMPTZ(3);
