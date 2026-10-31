-- Past EOBs brought in when a practice starts (history mode, or the bulk
-- import): saved for the EOB Genie report, usually not posted, since the
-- practice's ledger already has those payments.
ALTER TABLE eobs ADD COLUMN history TINYINT(1) NOT NULL DEFAULT 0 AFTER recovery;
