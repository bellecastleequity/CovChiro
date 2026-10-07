-- Fly-in coverage: providers who'll fly to a state or territory they're licensed and insured in.
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "flyInStates" TEXT[] NOT NULL DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "flyInAirfareCents" INTEGER;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "flyInNightlyCents" INTEGER;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "flyInUntil" TIMESTAMPTZ(3);
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "flyIn" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "airfareCents" INTEGER NOT NULL DEFAULT 0;
