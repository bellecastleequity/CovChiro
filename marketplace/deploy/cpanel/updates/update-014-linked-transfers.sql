-- CoverageOnCall database update 014: provider pay linked to the clinic's charges (Stripe source_transaction),
-- so provider payments never depend on the platform's Stripe balance and daily payouts to the bank are safe.
-- Run once in the Neon SQL editor after installing this release (after update-013). Safe to re-run.
-- @migration 0016_linked_transfers
SELECT 'update-014 applied' AS result;
