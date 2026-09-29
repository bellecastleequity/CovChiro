-- CreateSchema
CREATE SCHEMA IF NOT EXISTS "public";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "btree_gist";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "citext";

-- CreateExtension
CREATE EXTENSION IF NOT EXISTS "postgis";

-- CreateEnum
CREATE TYPE "Role" AS ENUM ('CLINIC_OWNER', 'CLINIC_STAFF', 'DOCTOR', 'PLATFORM_ADMIN');

-- CreateEnum
CREATE TYPE "DoctorStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'PAUSED', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "LicenseStatus" AS ENUM ('PENDING_VERIFICATION', 'VERIFIED', 'EXPIRED', 'SUSPENDED', 'REVOKED', 'REJECTED');

-- CreateEnum
CREATE TYPE "ClinicStatus" AS ENUM ('ONBOARDING', 'ACTIVE', 'SUSPENDED', 'DEACTIVATED');

-- CreateEnum
CREATE TYPE "ShiftStatus" AS ENUM ('DRAFT', 'OPEN', 'FAVORITES_ONLY', 'SELECTING', 'CASCADING', 'CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'UNFILLED', 'CANCELLED');

-- CreateEnum
CREATE TYPE "ApplicationStatus" AS ENUM ('ACTIVE', 'WITHDRAWN', 'SELECTED', 'NOT_SELECTED', 'AUTO_WITHDRAWN_CONFLICT', 'INELIGIBLE');

-- CreateEnum
CREATE TYPE "OfferSource" AS ENUM ('CLINIC_PICK', 'CASCADE', 'URGENT_PARALLEL', 'ADMIN');

-- CreateEnum
CREATE TYPE "OfferStatus" AS ENUM ('PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'WITHDRAWN');

-- CreateEnum
CREATE TYPE "AssignmentStatus" AS ENUM ('CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'CANCELLED', 'LICENSE_LAPSED', 'DISPUTED', 'NO_SHOW');

-- CreateEnum
CREATE TYPE "SelectionMethod" AS ENUM ('CLINIC_PICKED_APPLICANT', 'CLINIC_PICKED_OFFER', 'AUTO_APPLICANT', 'CASCADE_ACCEPT', 'INSTANT_BOOK', 'ADMIN');

-- CreateEnum
CREATE TYPE "CancelParty" AS ENUM ('CLINIC', 'DOCTOR', 'PLATFORM');

-- CreateEnum
CREATE TYPE "PartyType" AS ENUM ('CLINIC', 'DOCTOR');

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
CREATE TYPE "DurationTier" AS ENUM ('HALF_DAY', 'FULL_DAY');

-- CreateEnum
CREATE TYPE "PromoKind" AS ENUM ('PERCENT', 'FIXED');

-- CreateEnum
CREATE TYPE "LeadStatus" AS ENUM ('NEW', 'NURTURING', 'CONTACTED', 'CONVERTED', 'UNSUBSCRIBED', 'EXPIRED', 'SUPERSEDED', 'LOST');

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
CREATE TABLE "Doctor" (
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
    "yearsInPractice" INTEGER,
    "school" TEXT,
    "graduationYear" INTEGER,
    "languages" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "ehrSystems" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "specialties" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "xrayComfort" BOOLEAN NOT NULL DEFAULT false,
    "maxPatientsPerDay" INTEGER,
    "stripeAccountId" TEXT,
    "stripePayoutsEnabled" BOOLEAN NOT NULL DEFAULT false,
    "agreementSignedAt" TIMESTAMPTZ(3),
    "agreementVersion" INTEGER,
    "profileCompleteAt" TIMESTAMPTZ(3),
    "status" "DoctorStatus" NOT NULL DEFAULT 'ONBOARDING',
    "adminNotes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Doctor_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "License" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "state" CHAR(2) NOT NULL,
    "licenseNumber" TEXT NOT NULL,
    "licenseType" TEXT NOT NULL DEFAULT 'DC',
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
    "doctorId" TEXT NOT NULL,
    "carrier" TEXT NOT NULL,
    "policyNumber" TEXT NOT NULL,
    "perOccurrenceDollars" INTEGER NOT NULL,
    "aggregateDollars" INTEGER NOT NULL,
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
CREATE TABLE "Technique" (
    "id" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "active" BOOLEAN NOT NULL DEFAULT true,

    CONSTRAINT "Technique_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorTechnique" (
    "doctorId" TEXT NOT NULL,
    "techniqueId" TEXT NOT NULL,
    "proficiency" INTEGER NOT NULL DEFAULT 2,

    CONSTRAINT "DoctorTechnique_pkey" PRIMARY KEY ("doctorId","techniqueId")
);

-- CreateTable
CREATE TABLE "AvailabilityRule" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "weekday" INTEGER NOT NULL,
    "startMin" INTEGER NOT NULL,
    "endMin" INTEGER NOT NULL,
    "timeZone" TEXT NOT NULL,

    CONSTRAINT "AvailabilityRule_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityBlackout" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "reason" TEXT,

    CONSTRAINT "AvailabilityBlackout_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "AvailabilityOpenDate" (
    "id" TEXT NOT NULL,
    "doctorId" TEXT NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "AvailabilityOpenDate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "DoctorStats" (
    "doctorId" TEXT NOT NULL,
    "completedShifts" INTEGER NOT NULL DEFAULT 0,
    "lateCancels" INTEGER NOT NULL DEFAULT 0,
    "noShows" INTEGER NOT NULL DEFAULT 0,
    "ratingSum" INTEGER NOT NULL DEFAULT 0,
    "ratingCount" INTEGER NOT NULL DEFAULT 0,
    "lastShiftAt" TIMESTAMPTZ(3),
    "shiftsThisMonth" INTEGER NOT NULL DEFAULT 0,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "DoctorStats_pkey" PRIMARY KEY ("doctorId")
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
CREATE TABLE "LocationTechnique" (
    "locationId" TEXT NOT NULL,
    "techniqueId" TEXT NOT NULL,

    CONSTRAINT "LocationTechnique_pkey" PRIMARY KEY ("locationId","techniqueId")
);

-- CreateTable
CREATE TABLE "ShiftGroup" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "sameDoctorRequired" BOOLEAN NOT NULL DEFAULT false,

    CONSTRAINT "ShiftGroup_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE "Shift" (
    "id" TEXT NOT NULL,
    "locationId" TEXT NOT NULL,
    "shiftGroupId" TEXT,
    "state" CHAR(2) NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "ShiftStatus" NOT NULL DEFAULT 'DRAFT',
    "requiredTechniqueIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "preferredTechniqueIds" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "expectedPatients" INTEGER,
    "notes" TEXT,
    "instantBook" BOOLEAN NOT NULL DEFAULT false,
    "maxTravelBudgetCents" INTEGER,
    "lodgingAllowed" BOOLEAN NOT NULL DEFAULT false,
    "lodgingCapCentsPerNight" INTEGER,
    "rateCardId" TEXT,
    "durationTier" "DurationTier",
    "clinicPriceCents" INTEGER NOT NULL,
    "doctorPayCents" INTEGER NOT NULL,
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
    "doctorId" TEXT NOT NULL,
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
    "doctorId" TEXT NOT NULL,
    "source" "OfferSource" NOT NULL,
    "expiresAt" TIMESTAMPTZ(3) NOT NULL,
    "status" "OfferStatus" NOT NULL DEFAULT 'PENDING',
    "respondedAt" TIMESTAMPTZ(3),
    "rank" INTEGER,
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
    "doctorId" TEXT NOT NULL,
    "state" CHAR(2) NOT NULL,
    "startsAt" TIMESTAMPTZ(3) NOT NULL,
    "endsAt" TIMESTAMPTZ(3) NOT NULL,
    "bufferMinutes" INTEGER NOT NULL,
    "bufferedRange" tstzrange,
    "status" "AssignmentStatus" NOT NULL DEFAULT 'CONFIRMED',
    "selectionMethod" "SelectionMethod" NOT NULL,
    "driveMinutes" INTEGER NOT NULL,
    "driveMiles" DOUBLE PRECISION NOT NULL,
    "clinicPriceCents" INTEGER NOT NULL,
    "doctorPayCents" INTEGER NOT NULL,
    "promoDiscountCents" INTEGER NOT NULL DEFAULT 0,
    "mileageCents" INTEGER NOT NULL,
    "lodgingEstimateCents" INTEGER NOT NULL DEFAULT 0,
    "lodgingApprovedCents" INTEGER NOT NULL DEFAULT 0,
    "clinicTotalCents" INTEGER NOT NULL,
    "doctorTotalCents" INTEGER NOT NULL,
    "depositCents" INTEGER NOT NULL DEFAULT 0,
    "flags" TEXT[] DEFAULT ARRAY[]::TEXT[],
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
    "doctorId" TEXT NOT NULL,
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
    "doctorId" TEXT NOT NULL,
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
    "doctorId" TEXT NOT NULL,
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
    "durationTier" "DurationTier" NOT NULL,
    "clinicPriceCents" INTEGER NOT NULL,
    "doctorPayCents" INTEGER NOT NULL,
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
CREATE UNIQUE INDEX "Doctor_userId_key" ON "Doctor"("userId");

-- CreateIndex
CREATE UNIQUE INDEX "Doctor_npi_key" ON "Doctor"("npi");

-- CreateIndex
CREATE UNIQUE INDEX "Doctor_stripeAccountId_key" ON "Doctor"("stripeAccountId");

-- CreateIndex
CREATE INDEX "License_state_status_expiresAt_idx" ON "License"("state", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "License_doctorId_state_licenseType_key" ON "License"("doctorId", "state", "licenseType");

-- CreateIndex
CREATE INDEX "MalpracticePolicy_doctorId_status_expiresAt_idx" ON "MalpracticePolicy"("doctorId", "status", "expiresAt");

-- CreateIndex
CREATE UNIQUE INDEX "Technique_name_key" ON "Technique"("name");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicOrg_stripeCustomerId_key" ON "ClinicOrg"("stripeCustomerId");

-- CreateIndex
CREATE UNIQUE INDEX "ClinicMember_clinicOrgId_userId_key" ON "ClinicMember"("clinicOrgId", "userId");

-- CreateIndex
CREATE INDEX "Shift_state_status_startsAt_idx" ON "Shift"("state", "status", "startsAt");

-- CreateIndex
CREATE INDEX "Shift_locationId_startsAt_idx" ON "Shift"("locationId", "startsAt");

-- CreateIndex
CREATE INDEX "Application_doctorId_status_idx" ON "Application"("doctorId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "Application_shiftId_doctorId_key" ON "Application"("shiftId", "doctorId");

-- CreateIndex
CREATE INDEX "Offer_doctorId_status_idx" ON "Offer"("doctorId", "status");

-- CreateIndex
CREATE INDEX "Offer_shiftId_status_idx" ON "Offer"("shiftId", "status");

-- CreateIndex
CREATE INDEX "MatchRun_shiftId_createdAt_idx" ON "MatchRun"("shiftId", "createdAt");

-- CreateIndex
CREATE INDEX "Assignment_doctorId_status_startsAt_idx" ON "Assignment"("doctorId", "status", "startsAt");

-- CreateIndex
CREATE INDEX "Assignment_shiftId_idx" ON "Assignment"("shiftId");

-- CreateIndex
CREATE UNIQUE INDEX "Favorite_fromType_fromId_toType_toId_key" ON "Favorite"("fromType", "fromId", "toType", "toId");

-- CreateIndex
CREATE UNIQUE INDEX "Block_fromType_fromId_toType_toId_key" ON "Block"("fromType", "fromId", "toType", "toId");

-- CreateIndex
CREATE UNIQUE INDEX "Rating_assignmentId_raterType_key" ON "Rating"("assignmentId", "raterType");

-- CreateIndex
CREATE UNIQUE INDEX "MessageThread_clinicOrgId_doctorId_key" ON "MessageThread"("clinicOrgId", "doctorId");

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
CREATE INDEX "Payout_doctorId_status_idx" ON "Payout"("doctorId", "status");

-- CreateIndex
CREATE INDEX "Payout_status_releaseAt_idx" ON "Payout"("status", "releaseAt");

-- CreateIndex
CREATE UNIQUE INDEX "Payout_assignmentId_kind_key" ON "Payout"("assignmentId", "kind");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutTransfer_stripeTransferId_key" ON "PayoutTransfer"("stripeTransferId");

-- CreateIndex
CREATE UNIQUE INDEX "PayoutTransfer_idempotencyKey_key" ON "PayoutTransfer"("idempotencyKey");

-- CreateIndex
CREATE INDEX "PayoutTransfer_doctorId_createdAt_idx" ON "PayoutTransfer"("doctorId", "createdAt");

-- CreateIndex
CREATE INDEX "Dispute_assignmentId_status_idx" ON "Dispute"("assignmentId", "status");

-- CreateIndex
CREATE UNIQUE INDEX "AgreementSignature_envelopeId_key" ON "AgreementSignature"("envelopeId");

-- CreateIndex
CREATE INDEX "AgreementSignature_partyType_partyId_idx" ON "AgreementSignature"("partyType", "partyId");

-- CreateIndex
CREATE UNIQUE INDEX "RateRegion_name_key" ON "RateRegion"("name");

-- CreateIndex
CREATE INDEX "RateCard_rateRegionId_durationTier_effectiveFrom_idx" ON "RateCard"("rateRegionId", "durationTier", "effectiveFrom");

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

-- AddForeignKey
ALTER TABLE "Session" ADD CONSTRAINT "Session_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Doctor" ADD CONSTRAINT "Doctor_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "License" ADD CONSTRAINT "License_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MalpracticePolicy" ADD CONSTRAINT "MalpracticePolicy_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorTechnique" ADD CONSTRAINT "DoctorTechnique_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorTechnique" ADD CONSTRAINT "DoctorTechnique_techniqueId_fkey" FOREIGN KEY ("techniqueId") REFERENCES "Technique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityRule" ADD CONSTRAINT "AvailabilityRule_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityBlackout" ADD CONSTRAINT "AvailabilityBlackout_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "AvailabilityOpenDate" ADD CONSTRAINT "AvailabilityOpenDate_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "DoctorStats" ADD CONSTRAINT "DoctorStats_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicMember" ADD CONSTRAINT "ClinicMember_clinicOrgId_fkey" FOREIGN KEY ("clinicOrgId") REFERENCES "ClinicOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicMember" ADD CONSTRAINT "ClinicMember_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicLocation" ADD CONSTRAINT "ClinicLocation_clinicOrgId_fkey" FOREIGN KEY ("clinicOrgId") REFERENCES "ClinicOrg"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "ClinicLocation" ADD CONSTRAINT "ClinicLocation_rateRegionId_fkey" FOREIGN KEY ("rateRegionId") REFERENCES "RateRegion"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationTechnique" ADD CONSTRAINT "LocationTechnique_locationId_fkey" FOREIGN KEY ("locationId") REFERENCES "ClinicLocation"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LocationTechnique" ADD CONSTRAINT "LocationTechnique_techniqueId_fkey" FOREIGN KEY ("techniqueId") REFERENCES "Technique"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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
ALTER TABLE "Application" ADD CONSTRAINT "Application_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Offer" ADD CONSTRAINT "Offer_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MatchRun" ADD CONSTRAINT "MatchRun_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Assignment" ADD CONSTRAINT "Assignment_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Rating" ADD CONSTRAINT "Rating_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_clinicOrgId_fkey" FOREIGN KEY ("clinicOrgId") REFERENCES "ClinicOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "MessageThread" ADD CONSTRAINT "MessageThread_shiftId_fkey" FOREIGN KEY ("shiftId") REFERENCES "Shift"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Message" ADD CONSTRAINT "Message_threadId_fkey" FOREIGN KEY ("threadId") REFERENCES "MessageThread"("id") ON DELETE CASCADE ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_clinicOrgId_fkey" FOREIGN KEY ("clinicOrgId") REFERENCES "ClinicOrg"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payment" ADD CONSTRAINT "Payment_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Payout" ADD CONSTRAINT "Payout_transferId_fkey" FOREIGN KEY ("transferId") REFERENCES "PayoutTransfer"("id") ON DELETE SET NULL ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "PayoutTransfer" ADD CONSTRAINT "PayoutTransfer_doctorId_fkey" FOREIGN KEY ("doctorId") REFERENCES "Doctor"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "LodgingReceipt" ADD CONSTRAINT "LodgingReceipt_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "Dispute" ADD CONSTRAINT "Dispute_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

-- AddForeignKey
ALTER TABLE "RateCard" ADD CONSTRAINT "RateCard_rateRegionId_fkey" FOREIGN KEY ("rateRegionId") REFERENCES "RateRegion"("id") ON DELETE RESTRICT ON UPDATE CASCADE;

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

