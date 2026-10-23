ALTER TABLE practices ADD COLUMN narrative_fees TEXT NULL AFTER guide_order;
ALTER TABLE cases ADD COLUMN narrative_fee DECIMAL(10,2) NULL AFTER narrative_requested_on, ADD COLUMN narrative_fee_ack_at DATETIME NULL AFTER narrative_fee, ADD COLUMN narrative_fee_ack_by VARCHAR(120) NULL AFTER narrative_fee_ack_at, ADD COLUMN narrative_fee_ack_via VARCHAR(10) NULL AFTER narrative_fee_ack_by
