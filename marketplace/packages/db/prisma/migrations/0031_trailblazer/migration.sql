-- Trailblazer badge: places in line for providers who enrolled before their state opened. Re-runnable.
CREATE TABLE IF NOT EXISTS "TrailblazerSpot" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "professionCode" TEXT NOT NULL,
  "state" CHAR(2) NOT NULL,
  "reservedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "releasedAt" TIMESTAMPTZ(3),
  CONSTRAINT "TrailblazerSpot_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "TrailblazerSpot_providerId_professionCode_state_key" ON "TrailblazerSpot"("providerId", "professionCode", "state");
CREATE INDEX IF NOT EXISTS "TrailblazerSpot_professionCode_state_reservedAt_idx" ON "TrailblazerSpot"("professionCode", "state", "reservedAt");
DO $$ BEGIN
  ALTER TABLE "TrailblazerSpot" ADD CONSTRAINT "TrailblazerSpot_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
