-- CoverageOnCall database update 047: exclude a failed charge from automatic rebilling. Applied automatically by the updater; or run in the Neon SQL editor after update-046. Safe to re-run.
-- @migration 0050_rebill_guard
SELECT 'update-047 applied' AS result;
