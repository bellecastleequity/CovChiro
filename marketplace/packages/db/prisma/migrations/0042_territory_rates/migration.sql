-- Rate regions and chiropractic rate cards for Puerto Rico (same as Florida smaller cities) and the U.S. Virgin Islands
-- (about 20% above Florida major cities); owner-approved Oct 2026. Both territories stay off until enabled. Re-runnable.
INSERT INTO "RateRegion" ("id","state","name","zip3List","tier") VALUES ('rr_pr_all','PR','PR-All',ARRAY['006','007','009']::TEXT[],2) ON CONFLICT ("name") DO NOTHING;
INSERT INTO "RateCard" ("id","rateRegionId","professionCode","durationTier","clinicPriceCents","providerPayCents","volumeTier","effectiveFrom")
SELECT 'rc_pr_half_day_light', r.id, 'DC', 'HALF_DAY'::"DurationTier", 25000, 21500, 'LIGHT'::"VolumeTier", '2026-10-01T00:00:00Z'::timestamptz FROM "RateRegion" r
WHERE r.name = 'PR-All' AND EXISTS (SELECT 1 FROM "Profession" p WHERE p.code = 'DC') AND NOT EXISTS (SELECT 1 FROM "RateCard" x WHERE x."rateRegionId" = r.id AND x."professionCode" = 'DC' AND x."durationTier" = 'HALF_DAY' AND x."volumeTier" = 'LIGHT');
INSERT INTO "RateCard" ("id","rateRegionId","professionCode","durationTier","clinicPriceCents","providerPayCents","volumeTier","effectiveFrom")
SELECT 'rc_pr_half_day_busy', r.id, 'DC', 'HALF_DAY'::"DurationTier", 32500, 26500, 'BUSY'::"VolumeTier", '2026-10-01T00:00:00Z'::timestamptz FROM "RateRegion" r
WHERE r.name = 'PR-All' AND EXISTS (SELECT 1 FROM "Profession" p WHERE p.code = 'DC') AND NOT EXISTS (SELECT 1 FROM "RateCard" x WHERE x."rateRegionId" = r.id AND x."professionCode" = 'DC' AND x."durationTier" = 'HALF_DAY' AND x."volumeTier" = 'BUSY');
INSERT INTO "RateCard" ("id","rateRegionId","professionCode","durationTier","clinicPriceCents","providerPayCents","volumeTier","effectiveFrom")
SELECT 'rc_pr_full_day_light', r.id, 'DC', 'FULL_DAY'::"DurationTier", 45000, 39000, 'LIGHT'::"VolumeTier", '2026-10-01T00:00:00Z'::timestamptz FROM "RateRegion" r
WHERE r.name = 'PR-All' AND EXISTS (SELECT 1 FROM "Profession" p WHERE p.code = 'DC') AND NOT EXISTS (SELECT 1 FROM "RateCard" x WHERE x."rateRegionId" = r.id AND x."professionCode" = 'DC' AND x."durationTier" = 'FULL_DAY' AND x."volumeTier" = 'LIGHT');
INSERT INTO "RateCard" ("id","rateRegionId","professionCode","durationTier","clinicPriceCents","providerPayCents","volumeTier","effectiveFrom")
SELECT 'rc_pr_full_day_busy', r.id, 'DC', 'FULL_DAY'::"DurationTier", 57500, 46500, 'BUSY'::"VolumeTier", '2026-10-01T00:00:00Z'::timestamptz FROM "RateRegion" r
WHERE r.name = 'PR-All' AND EXISTS (SELECT 1 FROM "Profession" p WHERE p.code = 'DC') AND NOT EXISTS (SELECT 1 FROM "RateCard" x WHERE x."rateRegionId" = r.id AND x."professionCode" = 'DC' AND x."durationTier" = 'FULL_DAY' AND x."volumeTier" = 'BUSY');
UPDATE "StateConfig" s SET "defaultRateRegionId" = r.id FROM "RateRegion" r WHERE r.name = 'PR-All' AND s.state = 'PR' AND s."defaultRateRegionId" IS NULL;
INSERT INTO "RateRegion" ("id","state","name","zip3List","tier") VALUES ('rr_vi_all','VI','VI-All',ARRAY['008']::TEXT[],1) ON CONFLICT ("name") DO NOTHING;
INSERT INTO "RateCard" ("id","rateRegionId","professionCode","durationTier","clinicPriceCents","providerPayCents","volumeTier","effectiveFrom")
SELECT 'rc_vi_half_day_light', r.id, 'DC', 'HALF_DAY'::"DurationTier", 33000, 28000, 'LIGHT'::"VolumeTier", '2026-10-01T00:00:00Z'::timestamptz FROM "RateRegion" r
WHERE r.name = 'VI-All' AND EXISTS (SELECT 1 FROM "Profession" p WHERE p.code = 'DC') AND NOT EXISTS (SELECT 1 FROM "RateCard" x WHERE x."rateRegionId" = r.id AND x."professionCode" = 'DC' AND x."durationTier" = 'HALF_DAY' AND x."volumeTier" = 'LIGHT');
INSERT INTO "RateCard" ("id","rateRegionId","professionCode","durationTier","clinicPriceCents","providerPayCents","volumeTier","effectiveFrom")
SELECT 'rc_vi_half_day_busy', r.id, 'DC', 'HALF_DAY'::"DurationTier", 45000, 35500, 'BUSY'::"VolumeTier", '2026-10-01T00:00:00Z'::timestamptz FROM "RateRegion" r
WHERE r.name = 'VI-All' AND EXISTS (SELECT 1 FROM "Profession" p WHERE p.code = 'DC') AND NOT EXISTS (SELECT 1 FROM "RateCard" x WHERE x."rateRegionId" = r.id AND x."professionCode" = 'DC' AND x."durationTier" = 'HALF_DAY' AND x."volumeTier" = 'BUSY');
INSERT INTO "RateCard" ("id","rateRegionId","professionCode","durationTier","clinicPriceCents","providerPayCents","volumeTier","effectiveFrom")
SELECT 'rc_vi_full_day_light', r.id, 'DC', 'FULL_DAY'::"DurationTier", 60000, 50500, 'LIGHT'::"VolumeTier", '2026-10-01T00:00:00Z'::timestamptz FROM "RateRegion" r
WHERE r.name = 'VI-All' AND EXISTS (SELECT 1 FROM "Profession" p WHERE p.code = 'DC') AND NOT EXISTS (SELECT 1 FROM "RateCard" x WHERE x."rateRegionId" = r.id AND x."professionCode" = 'DC' AND x."durationTier" = 'FULL_DAY' AND x."volumeTier" = 'LIGHT');
INSERT INTO "RateCard" ("id","rateRegionId","professionCode","durationTier","clinicPriceCents","providerPayCents","volumeTier","effectiveFrom")
SELECT 'rc_vi_full_day_busy', r.id, 'DC', 'FULL_DAY'::"DurationTier", 75000, 60000, 'BUSY'::"VolumeTier", '2026-10-01T00:00:00Z'::timestamptz FROM "RateRegion" r
WHERE r.name = 'VI-All' AND EXISTS (SELECT 1 FROM "Profession" p WHERE p.code = 'DC') AND NOT EXISTS (SELECT 1 FROM "RateCard" x WHERE x."rateRegionId" = r.id AND x."professionCode" = 'DC' AND x."durationTier" = 'FULL_DAY' AND x."volumeTier" = 'BUSY');
UPDATE "StateConfig" s SET "defaultRateRegionId" = r.id FROM "RateRegion" r WHERE r.name = 'VI-All' AND s.state = 'VI' AND s."defaultRateRegionId" IS NULL;
