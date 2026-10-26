-- Checks that arrive without an EOB — most often a PIP demand or suit
-- payment the insurer mails to the clinic's attorney, forwarded with a
-- cover letter. Kept as eobs rows of kind 'payment', with the firm it came
-- through, the firm's file number, whether it was recovered through a
-- demand or suit, and any attorney fees the insurer paid with it.
ALTER TABLE eobs
  ADD COLUMN via VARCHAR(120) NULL AFTER kind,
  ADD COLUMN via_ref VARCHAR(60) NULL AFTER via,
  ADD COLUMN recovery TINYINT(1) NOT NULL DEFAULT 0 AFTER via_ref,
  ADD COLUMN fees DECIMAL(10,2) NULL AFTER interest;
