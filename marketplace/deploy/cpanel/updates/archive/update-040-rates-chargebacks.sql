-- CoverageOnCall database update 040: Puerto Rico and U.S. Virgin Islands rate regions and chiropractic rate cards (territories stay off until enabled), and card-dispute (chargeback) records. Applied automatically by the updater; or run in the Neon SQL editor after update-039. Safe to re-run.
-- @migration 0042_territory_rates
-- @migration 0043_chargebacks
SELECT 'update-040 applied' AS result;
