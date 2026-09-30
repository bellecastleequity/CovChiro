-- Adds the Ultrasound Sonographer profession, its specialty skills and its
-- Florida settings row to a database that was set up before they existed.
-- Safe to run more than once: rows that already exist are left alone.
-- Run in Neon: SQL Editor → paste → Run.

BEGIN;

INSERT INTO "Profession" ("code", "displayName", "slug", "credentialSuffix", "npiRequired", "pricingModel",
  "defaultMalpracticeMinOccurrenceCents", "defaultMalpracticeMinAggregateCents",
  "requiresSupervisionDefault", "defaultSupervisingProfessionCodes", "active", "sortOrder")
VALUES ('SONO', 'Ultrasound Sonographer', 'ultrasound-sonography', 'Sonographer', false, 'HOURLY',
  100000000, 300000000, false, ARRAY[]::TEXT[], false, 9)
ON CONFLICT ("code") DO NOTHING;

-- Specialties, each backed by a registry credential (ARDMS / CCI / ARRT).
INSERT INTO "Skill" ("id", "name", "professionCode", "requiresCertification")
SELECT 'sono_' || md5(n), n, 'SONO', true
FROM unnest(ARRAY[
  'Abdomen', 'OB/GYN', 'Breast', 'Pediatric Sonography', 'Fetal Echocardiography',
  'Adult Echocardiography', 'Pediatric Echocardiography', 'Congenital Cardiac',
  'Vascular', 'Musculoskeletal', 'Phlebology/Venous'
]) AS n
ON CONFLICT ("name", "professionCode") DO NOTHING;

-- Florida row (disabled): Florida does not license sonographers.
INSERT INTO "ProfessionStateConfig" ("professionCode", "state", "licensedAtStateLevel", "credentialTitle",
  "supervisingProfessionCodes", "malpracticeMinOccurrenceCents", "malpracticeMinAggregateCents", "scopeNotes")
VALUES ('SONO', 'FL', false, 'Sonographer', ARRAY[]::TEXT[], 100000000, 300000000,
  'Florida does not license sonographers. Registry credentials (ARDMS/CCI/ARRT) are the norm; not enabled until national credentials are accepted.')
ON CONFLICT ("professionCode", "state") DO NOTHING;

COMMIT;

SELECT (SELECT count(*) FROM "Profession" WHERE "code" = 'SONO') AS profession_added,
       (SELECT count(*) FROM "Skill" WHERE "professionCode" = 'SONO') AS skills_added;
