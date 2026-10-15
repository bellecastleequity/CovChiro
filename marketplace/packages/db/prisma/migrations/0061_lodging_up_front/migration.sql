-- Lodging paid up front: held for a replacement when a provider drops out; clinic-booked stays.
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "lodgingHeldCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "lodgingByClinic" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "lodgingStayKind" TEXT;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "lodgingStayDetails" TEXT;
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "lodgingCreditCents" INTEGER NOT NULL DEFAULT 0;
