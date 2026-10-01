-- Provider acquisition: provider prospects from the NPI registry, acquisition costs, market supply status. Re-runnable.
-- AlterTable
ALTER TABLE "GrowthCampaign" ADD COLUMN IF NOT EXISTS "geography" TEXT;

-- AlterTable
ALTER TABLE "GrowthMarket" ADD COLUMN IF NOT EXISTS "supplyCheckedAt" TIMESTAMPTZ(3),
ADD COLUMN IF NOT EXISTS "supplyStatus" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "ProviderProspect" (
    "id" TEXT NOT NULL,
    "npi" TEXT NOT NULL,
    "professionCode" TEXT NOT NULL,
    "firstName" TEXT,
    "lastName" TEXT,
    "credential" TEXT,
    "displayName" TEXT NOT NULL,
    "address" TEXT,
    "city" TEXT,
    "state" CHAR(2) NOT NULL,
    "zip" TEXT,
    "addressKey" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "marketKey" TEXT,
    "clinicProspectId" TEXT,
    "providersAtPractice" INTEGER NOT NULL DEFAULT 1,
    "practiceRole" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "source" TEXT NOT NULL DEFAULT 'NPPES NPI registry',
    "collectedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "researchStatus" TEXT NOT NULL DEFAULT 'PENDING',
    "researchAttempts" INTEGER NOT NULL DEFAULT 0,
    "researchedAt" TIMESTAMPTZ(3),
    "researchConfidence" DOUBLE PRECISION,
    "researchCostMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "website" TEXT,
    "email" CITEXT,
    "emailSourceUrl" TEXT,
    "emailOrigin" TEXT,
    "contactStatus" TEXT NOT NULL DEFAULT 'NONE',
    "emailVerifiedAt" TIMESTAMPTZ(3),
    "emailCheck" TEXT,
    "emailStatus" TEXT NOT NULL DEFAULT 'VALID',
    "sourceUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "stage" TEXT NOT NULL DEFAULT 'DISCOVERED',
    "needsReview" BOOLEAN NOT NULL DEFAULT false,
    "reviewReason" TEXT,
    "outreachStep" INTEGER NOT NULL DEFAULT 0,
    "lastContactedAt" TIMESTAMPTZ(3),
    "lastInboundAt" TIMESTAMPTZ(3),
    "outreachPaused" BOOLEAN NOT NULL DEFAULT false,
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "campaignCode" TEXT,
    "providerId" TEXT,
    "registeredAt" TIMESTAMPTZ(3),
    "publicToken" TEXT NOT NULL,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ProviderProspect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GrowthCost" (
    "id" TEXT NOT NULL,
    "month" DATE NOT NULL,
    "category" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'BOTH',
    "amountCents" INTEGER NOT NULL,
    "campaignCode" TEXT,
    "notes" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrowthCost_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ProviderProspect_npi_key" ON "ProviderProspect"("npi");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ProviderProspect_providerId_key" ON "ProviderProspect"("providerId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ProviderProspect_publicToken_key" ON "ProviderProspect"("publicToken");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProviderProspect_stage_idx" ON "ProviderProspect"("stage");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProviderProspect_professionCode_state_idx" ON "ProviderProspect"("professionCode", "state");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProviderProspect_researchStatus_idx" ON "ProviderProspect"("researchStatus");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProviderProspect_marketKey_idx" ON "ProviderProspect"("marketKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ProviderProspect_addressKey_idx" ON "ProviderProspect"("addressKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "GrowthCost_month_idx" ON "GrowthCost"("month");
