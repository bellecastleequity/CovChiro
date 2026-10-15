-- Clinic-booked stay details: place, address, check-in/out, confirmation, guest name, access, booking file; provider "Got it".
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "stayPlace" TEXT;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "stayAddress" TEXT;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "stayCheckIn" TIMESTAMPTZ(3);
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "stayCheckOut" TIMESTAMPTZ(3);
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "stayConfirmation" TEXT;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "stayBookedUnder" TEXT;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "stayAccess" TEXT;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "stayFileKey" TEXT;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "stayUpdatedAt" TIMESTAMPTZ(3);
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "stayForAssignmentId" TEXT;
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "stayAckAt" TIMESTAMPTZ(3);
