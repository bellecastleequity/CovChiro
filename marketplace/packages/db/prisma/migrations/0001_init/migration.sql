-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CLINIC_OWNER', 'CLINIC_STAFF', 'PROVIDER', 'PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "PricingModel" AS ENUM ('TIERED', 'HOURLY');

-- CreateEnum
CREATE TYPE "ProviderProfessionStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'PAUSED');

-- CreateEnum
CREATE TYPE "ProviderStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'PAUSED', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'EXPIRED', 'SUSPENDED', 'REVOKED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ClinicStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('DRAFT', 'OPEN', 'FAVORITES_ONLY', 'SELECTING', 'CASCADING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'UNFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('ACTIVE', 'WITHDRAWN', 'SELECTED', 'NOT_SELECTED', 'AUTO_WITHDRAWN_CONFLICT', 'INELIGIBLE');

-- CreateEnum
CREATE TYPE "OfferSource" AS ENUM ('CLINIC_PICK', 'DISPATCH', 'BROADCAST', 'STANDBY', 'ADMIN');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'ACCEPTED_PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'NOT_SELECTED', 'WITHDRAWN', 'INELIGIBLE');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'LICENSE_LAPSED', 'DISPUTED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "SelectionMethod" AS ENUM ('CLINIC_PICKED_APPLICANT', 'CLINIC_PICKED_OFFER', 'AUTO_APPLICANT', 'INSTANT_BOOK', 'ADMIN', 'ON_CALL_AUTO', 'DISPATCH_WAVE', 'DISPATCH_BROADCAST', 'STANDBY');

-- CreateEnum
CREATE TYPE "CancelParty" AS ENUM ('CLINIC', 'PROVIDER', 'PLATFORM');

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('CLINIC', 'PROVIDER');

-- CreateEnum
CREATE TYPE "PaymentType" AS ENUM ('DEPOSIT', 'BALANCE', 'LODGING', 'CANCELLATION_FEE', 'CONVERSION_FEE', 'REFUND', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PaymentStatus" AS ENUM ('PENDING', 'PROCESSING', 'SUCCEEDED', 'FAILED', 'REFUNDED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "PayoutKind" AS ENUM ('SHIFT', 'LODGING', 'LATE_CANCEL', 'ADJUSTMENT');

-- CreateEnum
CREATE TYPE "PayoutStatus" AS ENUM ('PENDING', 'SCHEDULED', 'ON_HOLD', 'PROCESSING', 'PAID', 'FAILED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "TransferStatus" AS ENUM ('PROCESSING', 'PAID', 'FAILED', 'REVERSED');

-- CreateEnum
CREATE TYPE "DurationTier" AS ENUM ('HALF_DAY', 'FULL_DAY', 'HOURLY');

-- CreateEnum
CREATE TYPE "PromoKind" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'NURTURING', 'CONTACTED', 'CONVERTED', 'UNSUBSCRIBED', 'EXPIRED', 'SUPERSEDED', 'LOST');

-- CreateEnum
CREATE TYPE "UrgencyTier" AS ENUM ('SAME_DAY', 'SHORT', 'NEAR', 'PLANNED');

-- CreateEnum
CREATE TYPE "DispatchTrigger" AS ENUM ('URGENT_POST', 'SELECTION_DEADLINE', 'BACKFILL', 'CLINIC_REQUEST', 'ADMIN', 'RATE_BOOST');

-- CreateEnum
CREATE TYPE "DispatchStatus" AS ENUM ('ACTIVE', 'FILLED', 'EXHAUSTED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "DispatchStage" AS ENUM ('STANDBY', 'ON_CALL_CHECK', 'WAVES', 'BROADCAST', 'DONE');

-- CreateTable
CREATE TABLE "User" (
    "id" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "name" TEXT NOT NULL,
    "phone" TEXT,
    "passwordHash" TEXT,
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "phoneVerifiedAt" TIMESTAMPTZ(3),
    "mfaEnabled" BOOLEAN NOT NULL DEFAULT false,
    "totpSecret" TEXT,
    "role" "Role" NOT NULL,
    "disabledAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastLoginAt" TIMESTAMPTZ(3),

    CONSTRAINT "User_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Session" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "mfaVerified" BOOLEAN NOT NULL DEFAULT false,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "userAgent" TEXT,

    CONSTRAINT "Session_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AuthToken" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "purpose" TEXT NOT NULL,
    "tokenHash" TEXT NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "usedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuthToken_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateLimit" (
    "key" TEXT NOT NULL,
    "count" INTEGER NOT NULL,
    "windowEnd" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "RateLimit_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "Profession" (
    "code" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "credentialSuffix" TEXT NOT NULL,
    "npiRequired" BOOLEAN NOT NULL,
    "pricingModel" "PricingModel" NOT NULL,
    "defaultMalpracticeMinOccurrenceCents" INTEGER NOT NULL,
    "defaultMalpracticeMinAggregateCents" INTEGER NOT NULL,
    "requiresSupervisionDefault" BOOLEAN NOT NULL DEFAULT false,
    "defaultSupervisingProfessionCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "active" BOOLEAN NOT NULL DEFAULT false,
    "sortOrder" INTEGER NOT NULL,

    CONSTRAINT "Profession_pkey" PRIMARY KEY ("code")
);

-- CreateTable
CREATE TABLE "ProfessionStateConfig" (
    "professionCode" TEXT NOT NULL,
    "state" CHAR(2) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "legalReviewComplete" BOOLEAN NOT NULL DEFAULT false,
    "legalReviewNotes" TEXT,
    "licensedAtStateLevel" BOOLEAN NOT NULL DEFAULT true,
    "alternativeCredentialAllowed" BOOLEAN NOT NULL DEFAULT false,
    "alternativeCredentialPolicy" TEXT,
    "credentialTitle" TEXT,
    "boardLookupUrl" TEXT,
    "supervisionRequired" BOOLEAN,
    "supervisingProfessionCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "supervisionNotes" TEXT,
    "malpracticeMinOccurrenceCents" INTEGER,
    "malpracticeMinAggregateCents" INTEGER,
    "scopeNotes" TEXT,
    "enabledAt" TIMESTAMPTZ(3),
    "enabledById" TEXT,

    CONSTRAINT "ProfessionStateConfig_pkey" PRIMARY KEY ("professionCode","state")
);

-- CreateTable
CREATE TABLE "ProviderProfession" (
    "providerId" TEXT NOT NULL,
    "professionCode" TEXT NOT NULL,
    "yearsInPractice" INTEGER,
    "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "status" "ProviderProfessionStatus" NOT NULL DEFAULT 'ONBOARDING',
    "addendumSignedAt" TIMESTAMPTZ(3),
    "profileCompleteAt" TIMESTAMPTZ(3),

    CONSTRAINT "ProviderProfession_pkey" PRIMARY KEY ("providerId","professionCode")
);

-- CreateTable
CREATE TABLE "Provider" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "photoUrl" TEXT,
    "npi" TEXT,
    "npiVerifiedAt" TIMESTAMPTZ(3),
    "npiMismatch" BOOLEAN NOT NULL DEFAULT false,
    "homeAddress" TEXT,
    "homeLat" DOUBLE PRECISION,
    "homeLng" DOUBLE PRECISION,
    "homeCity" TEXT,
    "homeState" TEXT,
    "homeTimeZone" TEXT NOT NULL DEFAULT 'America/New_York',
    "homeGeo" geography(Point, 4326),
    "maxDriveMinutes" INTEGER NOT NULL DEFAULT 90,
    "willingOvernight" BOOLEAN NOT NULL DEFAULT false,
    "bio" TEXT,
    "school" TEXT,
    "graduationYear" INTEGER,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ehrSystems" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "xrayComfort" BOOLEAN NOT NULL DEFAULT false,
    "maxPatientsPerDay" INTEGER,
    "stripeAccountId" TEXT,
    "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "agreementSignedAt" TIMESTAMPTZ(3),
    "agreementVersion" INTEGER,
    "profileCompleteAt" TIMESTAMPTZ(3),
    "status" "ProviderStatus" NOT NULL DEFAULT 'ONBOARDING',
    "adminNotes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "headline" TEXT,
    "linkedinUrl" TEXT,
    "quietHoursStart" INTEGER NOT NULL DEFAULT 1260,
    "quietHoursEnd" INTEGER NOT NULL DEFAULT 360,
    "urgentDuringQuietHours" BOOLEAN NOT NULL DEFAULT false,
    "snoozedUntil" TIMESTAMPTZ(3),
    "consecutiveIgnoredOffers" INTEGER NOT NULL DEFAULT 0,
    "oncallPausedReason" TEXT,
    "smsConsentAt" TIMESTAMPTZ(3),

    CONSTRAINT "Provider_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "License" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "professionCode" TEXT NOT NULL,
    "state" CHAR(2) NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "credentialTitle" TEXT,
    "issuedAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "LicenseStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMPTZ(3),
    "verificationMethod" TEXT,
    "verificationEvidenceUrl" TEXT,
    "documentUrl" TEXT,
    "rejectionReason" TEXT,
    "nextReverifyAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "License_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MalpracticePolicy" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "perOccurrenceCents" INTEGER NOT NULL,
    "aggregateCents" INTEGER NOT NULL,
    "coveredProfessionCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "documentUrl" TEXT NOT NULL,
    "status" "LicenseStatus" NOT NULL DEFAULT 'PENDING_VERIFICATION',
    "verifiedById" TEXT,
    "verifiedAt" TIMESTAMPTZ(3),
    "rejectionReason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MalpracticePolicy_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Skill" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "professionCode" TEXT,
    "scopeSensitive" BOOLEAN NOT NULL DEFAULT false,
    "requiresCertification" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Skill_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderSkill" (
    "providerId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,
    "proficiency" INTEGER NOT NULL DEFAULT 2,
    "certificationUrl" TEXT,
    "certificationStatus" "LicenseStatus",
    "certificationExpiresAt" TIMESTAMPTZ(3),
    "certificationVerifiedById" TEXT,
    "certificationVerifiedAt" TIMESTAMPTZ(3),

    CONSTRAINT "ProviderSkill_pkey" PRIMARY KEY ("providerId","skillId")
);

-- CreateTable
CREATE TABLE "SkillStateRule" (
    "skillId" TEXT NOT NULL,
    "professionCode" TEXT NOT NULL,
    "state" CHAR(2) NOT NULL,
    "allowed" BOOLEAN NOT NULL,
    "notes" TEXT,

    CONSTRAINT "SkillStateRule_pkey" PRIMARY KEY ("skillId","professionCode","state")
);

-- CreateTable
CREATE TABLE "AvailabilityRule" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "timeZone" TEXT NOT NULL,

    CONSTRAINT "AvailabilityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityBlackout" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "AvailabilityBlackout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityOpenDate" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AvailabilityOpenDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderStats" (
    "providerId" TEXT NOT NULL,
    "completedShifts" INTEGER NOT NULL DEFAULT 0,
    "lateCancels" INTEGER NOT NULL DEFAULT 0,
    "noShows" INTEGER NOT NULL DEFAULT 0,
    "ratingSum" INTEGER NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "lastShiftAt" TIMESTAMPTZ(3),
    "shiftsThisMonth" INTEGER NOT NULL DEFAULT 0,
    "ratingByProfession" JSONB NOT NULL DEFAULT '{}',
    "completedByProfession" JSONB NOT NULL DEFAULT '{}',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProviderStats_pkey" PRIMARY KEY ("providerId")
);

-- CreateTable
CREATE TABLE "ClinicOrg" (
    "id" TEXT NOT NULL,
    "legalName" TEXT NOT NULL,
    "displayName" TEXT NOT NULL,
    "logoUrl" TEXT,
    "phone" TEXT,
    "billingEmail" TEXT,
    "stripeCustomerId" TEXT,
    "hasPaymentMethod" BOOLEAN NOT NULL DEFAULT false,
    "paymentMethodLabel" TEXT,
    "agreementSignedAt" TIMESTAMPTZ(3),
    "agreementVersion" INTEGER,
    "status" "ClinicStatus" NOT NULL DEFAULT 'ONBOARDING',
    "adminNotes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicOrg_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicMember" (
    "id" TEXT NOT NULL,
    "clinicOrgId" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "role" "Role" NOT NULL,

    CONSTRAINT "ClinicMember_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ClinicLocation" (
    "id" TEXT NOT NULL,
    "clinicOrgId" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "addressLine1" TEXT NOT NULL,
    "addressLine2" TEXT,
    "city" TEXT NOT NULL,
    "state" CHAR(2) NOT NULL,
    "zip" TEXT NOT NULL,
    "lat" DOUBLE PRECISION NOT NULL,
    "lng" DOUBLE PRECISION NOT NULL,
    "geo" geography(Point, 4326),
    "timeZone" TEXT NOT NULL,
    "professionCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "geocodedAt" TIMESTAMPTZ(3) NOT NULL,
    "rateRegionId" TEXT,
    "phone" TEXT,
    "onSiteContactName" TEXT,
    "patientsPerDay" INTEGER,
    "ehr" TEXT,
    "equipment" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "dressCode" TEXT,
    "arrivalNotes" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "ClinicLocation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LocationSkill" (
    "locationId" TEXT NOT NULL,
    "skillId" TEXT NOT NULL,

    CONSTRAINT "LocationSkill_pkey" PRIMARY KEY ("locationId","skillId")
);

-- CreateTable
CREATE TABLE "ShiftGroup" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sameProviderRequired" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ShiftGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "shiftGroupId" TEXT,
    "state" CHAR(2) NOT NULL,
    "professionCode" TEXT NOT NULL,
    "supervisionAttestation" JSONB,
    "supervisionAttestedById" TEXT,
    "supervisionAttestedAt" TIMESTAMPTZ(3),
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'DRAFT',
    "requiredSkillIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredSkillIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expectedPatients" INTEGER,
    "notes" TEXT,
    "instantBook" BOOLEAN NOT NULL DEFAULT false,
    "maxTravelBudgetCents" INTEGER,
    "lodgingAllowed" BOOLEAN NOT NULL DEFAULT false,
    "lodgingCapCentsPerNight" INTEGER,
    "rateCardId" TEXT,
    "durationTier" "DurationTier",
    "clinicPriceCents" INTEGER NOT NULL,
    "providerPayCents" INTEGER NOT NULL,
    "premiumsApplied" JSONB NOT NULL DEFAULT '[]',
    "boosted" BOOLEAN NOT NULL DEFAULT false,
    "promoCodeId" TEXT,
    "promoDiscountCents" INTEGER NOT NULL DEFAULT 0,
    "postedAt" TIMESTAMPTZ(3),
    "favoritesWindowEndsAt" TIMESTAMPTZ(3),
    "selectionDeadline" TIMESTAMPTZ(3),
    "cascadeStartedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelReason" TEXT,
    "createdById" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Shift_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Application" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "note" TEXT,
    "status" "ApplicationStatus" NOT NULL DEFAULT 'ACTIVE',
    "scoreAtApply" DOUBLE PRECISION NOT NULL,
    "scoreBreakdown" JSONB,
    "clinicMarkedNotFit" BOOLEAN NOT NULL DEFAULT false,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "withdrawnAt" TIMESTAMPTZ(3),

    CONSTRAINT "Application_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Offer" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "source" "OfferSource" NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMPTZ(3),
    "rank" INTEGER,
    "dispatchId" TEXT,
    "waveId" TEXT,
    "tier" "UrgencyTier",
    "windowMinutes" INTEGER,
    "matchScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "dispatchScore" DOUBLE PRECISION NOT NULL DEFAULT 0,
    "pRespondAtSend" DOUBLE PRECISION NOT NULL DEFAULT 0.5,
    "replyCode" TEXT,
    "linkTokenHash" TEXT,
    "channelsSent" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "deliveredAt" TIMESTAMPTZ(3),
    "openedAt" TIMESTAMPTZ(3),
    "acceptedAt" TIMESTAMPTZ(3),
    "revived" BOOLEAN NOT NULL DEFAULT false,
    "applicationId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Offer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MatchRun" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "results" JSONB NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MatchRun_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Assignment" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "state" CHAR(2) NOT NULL,
    "professionCode" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "bufferMinutes" INTEGER NOT NULL,
    "bufferedRange" tstzrange,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "selectionMethod" "SelectionMethod" NOT NULL,
    "driveMinutes" INTEGER NOT NULL,
    "driveMiles" DOUBLE PRECISION NOT NULL,
    "clinicPriceCents" INTEGER NOT NULL,
    "providerPayCents" INTEGER NOT NULL,
    "promoDiscountCents" INTEGER NOT NULL DEFAULT 0,
    "mileageCents" INTEGER NOT NULL,
    "lodgingEstimateCents" INTEGER NOT NULL DEFAULT 0,
    "lodgingApprovedCents" INTEGER NOT NULL DEFAULT 0,
    "clinicTotalCents" INTEGER NOT NULL,
    "providerTotalCents" INTEGER NOT NULL,
    "depositCents" INTEGER NOT NULL DEFAULT 0,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "graceEndsAt" TIMESTAMPTZ(3),
    "confirmedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "startedAt" TIMESTAMPTZ(3),
    "completedAt" TIMESTAMPTZ(3),
    "cancelledAt" TIMESTAMPTZ(3),
    "cancelledBy" "CancelParty",
    "cancelReason" TEXT,

    CONSTRAINT "Assignment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Favorite" (
    "id" TEXT NOT NULL,
    "fromType" "PartyType" NOT NULL,
    "fromId" TEXT NOT NULL,
    "toType" "PartyType" NOT NULL,
    "toId" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Favorite_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Block" (
    "id" TEXT NOT NULL,
    "fromType" "PartyType" NOT NULL,
    "fromId" TEXT NOT NULL,
    "toType" "PartyType" NOT NULL,
    "toId" TEXT NOT NULL,
    "reason" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Block_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Rating" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "raterType" "PartyType" NOT NULL,
    "stars" INTEGER NOT NULL,
    "categories" JSONB NOT NULL,
    "comment" TEXT,
    "submittedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "revealedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Rating_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "MessageThread" (
    "id" TEXT NOT NULL,
    "clinicOrgId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "shiftId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "lastMessageAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "MessageThread_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Message" (
    "id" TEXT NOT NULL,
    "threadId" TEXT NOT NULL,
    "senderUserId" TEXT NOT NULL,
    "senderType" "PartyType" NOT NULL,
    "body" TEXT NOT NULL,
    "redacted" BOOLEAN NOT NULL DEFAULT false,
    "flagged" BOOLEAN NOT NULL DEFAULT false,
    "containedContact" BOOLEAN NOT NULL DEFAULT false,
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Message_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payment" (
    "id" TEXT NOT NULL,
    "clinicOrgId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "type" "PaymentType" NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "stripePaymentIntentId" TEXT,
    "stripeRefundId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" "PaymentStatus" NOT NULL DEFAULT 'PENDING',
    "failureReason" TEXT,
    "description" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Payment_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Payout" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "assignmentId" TEXT,
    "kind" "PayoutKind" NOT NULL,
    "description" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "status" "PayoutStatus" NOT NULL DEFAULT 'PENDING',
    "onHold" BOOLEAN NOT NULL DEFAULT false,
    "holdReason" TEXT,
    "releaseAt" TIMESTAMPTZ(3),
    "transferId" TEXT,
    "paidAt" TIMESTAMPTZ(3),
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Payout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PayoutTransfer" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "amountCents" INTEGER NOT NULL,
    "stripeTransferId" TEXT,
    "idempotencyKey" TEXT NOT NULL,
    "status" "TransferStatus" NOT NULL DEFAULT 'PROCESSING',
    "failureReason" TEXT,
    "initiatedById" TEXT,
    "note" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "paidAt" TIMESTAMPTZ(3),

    CONSTRAINT "PayoutTransfer_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LodgingReceipt" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "nights" INTEGER NOT NULL DEFAULT 1,
    "amountCents" INTEGER NOT NULL,
    "fileUrl" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'SUBMITTED',
    "approvedCents" INTEGER,
    "reviewedById" TEXT,
    "reviewedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LodgingReceipt_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispute" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "openedByType" "PartyType" NOT NULL,
    "openedById" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedById" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Dispute_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AgreementSignature" (
    "id" TEXT NOT NULL,
    "partyType" "PartyType" NOT NULL,
    "partyId" TEXT NOT NULL,
    "signerUserId" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "provider" TEXT NOT NULL,
    "envelopeId" TEXT,
    "status" TEXT NOT NULL DEFAULT 'SENT',
    "signedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgreementSignature_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "StateConfig" (
    "state" CHAR(2) NOT NULL,
    "enabled" BOOLEAN NOT NULL DEFAULT false,
    "legalReviewComplete" BOOLEAN NOT NULL DEFAULT false,
    "legalReviewNotes" TEXT,
    "contractorModelNotes" TEXT,
    "staffingRegistrationRequired" BOOLEAN NOT NULL DEFAULT false,
    "salesTaxOnStaffing" BOOLEAN NOT NULL DEFAULT false,
    "boardLookupUrl" TEXT,
    "defaultRateRegionId" TEXT,
    "enabledAt" TIMESTAMPTZ(3),
    "enabledById" TEXT,

    CONSTRAINT "StateConfig_pkey" PRIMARY KEY ("state")
);

-- CreateTable
CREATE TABLE "RateRegion" (
    "id" TEXT NOT NULL,
    "state" CHAR(2) NOT NULL,
    "name" TEXT NOT NULL,
    "zip3List" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "tier" INTEGER NOT NULL,

    CONSTRAINT "RateRegion_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "RateCard" (
    "id" TEXT NOT NULL,
    "rateRegionId" TEXT NOT NULL,
    "professionCode" TEXT NOT NULL,
    "durationTier" "DurationTier" NOT NULL,
    "clinicPriceCents" INTEGER NOT NULL,
    "providerPayCents" INTEGER NOT NULL,
    "minHours" DOUBLE PRECISION,
    "effectiveFrom" TIMESTAMPTZ(3) NOT NULL,
    "effectiveTo" TIMESTAMPTZ(3),

    CONSTRAINT "RateCard_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoCode" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "kind" "PromoKind" NOT NULL,
    "value" INTEGER NOT NULL,
    "description" TEXT,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "startsAt" TIMESTAMPTZ(3),
    "expiresAt" TIMESTAMPTZ(3),
    "maxUses" INTEGER,
    "usedCount" INTEGER NOT NULL DEFAULT 0,
    "maxUsesPerClinic" INTEGER DEFAULT 1,
    "firstShiftOnly" BOOLEAN NOT NULL DEFAULT false,
    "assignedEmail" CITEXT,
    "isWelcome" BOOLEAN NOT NULL DEFAULT false,
    "parentId" TEXT,
    "landingEnabled" BOOLEAN NOT NULL DEFAULT false,
    "landingAudience" "PartyType" NOT NULL DEFAULT 'CLINIC',
    "landingHeadline" TEXT,
    "landingDescription" TEXT,
    "landingVisits" INTEGER NOT NULL DEFAULT 0,
    "dripCustom" JSONB,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoCode_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "PromoRedemption" (
    "id" TEXT NOT NULL,
    "promoCodeId" TEXT NOT NULL,
    "clinicOrgId" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "discountCents" INTEGER NOT NULL,
    "voidedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromoRedemption_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Lead" (
    "id" TEXT NOT NULL,
    "audience" "PartyType" NOT NULL DEFAULT 'CLINIC',
    "professionCode" TEXT,
    "name" TEXT NOT NULL,
    "email" CITEXT NOT NULL,
    "phone" TEXT,
    "organization" TEXT,
    "state" CHAR(2),
    "message" TEXT,
    "source" TEXT NOT NULL,
    "campaignCode" TEXT NOT NULL DEFAULT '',
    "promoCode" TEXT,
    "status" "LeadStatus" NOT NULL DEFAULT 'NEW',
    "dripStep" INTEGER NOT NULL DEFAULT 0,
    "lastDripSentAt" TIMESTAMPTZ(3),
    "nextDripAt" TIMESTAMPTZ(3),
    "unsubscribeToken" TEXT NOT NULL,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "landingPath" TEXT,
    "convertedAt" TIMESTAMPTZ(3),
    "convertedUserId" TEXT,
    "convertedShiftId" TEXT,
    "ownerId" TEXT,
    "followUpAt" TIMESTAMPTZ(3),
    "unsubscribedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Lead_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "LeadActivity" (
    "id" TEXT NOT NULL,
    "leadId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "actorId" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AnalyticsEvent" (
    "id" TEXT NOT NULL,
    "type" TEXT NOT NULL,
    "path" TEXT,
    "referrer" TEXT,
    "visitorId" TEXT,
    "userId" TEXT,
    "utmSource" TEXT,
    "utmMedium" TEXT,
    "utmCampaign" TEXT,
    "props" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AnalyticsEvent_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Setting" (
    "key" TEXT NOT NULL,
    "value" JSONB NOT NULL,
    "updatedById" TEXT,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "Setting_pkey" PRIMARY KEY ("key")
);

-- CreateTable
CREATE TABLE "AuditLog" (
    "id" TEXT NOT NULL,
    "actorUserId" TEXT,
    "action" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "before" JSONB,
    "after" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AuditLog_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Notification" (
    "id" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "template" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "body" TEXT,
    "link" TEXT,
    "payload" JSONB NOT NULL DEFAULT '{}',
    "sentAt" TIMESTAMPTZ(3),
    "readAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Notification_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AdminTask" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "title" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "resolvedAt" TIMESTAMPTZ(3),
    "resolvedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AdminTask_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Dispatch" (
    "id" TEXT NOT NULL,
    "shiftId" TEXT NOT NULL,
    "trigger" "DispatchTrigger" NOT NULL,
    "status" "DispatchStatus" NOT NULL DEFAULT 'ACTIVE',
    "tierAtStart" "UrgencyTier" NOT NULL,
    "currentWave" INTEGER NOT NULL DEFAULT 0,
    "stage" "DispatchStage" NOT NULL DEFAULT 'ON_CALL_CHECK',
    "stageEndsAt" TIMESTAMPTZ(3),
    "bestMatchAtStart" DOUBLE PRECISION,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "endedAt" TIMESTAMPTZ(3),
    "filledOfferId" TEXT,
    "filledVia" "SelectionMethod",
    "filledProviderId" TEXT,

    CONSTRAINT "Dispatch_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Wave" (
    "id" TEXT NOT NULL,
    "dispatchId" TEXT NOT NULL,
    "number" INTEGER NOT NULL,
    "isBroadcast" BOOLEAN NOT NULL DEFAULT false,
    "isStandby" BOOLEAN NOT NULL DEFAULT false,
    "tier" "UrgencyTier" NOT NULL,
    "sentAt" TIMESTAMPTZ(3) NOT NULL,
    "windowEndsAt" TIMESTAMPTZ(3) NOT NULL,
    "holdEndsAt" TIMESTAMPTZ(3),
    "closedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Wave_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "OnCallRule" (
    "id" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "professionCodes" TEXT[],
    "recurringWindows" JSONB NOT NULL DEFAULT '[]',
    "dateWindows" JSONB NOT NULL DEFAULT '[]',
    "timeZone" TEXT NOT NULL,
    "maxDriveMinutes" INTEGER NOT NULL,
    "minPayHalfDayCents" INTEGER,
    "minPayFullDayCents" INTEGER,
    "minPayHourlyCents" INTEGER,
    "minNoticeMinutes" INTEGER NOT NULL DEFAULT 90,
    "maxPerDay" INTEGER NOT NULL DEFAULT 1,
    "maxPerWeek" INTEGER NOT NULL DEFAULT 5,
    "favoritesOnly" BOOLEAN NOT NULL DEFAULT false,
    "minClinicRating" DOUBLE PRECISION,
    "excludedClinicIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "allowOvernight" BOOLEAN NOT NULL DEFAULT false,
    "pausedUntil" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "OnCallRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "ProviderResponsiveness" (
    "providerId" TEXT NOT NULL,
    "tier" "UrgencyTier" NOT NULL,
    "offers" DOUBLE PRECISION NOT NULL,
    "hits" DOUBLE PRECISION NOT NULL,
    "pRespond" DOUBLE PRECISION NOT NULL,
    "medianResponseSeconds" INTEGER,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProviderResponsiveness_pkey" PRIMARY KEY ("providerId","tier")
);

-- CreateTable
CREATE TABLE "StandbyEntry" (
    "shiftId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "matchScore" DOUBLE PRECISION NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "StandbyEntry_pkey" PRIMARY KEY ("shiftId","providerId")
);

-- CreateIndex
CREATE UNIQUE INDEX "User_email_key" ON "User"("email");

-- CreateIndex
CREATE UNIQUE INDEX "Session_tokenHash_key" ON "Session"("tokenHash");

-- CreateIndex
CREATE INDEX "Session_userId_idx" ON "Session"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "AuthToken_tokenHash_key" ON "AuthToken"("tokenHash");

-- CreateIndex
CREATE INDEX "AuthToken_userId_purpose_idx" ON "AuthToken"("userId", "purpose");

-- CreateIndex
CREATE UNIQUE INDEX "Profession_slug_key" ON "Profession"("slug");

-- CreateIndex
CREATE UNIQUE INDEX "Provider_userId_key" ON "Provider"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Provider_npi_key" ON "Provider"("npi");

-- CreateIndex
CREATE UNIQUE INDEX "Provider_stripeAccountId_key" ON "Provider"("stripeAccountId");

-- CreateIndex
CREATE INDEX "License_professionCode_state_status_expiresAt_idx" ON "License"("professionCode", "state", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "License_providerId_professionCode_state_key" ON "License"("providerId", "professionCode", "state");

-- CreateIndex
CREATE INDEX "MalpracticePolicy_providerId_status_expiresAt_idx" ON "MalpracticePolicy"("providerId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Skill_name_professionCode_key" ON "Skill"("name", "professionCode");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicOrg_stripeCustomerId_key" ON "ClinicOrg"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicMember_clinicOrgId_userId_key" ON "ClinicMember"("clinicOrgId", "userId");

-- CreateIndex
CREATE INDEX "Shift_professionCode_state_status_startsAt_idx" ON "Shift"("professionCode", "state", "status", "startsAt");

-- CreateIndex
CREATE INDEX "Shift_locationId_startsAt_idx" ON "Shift"("locationId", "startsAt");

-- CreateIndex
CREATE INDEX "Application_providerId_status_idx" ON "Application"("providerId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Application_shiftId_providerId_key" ON "Application"("shiftId", "providerId");

-- CreateIndex
CREATE UNIQUE INDEX "Offer_linkTokenHash_key" ON "Offer"("linkTokenHash");

-- CreateIndex
CREATE INDEX "Offer_providerId_status_idx" ON "Offer"("providerId", "status");

-- CreateIndex
CREATE INDEX "Offer_shiftId_status_idx" ON "Offer"("shiftId", "status");

-- CreateIndex
CREATE INDEX "MatchRun_shiftId_createdAt_idx" ON "MatchRun"("shiftId", "createdAt");

-- CreateIndex
CREATE INDEX "Assignment_providerId_status_startsAt_idx" ON "Assignment"("providerId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "Assignment_shiftId_idx" ON "Assignment"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_fromType_fromId_toType_toId_key" ON "Favorite"("fromType", "fromId", "toType", "toId");

-- CreateIndex
CREATE UNIQUE INDEX "Block_fromType_fromId_toType_toId_key" ON "Block"("fromType", "fromId", "toType", "toId");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_assignmentId_raterType_key" ON "Rating"("assignmentId", "raterType");

-- CreateIndex
CREATE UNIQUE INDEX "MessageThread_clinicOrgId_providerId_key" ON "MessageThread"("clinicOrgId", "providerId");

-- CreateIndex
CREATE INDEX "Message_threadId_createdAt_idx" ON "Message"("threadId", "createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripePaymentIntentId_key" ON "Payment"("stripePaymentIntentId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_stripeRefundId_key" ON "Payment"("stripeRefundId");

-- CreateIndex
CREATE UNIQUE INDEX "Payment_idempotencyKey_key" ON "Payment"("idempotencyKey");

-- CreateIndex
CREATE INDEX "Payment_assignmentId_idx" ON "Payment"("assignmentId");

-- CreateIndex
CREATE INDEX "Payment_clinicOrgId_createdAt_idx" ON "Payment"("clinicOrgId", "createdAt");

-- CreateIndex
CREATE INDEX "Payout_providerId_status_idx" ON "Payout"("providerId", "status");

-- CreateIndex
CREATE INDEX "Payout_status_releaseAt_idx" ON "Payout"("status", "releaseAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_assignmentId_kind_key" ON "Payout"("assignmentId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutTransfer_stripeTransferId_key" ON "PayoutTransfer"("stripeTransferId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutTransfer_idempotencyKey_key" ON "PayoutTransfer"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PayoutTransfer_providerId_createdAt_idx" ON "PayoutTransfer"("providerId", "createdAt");

-- CreateIndex
CREATE INDEX "Dispute_assignmentId_status_idx" ON "Dispute"("assignmentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementSignature_envelopeId_key" ON "AgreementSignature"("envelopeId");

-- CreateIndex
CREATE INDEX "AgreementSignature_partyType_partyId_idx" ON "AgreementSignature"("partyType", "partyId");

-- CreateIndex
CREATE UNIQUE INDEX "RateRegion_name_key" ON "RateRegion"("name");

-- CreateIndex
CREATE INDEX "RateCard_professionCode_rateRegionId_durationTier_effective_idx" ON "RateCard"("professionCode", "rateRegionId", "durationTier", "effectiveFrom");

-- CreateIndex
CREATE UNIQUE INDEX "PromoCode_code_key" ON "PromoCode"("code");

-- CreateIndex
CREATE INDEX "PromoCode_parentId_idx" ON "PromoCode"("parentId");

-- CreateIndex
CREATE UNIQUE INDEX "PromoRedemption_shiftId_key" ON "PromoRedemption"("shiftId");

-- CreateIndex
CREATE INDEX "PromoRedemption_promoCodeId_idx" ON "PromoRedemption"("promoCodeId");

-- CreateIndex
CREATE INDEX "PromoRedemption_clinicOrgId_idx" ON "PromoRedemption"("clinicOrgId");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_unsubscribeToken_key" ON "Lead"("unsubscribeToken");

-- CreateIndex
CREATE INDEX "Lead_status_nextDripAt_idx" ON "Lead"("status", "nextDripAt");

-- CreateIndex
CREATE INDEX "Lead_createdAt_idx" ON "Lead"("createdAt");

-- CreateIndex
CREATE UNIQUE INDEX "Lead_email_campaignCode_key" ON "Lead"("email", "campaignCode");

-- CreateIndex
CREATE INDEX "LeadActivity_leadId_createdAt_idx" ON "LeadActivity"("leadId", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_type_createdAt_idx" ON "AnalyticsEvent"("type", "createdAt");

-- CreateIndex
CREATE INDEX "AnalyticsEvent_createdAt_idx" ON "AnalyticsEvent"("createdAt");

-- CreateIndex
CREATE INDEX "AuditLog_entityType_entityId_idx" ON "AuditLog"("entityType", "entityId");

-- CreateIndex
CREATE INDEX "AuditLog_createdAt_idx" ON "AuditLog"("createdAt");

-- CreateIndex
CREATE INDEX "Notification_userId_readAt_idx" ON "Notification"("userId", "readAt");

-- CreateIndex
CREATE INDEX "AdminTask_resolvedAt_createdAt_idx" ON "AdminTask"("resolvedAt", "createdAt");

-- CreateIndex
CREATE INDEX "Dispatch_shiftId_status_idx" ON "Dispatch"("shiftId", "status");

-- CreateIndex
CREATE INDEX "Dispatch_status_stage_idx" ON "Dispatch"("status", "stage");

-- CreateIndex
CREATE INDEX "Wave_closedAt_windowEndsAt_idx" ON "Wave"("closedAt", "windowEndsAt");

-- CreateIndex
CREATE UNIQUE INDEX "Wave_dispatchId_number_key" ON "Wave"("dispatchId", "number");

-- CreateIndex
CREATE INDEX "OnCallRule_providerId_active_idx" ON "OnCallRule"("providerId", "active");

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProfessionStateConfig" ADD CONSTRAINT "ProfessionStateConfig_professionCode_fkey" FOREIGN KEY ("professionCode") REFERENCES "Profession"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderProfession" ADD CONSTRAINT "ProviderProfession_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderProfession" ADD CONSTRAINT "ProviderProfession_professionCode_fkey" FOREIGN KEY ("professionCode") REFERENCES "Profession"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Provider" ADD CONSTRAINT "Provider_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_professionCode_fkey" FOREIGN KEY ("professionCode") REFERENCES "Profession"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MalpracticePolicy" ADD CONSTRAINT "MalpracticePolicy_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Skill" ADD CONSTRAINT "Skill_professionCode_fkey" FOREIGN KEY ("professionCode") REFERENCES "Profession"("code") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderSkill" ADD CONSTRAINT "ProviderSkill_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderSkill" ADD CONSTRAINT "ProviderSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "SkillStateRule" ADD CONSTRAINT "SkillStateRule_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityRule" ADD CONSTRAINT "AvailabilityRule_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityBlackout" ADD CONSTRAINT "AvailabilityBlackout_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityOpenDate" ADD CONSTRAINT "AvailabilityOpenDate_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderStats" ADD CONSTRAINT "ProviderStats_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicMember" ADD CONSTRAINT "ClinicMember_clinicOrgId_fkey" FOREIGN KEY ("clinicOrgId") REFERENCES "ClinicOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicMember" ADD CONSTRAINT "ClinicMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicLocation" ADD CONSTRAINT "ClinicLocation_clinicOrgId_fkey" FOREIGN KEY ("clinicOrgId") REFERENCES "ClinicOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicLocation" ADD CONSTRAINT "ClinicLocation_rateRegionId_fkey" FOREIGN KEY ("rateRegionId") REFERENCES "RateRegion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationSkill" ADD CONSTRAINT "LocationSkill_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ClinicLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationSkill" ADD CONSTRAINT "LocationSkill_skillId_fkey" FOREIGN KEY ("skillId") REFERENCES "Skill"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ShiftGroup" ADD CONSTRAINT "ShiftGroup_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ClinicLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ClinicLocation"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_shiftGroupId_fkey" FOREIGN KEY ("shiftGroupId") REFERENCES "ShiftGroup"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Shift" ADD CONSTRAINT "Shift_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Application" ADD CONSTRAINT "Application_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "Dispatch"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_waveId_fkey" FOREIGN KEY ("waveId") REFERENCES "Wave"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchRun" ADD CONSTRAINT "MatchRun_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_clinicOrgId_fkey" FOREIGN KEY ("clinicOrgId") REFERENCES "ClinicOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MessageThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_clinicOrgId_fkey" FOREIGN KEY ("clinicOrgId") REFERENCES "ClinicOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "PayoutTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutTransfer" ADD CONSTRAINT "PayoutTransfer_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LodgingReceipt" ADD CONSTRAINT "LodgingReceipt_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCard" ADD CONSTRAINT "RateCard_rateRegionId_fkey" FOREIGN KEY ("rateRegionId") REFERENCES "RateRegion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCard" ADD CONSTRAINT "RateCard_professionCode_fkey" FOREIGN KEY ("professionCode") REFERENCES "Profession"("code") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoCode" ADD CONSTRAINT "PromoCode_parentId_fkey" FOREIGN KEY ("parentId") REFERENCES "PromoCode"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_promoCodeId_fkey" FOREIGN KEY ("promoCodeId") REFERENCES "PromoCode"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PromoRedemption" ADD CONSTRAINT "PromoRedemption_clinicOrgId_fkey" FOREIGN KEY ("clinicOrgId") REFERENCES "ClinicOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LeadActivity" ADD CONSTRAINT "LeadActivity_leadId_fkey" FOREIGN KEY ("leadId") REFERENCES "Lead"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Notification" ADD CONSTRAINT "Notification_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispatch" ADD CONSTRAINT "Dispatch_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Wave" ADD CONSTRAINT "Wave_dispatchId_fkey" FOREIGN KEY ("dispatchId") REFERENCES "Dispatch"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "OnCallRule" ADD CONSTRAINT "OnCallRule_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ProviderResponsiveness" ADD CONSTRAINT "ProviderResponsiveness_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandbyEntry" ADD CONSTRAINT "StandbyEntry_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "StandbyEntry" ADD CONSTRAINT "StandbyEntry_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;

