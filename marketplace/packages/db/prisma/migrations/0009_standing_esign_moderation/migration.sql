-- Standing bookings, in-house e-signature evidence, blocked-message review, clinic location photos.
ALTER TYPE "SelectionMethod" ADD VALUE IF NOT EXISTS 'STANDING';

ALTER TABLE "ClinicLocation" ADD COLUMN IF NOT EXISTS "photoKeys" TEXT[] DEFAULT ARRAY[]::TEXT[];

ALTER TABLE "AgreementSignature" ADD COLUMN IF NOT EXISTS "viewedAt" TIMESTAMPTZ(3);
ALTER TABLE "AgreementSignature" ADD COLUMN IF NOT EXISTS "consentAt" TIMESTAMPTZ(3);
ALTER TABLE "AgreementSignature" ADD COLUMN IF NOT EXISTS "typedSignature" TEXT;
ALTER TABLE "AgreementSignature" ADD COLUMN IF NOT EXISTS "signerTitle" TEXT;
ALTER TABLE "AgreementSignature" ADD COLUMN IF NOT EXISTS "signerEmail" TEXT;
ALTER TABLE "AgreementSignature" ADD COLUMN IF NOT EXISTS "signerIp" TEXT;
ALTER TABLE "AgreementSignature" ADD COLUMN IF NOT EXISTS "signerAgent" TEXT;
ALTER TABLE "AgreementSignature" ADD COLUMN IF NOT EXISTS "document" JSONB;
ALTER TABLE "AgreementSignature" ADD COLUMN IF NOT EXISTS "documentText" TEXT;
ALTER TABLE "AgreementSignature" ADD COLUMN IF NOT EXISTS "documentHash" TEXT;

CREATE TABLE IF NOT EXISTS "StandingBooking" (
    "id" TEXT NOT NULL,
    "clinicOrgId" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "professionCode" TEXT NOT NULL,
    "weekdays" INTEGER[],
    "startTime" TEXT NOT NULL,
    "endTime" TEXT NOT NULL,
    "startsOn" DATE NOT NULL,
    "endsOn" DATE,
    "notes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'PROPOSED',
    "createdById" TEXT NOT NULL,
    "respondedAt" TIMESTAMPTZ(3),
    "endedAt" TIMESTAMPTZ(3),
    "endedByType" TEXT,
    "endedReason" TEXT,
    "generatedThrough" DATE,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "StandingBooking_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "StandingBooking_clinicOrgId_status_idx" ON "StandingBooking"("clinicOrgId", "status");
CREATE INDEX IF NOT EXISTS "StandingBooking_providerId_status_idx" ON "StandingBooking"("providerId", "status");

ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "standingBookingId" TEXT;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Shift_standingBookingId_fkey') THEN
    ALTER TABLE "Shift" ADD CONSTRAINT "Shift_standingBookingId_fkey" FOREIGN KEY ("standingBookingId") REFERENCES "StandingBooking"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE TABLE IF NOT EXISTS "BlockedMessage" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "senderType" "PartyType" NOT NULL,
    "body" TEXT NOT NULL,
    "reasons" TEXT[],
    "source" TEXT NOT NULL,
    "aiReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BlockedMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BlockedMessage_createdAt_idx" ON "BlockedMessage"("createdAt");
CREATE INDEX IF NOT EXISTS "BlockedMessage_senderUserId_createdAt_idx" ON "BlockedMessage"("senderUserId", "createdAt");

-- Clinic experience preference (minimum years; relaxed in emergencies unless the clinic opts out).
ALTER TABLE "ClinicOrg" ADD COLUMN IF NOT EXISTS "minYearsExperience" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ClinicOrg" ADD COLUMN IF NOT EXISTS "relaxExperienceInEmergency" BOOLEAN NOT NULL DEFAULT true;
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "minYearsExperience" INTEGER NOT NULL DEFAULT 0;

-- Direct hire (placement) requests.
CREATE TABLE IF NOT EXISTS "HireRequest" (
    "id" TEXT NOT NULL,
    "clinicOrgId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "requestedById" TEXT NOT NULL,
    "positionType" TEXT NOT NULL,
    "message" TEXT,
    "callbackPhone" TEXT,
    "callbackTimes" TEXT,
    "status" TEXT NOT NULL DEFAULT 'NEW',
    "feeCents" INTEGER,
    "terms" TEXT,
    "quotedAt" TIMESTAMPTZ(3),
    "quotedById" TEXT,
    "acceptedName" TEXT,
    "acceptedTitle" TEXT,
    "acceptedAt" TIMESTAMPTZ(3),
    "acceptedIp" TEXT,
    "termsHash" TEXT,
    "paymentId" TEXT,
    "releasedAt" TIMESTAMPTZ(3),
    "adminNotes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "HireRequest_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "HireRequest_status_createdAt_idx" ON "HireRequest"("status", "createdAt");
CREATE INDEX IF NOT EXISTS "HireRequest_clinicOrgId_createdAt_idx" ON "HireRequest"("clinicOrgId", "createdAt");
