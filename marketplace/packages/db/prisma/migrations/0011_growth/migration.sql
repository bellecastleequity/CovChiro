-- Growth system: clinic prospect CRM, campaigns, suppression list, communications log,
-- versioned prompts, knowledge base, escalations, agent audit log, AI spend, lead signals,
-- launch markets; provider pre-licensure + follow-up columns. Re-runnable.
-- CreateEnum
DO $$ BEGIN CREATE TYPE "ProspectStage" AS ENUM ('PROSPECT', 'CONTACTABLE', 'OUTREACH_STARTED', 'ENGAGED', 'INTERESTED', 'ACCOUNT_STARTED', 'ACCOUNT_CREATED', 'COVERAGE_REQUESTED', 'FIRST_SHIFT_BOOKED', 'FIRST_SHIFT_COMPLETED', 'REPEAT_CLINIC', 'DORMANT', 'NOT_INTERESTED', 'DO_NOT_CONTACT'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN CREATE TYPE "IntentCategory" AS ENUM ('COLD', 'WARM', 'ENGAGED', 'HIGH_INTENT', 'ACTIVE_CUSTOMER', 'REPEAT_CUSTOMER'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN CREATE TYPE "PromptStatus" AS ENUM ('DRAFT', 'APPROVED', 'RETIRED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- CreateEnum
DO $$ BEGIN CREATE TYPE "EscalationStatus" AS ENUM ('OPEN', 'IN_PROGRESS', 'RESOLVED'); EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- AlterTable
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "activationCount" INTEGER NOT NULL DEFAULT 0,
ADD COLUMN IF NOT EXISTS "campaignCode" TEXT,
ADD COLUMN IF NOT EXISTS "graduationDate" DATE,
ADD COLUMN IF NOT EXISTS "growthSource" TEXT,
ADD COLUMN IF NOT EXISTS "isStudent" BOOLEAN NOT NULL DEFAULT false,
ADD COLUMN IF NOT EXISTS "lastActivationAt" TIMESTAMPTZ(3),
ADD COLUMN IF NOT EXISTS "lastNurtureAt" TIMESTAMPTZ(3),
ADD COLUMN IF NOT EXISTS "nurtureCount" INTEGER NOT NULL DEFAULT 0;

-- CreateTable
CREATE TABLE IF NOT EXISTS "GrowthMarket" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "state" CHAR(2) NOT NULL,
    "professionCode" TEXT NOT NULL DEFAULT 'DC',
    "centerLat" DOUBLE PRECISION NOT NULL,
    "centerLng" DOUBLE PRECISION NOT NULL,
    "radiusMiles" INTEGER NOT NULL DEFAULT 60,
    "targetProviders" INTEGER NOT NULL DEFAULT 5,
    "priority" INTEGER NOT NULL DEFAULT 100,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrowthMarket_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "ClinicProspect" (
    "id" TEXT NOT NULL,
    "clinicName" TEXT NOT NULL,
    "ownerName" TEXT,
    "doctors" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "email" CITEXT,
    "phone" TEXT,
    "website" TEXT,
    "address" TEXT,
    "city" TEXT,
    "county" TEXT,
    "state" CHAR(2) NOT NULL DEFAULT 'FL',
    "zip" TEXT,
    "lat" DOUBLE PRECISION,
    "lng" DOUBLE PRECISION,
    "marketKey" TEXT,
    "locationsCount" INTEGER,
    "providerCount" INTEGER,
    "practiceType" TEXT,
    "ownership" TEXT,
    "multidisciplinary" BOOLEAN,
    "hasContactForm" BOOLEAN,
    "socialUrls" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "source" TEXT,
    "collectedAt" TIMESTAMPTZ(3),
    "verifiedAt" TIMESTAMPTZ(3),
    "segment" TEXT NOT NULL DEFAULT 'unknown',
    "segmentConfidence" DOUBLE PRECISION,
    "segmentBasis" TEXT NOT NULL DEFAULT 'NONE',
    "segmentReason" TEXT,
    "stage" "ProspectStage" NOT NULL DEFAULT 'PROSPECT',
    "intentScore" INTEGER NOT NULL DEFAULT 0,
    "intentCategory" "IntentCategory" NOT NULL DEFAULT 'COLD',
    "clinicOrgId" TEXT,
    "emailStatus" TEXT NOT NULL DEFAULT 'UNKNOWN',
    "smsConsentAt" TIMESTAMPTZ(3),
    "doNotContact" BOOLEAN NOT NULL DEFAULT false,
    "outreachStep" INTEGER NOT NULL DEFAULT 0,
    "outreachPaused" BOOLEAN NOT NULL DEFAULT false,
    "lastContactedAt" TIMESTAMPTZ(3),
    "lastInboundAt" TIMESTAMPTZ(3),
    "objections" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "aiSummary" TEXT,
    "notes" TEXT,
    "campaignCode" TEXT,
    "publicToken" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "ClinicProspect_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "GrowthCampaign" (
    "id" TEXT NOT NULL,
    "code" TEXT NOT NULL,
    "audience" "PartyType" NOT NULL DEFAULT 'PROVIDER',
    "kind" TEXT NOT NULL DEFAULT 'school',
    "name" TEXT NOT NULL,
    "schoolName" TEXT,
    "professionCode" TEXT NOT NULL DEFAULT 'DC',
    "headline" TEXT,
    "body" TEXT,
    "spendCents" INTEGER NOT NULL DEFAULT 0,
    "visits" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "GrowthCampaign_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "CommSuppression" (
    "id" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "address" CITEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "source" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "CommSuppression_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Communication" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "channel" TEXT NOT NULL,
    "direction" TEXT NOT NULL DEFAULT 'OUT',
    "agent" TEXT,
    "purpose" TEXT NOT NULL,
    "promptKey" TEXT,
    "promptVersion" INTEGER,
    "toAddress" TEXT,
    "subject" TEXT,
    "body" TEXT,
    "status" TEXT NOT NULL,
    "blockReason" TEXT,
    "error" TEXT,
    "dedupeKey" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "Communication_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "PromptTemplate" (
    "id" TEXT NOT NULL,
    "key" TEXT NOT NULL,
    "version" INTEGER NOT NULL,
    "agent" TEXT NOT NULL,
    "channel" TEXT NOT NULL DEFAULT 'EMAIL',
    "purpose" TEXT NOT NULL,
    "subjectTemplate" TEXT,
    "body" TEXT NOT NULL,
    "instructions" TEXT,
    "allowedVars" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "abWeight" INTEGER NOT NULL DEFAULT 100,
    "status" "PromptStatus" NOT NULL DEFAULT 'DRAFT',
    "active" BOOLEAN NOT NULL DEFAULT false,
    "approvedById" TEXT,
    "approvedAt" TIMESTAMPTZ(3),
    "notes" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "PromptTemplate_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "KbArticle" (
    "id" TEXT NOT NULL,
    "topic" TEXT NOT NULL,
    "audience" TEXT NOT NULL DEFAULT 'ALL',
    "question" TEXT NOT NULL,
    "answer" TEXT NOT NULL,
    "keywords" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "approved" BOOLEAN NOT NULL DEFAULT false,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "updatedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,

    CONSTRAINT "KbArticle_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "Escalation" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT,
    "entityLabel" TEXT NOT NULL,
    "reasonCode" TEXT NOT NULL,
    "reason" TEXT NOT NULL,
    "intentLevel" TEXT,
    "summary" TEXT,
    "recommendedAction" TEXT,
    "history" JSONB,
    "status" "EscalationStatus" NOT NULL DEFAULT 'OPEN',
    "resolution" TEXT,
    "resolvedById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "resolvedAt" TIMESTAMPTZ(3),

    CONSTRAINT "Escalation_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AgentActivity" (
    "id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "action" TEXT NOT NULL,
    "entityType" TEXT,
    "entityId" TEXT,
    "trigger" TEXT,
    "contextRef" TEXT,
    "promptKey" TEXT,
    "promptVersion" INTEGER,
    "model" TEXT,
    "output" TEXT,
    "channel" TEXT,
    "sendStatus" TEXT,
    "humanOverrideBy" TEXT,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AgentActivity_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "AiUsage" (
    "id" TEXT NOT NULL,
    "agent" TEXT NOT NULL,
    "task" TEXT NOT NULL,
    "provider" TEXT NOT NULL,
    "model" TEXT NOT NULL,
    "inputTokens" INTEGER NOT NULL DEFAULT 0,
    "outputTokens" INTEGER NOT NULL DEFAULT 0,
    "costMicroUsd" INTEGER NOT NULL DEFAULT 0,
    "ok" BOOLEAN NOT NULL DEFAULT true,
    "error" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "AiUsage_pkey" PRIMARY KEY ("id")
);

-- CreateTable
CREATE TABLE IF NOT EXISTS "LeadSignal" (
    "id" TEXT NOT NULL,
    "entityType" TEXT NOT NULL,
    "entityId" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "meta" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "LeadSignal_pkey" PRIMARY KEY ("id")
);

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthMarket_key_key" ON "GrowthMarket"("key");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ClinicProspect_clinicOrgId_key" ON "ClinicProspect"("clinicOrgId");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "ClinicProspect_publicToken_key" ON "ClinicProspect"("publicToken");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClinicProspect_stage_idx" ON "ClinicProspect"("stage");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClinicProspect_marketKey_idx" ON "ClinicProspect"("marketKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClinicProspect_intentScore_idx" ON "ClinicProspect"("intentScore");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "ClinicProspect_email_idx" ON "ClinicProspect"("email");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthCampaign_code_key" ON "GrowthCampaign"("code");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "CommSuppression_channel_address_key" ON "CommSuppression"("channel", "address");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "Communication_dedupeKey_key" ON "Communication"("dedupeKey");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Communication_entityType_entityId_createdAt_idx" ON "Communication"("entityType", "entityId", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Communication_status_createdAt_idx" ON "Communication"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Communication_promptKey_promptVersion_idx" ON "Communication"("promptKey", "promptVersion");

-- CreateIndex
CREATE UNIQUE INDEX IF NOT EXISTS "PromptTemplate_key_version_key" ON "PromptTemplate"("key", "version");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Escalation_status_createdAt_idx" ON "Escalation"("status", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "Escalation_entityType_entityId_idx" ON "Escalation"("entityType", "entityId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentActivity_agent_createdAt_idx" ON "AgentActivity"("agent", "createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentActivity_entityType_entityId_idx" ON "AgentActivity"("entityType", "entityId");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AgentActivity_createdAt_idx" ON "AgentActivity"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "AiUsage_createdAt_idx" ON "AiUsage"("createdAt");

-- CreateIndex
CREATE INDEX IF NOT EXISTS "LeadSignal_entityType_entityId_createdAt_idx" ON "LeadSignal"("entityType", "entityId", "createdAt");

