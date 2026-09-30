-- Florida pricing: two rate regions instead of North / Central / South.
--   FL-Major cities   (higher rate): Miami, Fort Lauderdale, West Palm Beach,
--                     Orlando, Tampa, St. Petersburg, Jacksonville
--   FL-Smaller cities (lower rate): everywhere else in Florida
-- Keeps the existing rate cards (the old South prices become the major-city
-- prices, the old Central prices the smaller-city prices), re-points clinic
-- locations by ZIP code, and removes the old North region if nothing uses it.
-- Safe to run more than once. Run in Neon: SQL Editor → paste → Run.

BEGIN;

UPDATE "RateRegion" SET name = 'FL-Major cities', tier = 1,
  "zip3List" = ARRAY['320','322','327','328','330','331','332','333','334','335','336','337','347']
WHERE name = 'FL-South';

UPDATE "RateRegion" SET name = 'FL-Smaller cities', tier = 2,
  "zip3List" = ARRAY['321','323','324','325','326','329','338','339','341','342','344','346','349']
WHERE name = 'FL-Central';

-- Its ZIP codes now belong to the two regions above.
UPDATE "RateRegion" SET "zip3List" = ARRAY[]::TEXT[] WHERE name = 'FL-North';

-- Clinic locations follow their ZIP code to the new region.
UPDATE "ClinicLocation" l SET "rateRegionId" = r.id
FROM "RateRegion" r
WHERE l.state = 'FL' AND r.state = 'FL' AND substr(l.zip, 1, 3) = ANY (r."zip3List")
  AND l."rateRegionId" IS DISTINCT FROM r.id;

UPDATE "StateConfig" SET "defaultRateRegionId" = (SELECT id FROM "RateRegion" WHERE name = 'FL-Smaller cities')
WHERE state = 'FL' AND EXISTS (SELECT 1 FROM "RateRegion" WHERE name = 'FL-Smaller cities');

-- Remove the old North region, keeping any rate card an existing shift was priced from.
DELETE FROM "RateCard" c USING "RateRegion" r
WHERE c."rateRegionId" = r.id AND r.name = 'FL-North'
  AND NOT EXISTS (SELECT 1 FROM "Shift" s WHERE s."rateCardId" = c.id);
DELETE FROM "RateRegion" r
WHERE r.name = 'FL-North'
  AND NOT EXISTS (SELECT 1 FROM "RateCard" c WHERE c."rateRegionId" = r.id)
  AND NOT EXISTS (SELECT 1 FROM "ClinicLocation" l WHERE l."rateRegionId" = r.id);

COMMIT;

SELECT name, tier, cardinality("zip3List") AS zip_areas FROM "RateRegion" WHERE state = 'FL' ORDER BY tier, name;
