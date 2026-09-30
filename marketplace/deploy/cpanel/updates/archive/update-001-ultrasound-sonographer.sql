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

-- Florida row (disabled until you add rates and enable it): Florida doesn't
-- license sonographers, so a verified national registry credential is the minimum.
INSERT INTO "ProfessionStateConfig" ("professionCode", "state", "licensedAtStateLevel", "alternativeCredentialAllowed",
  "alternativeCredentialPolicy", "credentialTitle", "supervisingProfessionCodes",
  "malpracticeMinOccurrenceCents", "malpracticeMinAggregateCents", "scopeNotes")
VALUES ('SONO', 'FL', false, true,
  'ARDMS (RDMS, RDCS, RVT, RMSKS), CCI (RCS, RCCS, RVS, RPhS) or ARRT sonography (S, BS, VS)', 'Sonographer', ARRAY[]::TEXT[],
  100000000, 300000000, 'Florida does not license sonographers; a verified national registry credential is required instead.')
ON CONFLICT ("professionCode", "state") DO NOTHING;

COMMIT;

SELECT (SELECT count(*) FROM "Profession" WHERE "code" = 'SONO') AS profession_added,
       (SELECT count(*) FROM "Skill" WHERE "professionCode" = 'SONO') AS skills_added;
