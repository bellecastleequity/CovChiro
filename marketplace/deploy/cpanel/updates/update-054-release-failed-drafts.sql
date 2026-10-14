-- CoverageOnCall database update 054: releases approved outreach drafts whose send failed during the Oct 12 SendGrid outage, so those steps are drafted again. Applied automatically by the updater; or run in the Neon SQL editor after update-053. Safe to re-run.
-- @migration 0057_release_failed_drafts
SELECT 'update-054 applied' AS result;
