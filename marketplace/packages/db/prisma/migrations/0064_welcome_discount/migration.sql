-- Welcome Discount: 15% off a clinic's first 3 completed bookings, no code, no expiration.
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "welcomeDiscountCents" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "welcomeDiscountCents" INTEGER NOT NULL DEFAULT 0;

CREATE TABLE IF NOT EXISTS "WelcomeEntitlement" (
  "id" TEXT NOT NULL,
  "clinicOrgId" TEXT NOT NULL,
  "promotion" TEXT NOT NULL DEFAULT 'WELCOME',
  "percent" INTEGER NOT NULL,
  "totalBookings" INTEGER NOT NULL,
  "priorCompleted" INTEGER NOT NULL DEFAULT 0,
  "status" TEXT NOT NULL DEFAULT 'ACTIVE',
  "reviewReason" TEXT,
  "note" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "WelcomeEntitlement_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WelcomeEntitlement_clinicOrgId_key" ON "WelcomeEntitlement"("clinicOrgId");
DO $$ BEGIN
  ALTER TABLE "WelcomeEntitlement" ADD CONSTRAINT "WelcomeEntitlement_clinicOrgId_fkey" FOREIGN KEY ("clinicOrgId") REFERENCES "ClinicOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

CREATE TABLE IF NOT EXISTS "WelcomeRedemption" (
  "id" TEXT NOT NULL,
  "entitlementId" TEXT NOT NULL,
  "clinicOrgId" TEXT NOT NULL,
  "shiftId" TEXT NOT NULL,
  "assignmentId" TEXT,
  "status" TEXT NOT NULL,
  "standardCents" INTEGER NOT NULL,
  "discountCents" INTEGER NOT NULL,
  "reservedAt" TIMESTAMPTZ(3) NOT NULL,
  "redeemedAt" TIMESTAMPTZ(3),
  "releasedAt" TIMESTAMPTZ(3),
  "releaseReason" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  CONSTRAINT "WelcomeRedemption_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "WelcomeRedemption_shiftId_key" ON "WelcomeRedemption"("shiftId");
CREATE INDEX IF NOT EXISTS "WelcomeRedemption_entitlementId_status_idx" ON "WelcomeRedemption"("entitlementId", "status");
CREATE INDEX IF NOT EXISTS "WelcomeRedemption_clinicOrgId_status_idx" ON "WelcomeRedemption"("clinicOrgId", "status");
DO $$ BEGIN
  ALTER TABLE "WelcomeRedemption" ADD CONSTRAINT "WelcomeRedemption_entitlementId_fkey" FOREIGN KEY ("entitlementId") REFERENCES "WelcomeEntitlement"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
DO $$ BEGIN
  ALTER TABLE "WelcomeRedemption" ADD CONSTRAINT "WelcomeRedemption_status_check" CHECK ("status" IN ('RESERVED', 'REDEEMED', 'RELEASED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Existing clinics: their completed bookings count toward the three (established clinics are not reset).
INSERT INTO "WelcomeEntitlement" ("id", "clinicOrgId", "percent", "totalBookings", "priorCompleted", "note", "createdAt", "updatedAt")
SELECT 'wel_' || o."id", o."id", 15, 3,
  LEAST(3, (SELECT count(*) FROM "Assignment" a JOIN "Shift" s ON s."id" = a."shiftId" JOIN "ClinicLocation" l ON l."id" = s."locationId"
            WHERE l."clinicOrgId" = o."id" AND a."status" = 'COMPLETED'))::int,
  'Created at install; completed bookings before the offer count toward the three.', CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
FROM "ClinicOrg" o
ON CONFLICT ("clinicOrgId") DO NOTHING;
