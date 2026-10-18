-- CoverageOnCall database update 061: Welcome Discount (15% off a clinic's first 3 completed bookings; entitlement + per-booking ledger; existing clinics' completed bookings count toward the three). Applied automatically by the updater; or run in the Neon SQL editor after update-060. Safe to re-run.
-- @migration 0064_welcome_discount
SELECT 'update-061 applied' AS result;
