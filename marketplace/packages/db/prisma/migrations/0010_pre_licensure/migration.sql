-- Pre-licensure (students & new graduates): opt-in student flag and intake
-- fields on Provider, acquisition attribution, credential follow-up tracking,
-- and RecruitCampaign (coverageoncall.com/join/<slug>). Additive only; no
-- eligibility logic or trigger reads any of these columns.
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "preLicensure" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "preLicensureSince" TIMESTAMPTZ(3);
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "graduatedOutAt" TIMESTAMPTZ(3);
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "graduationDate" DATE;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "licensureApplied" TEXT;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "expectedLicensure" TEXT;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "intendedStates" TEXT[] DEFAULT ARRAY[]::TEXT[];
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "preferredArea" TEXT;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "homeZip" TEXT;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "homeCounty" TEXT;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "acquisitionSource" TEXT;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "acquisitionDetail" TEXT;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "recruitCampaignId" TEXT;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "utmSource" TEXT;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "utmMedium" TEXT;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "utmCampaign" TEXT;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "utmTerm" TEXT;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "utmContent" TEXT;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "landingPath" TEXT;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "referredBy" TEXT;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "credFollowupStep" INTEGER NOT NULL DEFAULT 0;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "credFollowupLastAt" TIMESTAMPTZ(3);
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "credFollowupLastKind" TEXT;
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "credFollowupOptOut" BOOLEAN NOT NULL DEFAULT false;

CREATE TABLE IF NOT EXISTS "RecruitCampaign" (
    "id" TEXT NOT NULL,
    "slug" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "kind" TEXT NOT NULL DEFAULT 'SCHOOL',
    "state" CHAR(2),
    "city" TEXT,
    "headline" TEXT,
    "costCents" INTEGER NOT NULL DEFAULT 0,
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "RecruitCampaign_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "RecruitCampaign_slug_key" ON "RecruitCampaign"("slug");

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_constraint WHERE conname = 'Provider_recruitCampaignId_fkey') THEN
    ALTER TABLE "Provider" ADD CONSTRAINT "Provider_recruitCampaignId_fkey" FOREIGN KEY ("recruitCampaignId") REFERENCES "RecruitCampaign"("id") ON DELETE SET NULL ON UPDATE CASCADE;
  END IF;
END $$;

CREATE INDEX IF NOT EXISTS "Provider_preLicensure_idx" ON "Provider"("preLicensure");

-- Chiropractic schools, one recruitment link each (edit or add more in Admin → Recruitment).
INSERT INTO "RecruitCampaign" ("id", "slug", "name", "kind", "state", "city") VALUES
  ('rc_palmer', 'palmer', 'Palmer College of Chiropractic - Florida', 'SCHOOL', 'FL', 'Port Orange'),
  ('rc_keiser', 'keiser', 'Keiser University College of Chiropractic Medicine', 'SCHOOL', 'FL', 'West Palm Beach'),
  ('rc_life', 'life', 'Life University College of Chiropractic', 'SCHOOL', 'GA', 'Marietta'),
  ('rc_sherman', 'sherman', 'Sherman College of Chiropractic', 'SCHOOL', 'SC', 'Spartanburg'),
  ('rc_logan', 'logan', 'Logan University College of Chiropractic', 'SCHOOL', 'MO', 'Chesterfield'),
  ('rc_parker', 'parker', 'Parker University', 'SCHOOL', 'TX', 'Dallas'),
  ('rc_national', 'national', 'National University of Health Sciences', 'SCHOOL', 'IL', 'Lombard'),
  ('rc_nwhsu', 'nwhsu', 'Northwestern Health Sciences University', 'SCHOOL', 'MN', 'Bloomington'),
  ('rc_cleveland', 'cleveland', 'Cleveland University-Kansas City', 'SCHOOL', 'KS', 'Overland Park'),
  ('rc_texas', 'texas', 'Texas Chiropractic College', 'SCHOOL', 'TX', 'Pasadena'),
  ('rc_uws', 'uws', 'University of Western States', 'SCHOOL', 'OR', 'Portland'),
  ('rc_lifewest', 'lifewest', 'Life Chiropractic College West', 'SCHOOL', 'CA', 'Hayward'),
  ('rc_scu', 'scu', 'Southern California University of Health Sciences', 'SCHOOL', 'CA', 'Whittier'),
  ('rc_northeast', 'northeast', 'Northeast College of Health Sciences', 'SCHOOL', 'NY', 'Seneca Falls'),
  ('rc_bridgeport', 'bridgeport', 'University of Bridgeport School of Chiropractic', 'SCHOOL', 'CT', 'Bridgeport'),
  ('rc_palmer_davenport', 'palmer-davenport', 'Palmer College of Chiropractic - Davenport', 'SCHOOL', 'IA', 'Davenport'),
  ('rc_palmer_west', 'palmer-west', 'Palmer College of Chiropractic - West', 'SCHOOL', 'CA', 'San Jose')
ON CONFLICT ("slug") DO NOTHING;
