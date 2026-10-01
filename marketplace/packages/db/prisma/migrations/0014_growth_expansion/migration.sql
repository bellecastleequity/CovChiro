-- Growth expansion (profession × state targets with prelaunch), per-profession registry settings,
-- profession-specific prompts/KB, account bans, and the schools dropdown. Re-runnable.

-- AlterTable
ALTER TABLE "ClinicProspect" ADD COLUMN IF NOT EXISTS "professionCodes" TEXT[] DEFAULT ARRAY['DC']::TEXT[];
ALTER TABLE "PromptTemplate" ADD COLUMN IF NOT EXISTS "professionCode" TEXT;
ALTER TABLE "KbArticle" ADD COLUMN IF NOT EXISTS "professionCode" TEXT;

-- CreateTable
CREATE TABLE IF NOT EXISTS "BannedEmail" (
    "email" CITEXT NOT NULL,
    "reason" TEXT,
    "createdById" TEXT,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "BannedEmail_pkey" PRIMARY KEY ("email")
);

CREATE TABLE IF NOT EXISTS "School" (
    "id" TEXT NOT NULL,
    "professionCode" TEXT NOT NULL,
    "name" TEXT NOT NULL,
    "city" TEXT,
    "state" CHAR(2),
    "active" BOOLEAN NOT NULL DEFAULT true,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CONSTRAINT "School_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "School_professionCode_name_key" ON "School"("professionCode", "name");

CREATE TABLE IF NOT EXISTS "GrowthTarget" (
    "id" TEXT NOT NULL,
    "professionCode" TEXT NOT NULL,
    "state" CHAR(2) NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'OFF',
    "cities" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "notes" TEXT,
    "statusChangedAt" TIMESTAMPTZ(3),
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "GrowthTarget_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "GrowthTarget_professionCode_state_key" ON "GrowthTarget"("professionCode", "state");

CREATE TABLE IF NOT EXISTS "GrowthProfession" (
    "professionCode" TEXT NOT NULL,
    "registrySearch" TEXT NOT NULL DEFAULT '',
    "taxonomyCodes" TEXT[] DEFAULT ARRAY[]::TEXT[],
    "practiceNoun" TEXT NOT NULL DEFAULT 'practice',
    "nameSuffix" TEXT NOT NULL DEFAULT '',
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    CONSTRAINT "GrowthProfession_pkey" PRIMARY KEY ("professionCode")
);

-- Registry settings per profession (NPI taxonomy). Admins can edit them in Growth → Expansion.
INSERT INTO "GrowthProfession" ("professionCode", "registrySearch", "taxonomyCodes", "practiceNoun", "nameSuffix", "updatedAt") VALUES
  ('DC',   'Chiropractor',                   ARRAY['111N'], 'chiropractic practice',          'D.C.',  CURRENT_TIMESTAMP),
  ('PT',   'Physical Therapist',             ARRAY['2251'], 'physical therapy clinic',        'PT',    CURRENT_TIMESTAMP),
  ('PTA',  'Physical Therapy Assistant',     ARRAY['2252'], 'physical therapy clinic',        'PTA',   CURRENT_TIMESTAMP),
  ('OT',   'Occupational Therapist',         ARRAY['225X'], 'occupational therapy practice',  'OT',    CURRENT_TIMESTAMP),
  ('OTA',  'Occupational Therapy Assistant', ARRAY['224Z'], 'occupational therapy practice',  'OTA',   CURRENT_TIMESTAMP),
  ('LMT',  'Massage Therapist',              ARRAY['2257'], 'massage therapy practice',       'LMT',   CURRENT_TIMESTAMP),
  ('LAC',  'Acupuncturist',                  ARRAY['1711'], 'acupuncture practice',           'L.Ac.', CURRENT_TIMESTAMP),
  ('ATC',  'Athletic Trainer',               ARRAY['2255'], 'athletic training practice',     'ATC',   CURRENT_TIMESTAMP),
  ('SONO', '',                               ARRAY[]::TEXT[], 'imaging practice',             '',      CURRENT_TIMESTAMP)
ON CONFLICT ("professionCode") DO NOTHING;

-- Florida chiropractic is the live market: its cities come from the old growth.discoveryAreas setting.
INSERT INTO "GrowthTarget" ("id", "professionCode", "state", "status", "cities", "statusChangedAt", "updatedAt")
SELECT gen_random_uuid()::text, 'DC', 'FL', 'LIVE',
  COALESCE(
    (SELECT ARRAY(SELECT jsonb_array_elements_text("value")) FROM "Setting" WHERE "key" = 'growth.discoveryAreas' AND jsonb_typeof("value") = 'array'),
    ARRAY['Orlando','Kissimmee','Winter Park','Sanford','Oviedo','Clermont','Lake Mary','Altamonte Springs','Apopka','Ocoee','Winter Garden','Daytona Beach','Deltona','Ocala','The Villages','Lakeland','Winter Haven',
      'Tampa','Brandon','Riverview','Wesley Chapel','Clearwater','St Petersburg','Largo','Palm Harbor','New Port Richey','Sarasota','Bradenton','Venice',
      'Jacksonville','Jacksonville Beach','Orange Park','St Augustine','Ponte Vedra Beach','Fernandina Beach','Gainesville','Palm Coast',
      'Miami','Miami Beach','Hialeah','Coral Gables','Doral','Homestead','Fort Lauderdale','Hollywood','Pembroke Pines','Coral Springs','Plantation','Davie','Boca Raton','Delray Beach','Boynton Beach','West Palm Beach','Jupiter','Palm Beach Gardens','Wellington','Port St Lucie','Stuart','Vero Beach','Melbourne','Palm Bay',
      'Fort Myers','Cape Coral','Naples','Bonita Springs','Port Charlotte','Punta Gorda',
      'Tallahassee','Pensacola','Panama City','Destin','Fort Walton Beach']
  ),
  CURRENT_TIMESTAMP, CURRENT_TIMESTAMP
ON CONFLICT ("professionCode", "state") DO NOTHING;
DELETE FROM "Setting" WHERE "key" IN ('growth.discoveryAreas', 'growth.launchState', 'growth.launchProfession');

-- Prompts written before this release are chiropractic wording (clinic onboarding and unfinished-request
-- emails are generic). Later any-profession versions are left alone if this is re-run.
UPDATE "PromptTemplate" SET "professionCode" = 'DC'
WHERE "professionCode" IS NULL AND "key" NOT IN ('CLINIC_ONBOARDING_NEXT_STEP', 'ABANDONED_COVERAGE_REQUEST')
  AND "createdAt" < TIMESTAMPTZ '2026-10-02 00:00:00+00';

-- Chiropractic schools for the student sign-up dropdown (CCE-accredited US programs).
INSERT INTO "School" ("id", "professionCode", "name", "city", "state") VALUES
  (gen_random_uuid()::text, 'DC', 'Cleveland University–Kansas City', 'Overland Park', 'KS'),
  (gen_random_uuid()::text, 'DC', 'D''Youville University (Chiropractic)', 'Buffalo', 'NY'),
  (gen_random_uuid()::text, 'DC', 'Keiser University College of Chiropractic Medicine', 'West Palm Beach', 'FL'),
  (gen_random_uuid()::text, 'DC', 'Life Chiropractic College West', 'Hayward', 'CA'),
  (gen_random_uuid()::text, 'DC', 'Life University', 'Marietta', 'GA'),
  (gen_random_uuid()::text, 'DC', 'Logan University', 'Chesterfield', 'MO'),
  (gen_random_uuid()::text, 'DC', 'National University of Health Sciences (Illinois)', 'Lombard', 'IL'),
  (gen_random_uuid()::text, 'DC', 'National University of Health Sciences (Florida)', 'Pinellas Park', 'FL'),
  (gen_random_uuid()::text, 'DC', 'Northeast College of Health Sciences', 'Seneca Falls', 'NY'),
  (gen_random_uuid()::text, 'DC', 'Northwestern Health Sciences University', 'Bloomington', 'MN'),
  (gen_random_uuid()::text, 'DC', 'Palmer College of Chiropractic (Davenport)', 'Davenport', 'IA'),
  (gen_random_uuid()::text, 'DC', 'Palmer College of Chiropractic (Florida)', 'Port Orange', 'FL'),
  (gen_random_uuid()::text, 'DC', 'Palmer College of Chiropractic (West)', 'San Jose', 'CA'),
  (gen_random_uuid()::text, 'DC', 'Parker University', 'Dallas', 'TX'),
  (gen_random_uuid()::text, 'DC', 'Sherman College of Chiropractic', 'Spartanburg', 'SC'),
  (gen_random_uuid()::text, 'DC', 'Southern California University of Health Sciences', 'Whittier', 'CA'),
  (gen_random_uuid()::text, 'DC', 'Texas Chiropractic College', 'Pasadena', 'TX'),
  (gen_random_uuid()::text, 'DC', 'University of Western States', 'Portland', 'OR')
ON CONFLICT ("professionCode", "name") DO NOTHING;
