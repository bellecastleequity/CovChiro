-- Volume pricing (Addendum 03): LIGHT / BUSY rate cards, per-visit overage terms on each shift, visit counts,
-- provider minimum pay (filter F12). Re-runnable.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'VolumeTier') THEN
    CREATE TYPE "VolumeTier" AS ENUM ('LIGHT', 'BUSY');
  END IF;
END $$;
ALTER TYPE "PaymentType" ADD VALUE IF NOT EXISTS 'VOLUME';
ALTER TYPE "PayoutKind" ADD VALUE IF NOT EXISTS 'VOLUME';

ALTER TABLE "Profession" ADD COLUMN IF NOT EXISTS "volumePricingEnabled" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "RateCard" ADD COLUMN IF NOT EXISTS "volumeTier" "VolumeTier";
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "declaredTier" "VolumeTier";
ALTER TABLE "Shift" ADD COLUMN IF NOT EXISTS "volumeTerms" JSONB;

CREATE TABLE IF NOT EXISTS "VisitCount" (
    "assignmentId" TEXT NOT NULL,
    "providerVisits" INTEGER,
    "providerAt" TIMESTAMPTZ(3),
    "clinicVisits" INTEGER,
    "clinicAt" TIMESTAMPTZ(3),
    "clinicUserId" TEXT,
    "clinicReason" TEXT,
    "status" TEXT NOT NULL DEFAULT 'OPEN',
    "outcome" TEXT,
    "finalVisits" INTEGER,
    "overageVisits" INTEGER NOT NULL DEFAULT 0,
    "overageClinicCents" INTEGER NOT NULL DEFAULT 0,
    "overageProviderCents" INTEGER NOT NULL DEFAULT 0,
    "chargeDueAt" TIMESTAMPTZ(3),
    "chargedAt" TIMESTAMPTZ(3),
    "resolvedById" TEXT,
    "resolutionNote" TEXT,
    "reconciliation" JSONB,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "VisitCount_pkey" PRIMARY KEY ("assignmentId")
);
CREATE INDEX IF NOT EXISTS "VisitCount_status_chargeDueAt_idx" ON "VisitCount"("status", "chargeDueAt");

CREATE TABLE IF NOT EXISTS "ProviderPayFloor" (
    "providerId" TEXT NOT NULL,
    "professionCode" TEXT NOT NULL,
    "minHalfDayCents" INTEGER,
    "minFullDayCents" INTEGER,
    "minHourlyCents" INTEGER,
    "includeMileage" BOOLEAN NOT NULL DEFAULT false,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "ProviderPayFloor_pkey" PRIMARY KEY ("providerId","professionCode")
);

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'VisitCount_assignmentId_fkey') THEN
    ALTER TABLE "VisitCount" ADD CONSTRAINT "VisitCount_assignmentId_fkey" FOREIGN KEY ("assignmentId") REFERENCES "Assignment"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'ProviderPayFloor_providerId_fkey') THEN
    ALTER TABLE "ProviderPayFloor" ADD CONSTRAINT "ProviderPayFloor_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
  END IF;
END $$;

-- Owner-approved Florida chiropractic volume rates (clinic / provider, cents). Visit limits, grace
-- and per-visit amounts are Settings. Replaces the current flat DC cards in these regions from now on.
CREATE TEMP TABLE "_vol" (region TEXT, dur TEXT, tier TEXT, clinic INT, provider INT) ON COMMIT DROP;
INSERT INTO "_vol" VALUES
  ('FL-Smaller cities', 'FULL_DAY', 'LIGHT', 45000, 39000),
  ('FL-Smaller cities', 'FULL_DAY', 'BUSY',  57500, 46500),
  ('FL-Smaller cities', 'HALF_DAY', 'LIGHT', 25000, 21500),
  ('FL-Smaller cities', 'HALF_DAY', 'BUSY',  32500, 26500),
  ('FL-Major cities',   'FULL_DAY', 'LIGHT', 50000, 42000),
  ('FL-Major cities',   'FULL_DAY', 'BUSY',  62500, 50000),
  ('FL-Major cities',   'HALF_DAY', 'LIGHT', 27500, 23500),
  ('FL-Major cities',   'HALF_DAY', 'BUSY',  37500, 29500);

-- Only regions that don't have volume cards yet (re-running changes nothing).
CREATE TEMP TABLE "_vol_regions" ON COMMIT DROP AS
  SELECT r.id, r.name FROM "RateRegion" r
  WHERE r.name IN (SELECT region FROM "_vol")
    AND NOT EXISTS (SELECT 1 FROM "RateCard" c WHERE c."rateRegionId" = r.id AND c."professionCode" = 'DC' AND c."volumeTier" IS NOT NULL);

UPDATE "RateCard" c SET "effectiveTo" = now()
  FROM "_vol_regions" r
  WHERE c."rateRegionId" = r.id AND c."professionCode" = 'DC' AND c."volumeTier" IS NULL
    AND c."durationTier" IN ('HALF_DAY', 'FULL_DAY') AND (c."effectiveTo" IS NULL OR c."effectiveTo" > now());

INSERT INTO "RateCard" (id, "rateRegionId", "professionCode", "durationTier", "clinicPriceCents", "providerPayCents", "effectiveFrom", "volumeTier")
  SELECT 'rc_' || md5(r.id || v.dur || v.tier), r.id, 'DC', v.dur::"DurationTier", v.clinic, v.provider, now(), v.tier::"VolumeTier"
  FROM "_vol_regions" r JOIN "_vol" v ON v.region = r.name
  WHERE EXISTS (SELECT 1 FROM "Profession" p WHERE p.code = 'DC')
  ON CONFLICT (id) DO NOTHING;

UPDATE "Profession" SET "volumePricingEnabled" = true WHERE code = 'DC';
