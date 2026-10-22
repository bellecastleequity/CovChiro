ALTER TABLE practices
  ADD COLUMN badge_token CHAR(24) NULL AFTER baa_accepted_by,
  ADD COLUMN badge_enabled TINYINT(1) NOT NULL DEFAULT 0 AFTER badge_token,
  ADD COLUMN badge_enabled_at DATETIME NULL AFTER badge_enabled,
  ADD UNIQUE INDEX idx_practices_badge (badge_token)
