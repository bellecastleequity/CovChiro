-- Apollo.io as a Growth prospecting source + geographic acquisition priorities (supply vs demand).
-- Provider prospects found outside the NPI registry (Apollo, Canada) have no NPI until matched.
ALTER TABLE "ProviderProspect" ALTER COLUMN "npi" DROP NOT NULL;
ALTER TABLE "ProviderProspect" ADD COLUMN IF NOT EXISTS "apolloPersonId" TEXT;
ALTER TABLE "ProviderProspect" ADD COLUMN IF NOT EXISTS "apolloOrganizationId" TEXT;
ALTER TABLE "ProviderProspect" ADD COLUMN IF NOT EXISTS "title" TEXT;
ALTER TABLE "ProviderProspect" ADD COLUMN IF NOT EXISTS "sourceVerifiedAt" TIMESTAMPTZ(3);
ALTER TABLE "ProviderProspect" ADD COLUMN IF NOT EXISTS "enrichmentStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "ProviderProspect" ADD COLUMN IF NOT EXISTS "enrichmentCredits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ProviderProspect" ADD COLUMN IF NOT EXISTS "consentBasis" TEXT;
ALTER TABLE "ProviderProspect" ADD COLUMN IF NOT EXISTS "consentNote" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "ProviderProspect_apolloPersonId_key" ON "ProviderProspect"("apolloPersonId");

ALTER TABLE "ClinicProspect" ADD COLUMN IF NOT EXISTS "apolloOrganizationId" TEXT;
ALTER TABLE "ClinicProspect" ADD COLUMN IF NOT EXISTS "apolloPersonId" TEXT;
ALTER TABLE "ClinicProspect" ADD COLUMN IF NOT EXISTS "decisionMakerTitle" TEXT;
ALTER TABLE "ClinicProspect" ADD COLUMN IF NOT EXISTS "sourceVerifiedAt" TIMESTAMPTZ(3);
ALTER TABLE "ClinicProspect" ADD COLUMN IF NOT EXISTS "enrichmentStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "ClinicProspect" ADD COLUMN IF NOT EXISTS "enrichmentCredits" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "ClinicProspect" ADD COLUMN IF NOT EXISTS "consentBasis" TEXT;
ALTER TABLE "ClinicProspect" ADD COLUMN IF NOT EXISTS "consentNote" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "ClinicProspect_apolloOrganizationId_key" ON "ClinicProspect"("apolloOrganizationId");

ALTER TABLE "GrowthMarket" ADD COLUMN IF NOT EXISTS "acquisitionPriority" TEXT;
ALTER TABLE "GrowthMarket" ADD COLUMN IF NOT EXISTS "recommendedSide" TEXT;
ALTER TABLE "GrowthMarket" ADD COLUMN IF NOT EXISTS "recommendationKind" TEXT;
ALTER TABLE "GrowthMarket" ADD COLUMN IF NOT EXISTS "recommendationReason" TEXT;
ALTER TABLE "GrowthMarket" ADD COLUMN IF NOT EXISTS "recommendedAt" TIMESTAMPTZ(3);

CREATE TABLE IF NOT EXISTS "DataSourceUsage" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "operation" TEXT NOT NULL,
  "side" TEXT,
  "region" TEXT,
  "marketKey" TEXT,
  "createdById" TEXT,
  "task" TEXT NOT NULL,
  "records" INTEGER NOT NULL DEFAULT 0,
  "creditsEstimated" INTEGER NOT NULL DEFAULT 0,
  "ok" BOOLEAN NOT NULL DEFAULT true,
  "error" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "DataSourceUsage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "DataSourceUsage_source_createdAt_idx" ON "DataSourceUsage"("source", "createdAt");

CREATE TABLE IF NOT EXISTS "ProspectSearch" (
  "id" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "side" TEXT NOT NULL,
  "region" TEXT NOT NULL,
  "city" TEXT,
  "professionCode" TEXT NOT NULL DEFAULT 'DC',
  "params" JSONB NOT NULL,
  "results" JSONB NOT NULL,
  "total" INTEGER,
  "creditsEstimated" INTEGER NOT NULL DEFAULT 0,
  "createdById" TEXT,
  "expiresAt" TIMESTAMPTZ(3) NOT NULL,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "ProspectSearch_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "ProspectSearch_expiresAt_idx" ON "ProspectSearch"("expiresAt");
