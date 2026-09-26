-- Adds the missing signature capture on standing-day agreements (client
-- signs at request time; the provider's counter-signature is simply the
-- approval timestamp already recorded on standing_agreements.created_at —
-- no separate manual signing step needed). Safe to run on the existing
-- live database — additive only.

ALTER TABLE standing_requests
  ADD COLUMN signature JSON NULL;

ALTER TABLE standing_agreements
  ADD COLUMN signature JSON NULL;
