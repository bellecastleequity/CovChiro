ALTER TABLE cases
  ADD COLUMN mediation_on DATE NULL AFTER date_authorized,
  ADD COLUMN trial_on DATE NULL AFTER mediation_on,
  ADD COLUMN settlement_signed_on DATE NULL AFTER trial_on,
  ADD COLUMN disbursement_expected_on DATE NULL AFTER settlement_signed_on
