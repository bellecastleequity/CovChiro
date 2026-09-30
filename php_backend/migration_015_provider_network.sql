-- Provider network: pre-licensure recruitment & credentialing.
--
-- Chiropractic students and new graduates can create a provider account
-- before they are licensed or insured. Registration and shift eligibility are
-- deliberately separate: a provider can only accept (or be assigned) a
-- coverage shift once BOTH a chiropractic license and malpractice insurance
-- have been verified by the admin and are unexpired on the shift date. That
-- rule is enforced in php_backend/providers.php (provider_shift_eligibility()
-- / assign_provider_to_shift()), which every accept/assign path goes through;
-- providers.shift_eligible below is only a cached copy for reporting.
--
-- Safe to run multiple times. Only adds columns/tables.

SET @dbname = DATABASE();

-- ---------- users: clinic accounts vs provider accounts ----------
SET @stmt = (SELECT IF(
  (SELECT COUNT(*) FROM information_schema.COLUMNS WHERE TABLE_SCHEMA = @dbname AND TABLE_NAME = 'users' AND COLUMN_NAME = 'account_type') = 0,
  'ALTER TABLE users ADD COLUMN account_type VARCHAR(20) NOT NULL DEFAULT ''clinic''',
  'SELECT 1'));
PREPARE stmt FROM @stmt; EXECUTE stmt; DEALLOCATE PREPARE stmt;

-- ---------- chiropractic schools / recruitment campaigns (/join/<slug>) ----------
CREATE TABLE IF NOT EXISTS provider_schools (
  id INT AUTO_INCREMENT PRIMARY KEY,
  slug VARCHAR(60) NOT NULL,
  name VARCHAR(200) NOT NULL,
  city VARCHAR(100) NULL,
  state CHAR(2) NULL,
  kind VARCHAR(20) NOT NULL DEFAULT 'school', -- school | event | campaign
  headline VARCHAR(200) NULL,                 -- optional landing-page headline override
  campaign_cost DECIMAL(10,2) NOT NULL DEFAULT 0, -- spend to date, for cost per provider
  active TINYINT(1) NOT NULL DEFAULT 1,
  visits INT NOT NULL DEFAULT 0,
  created_at DATETIME NOT NULL,
  UNIQUE KEY provider_schools_slug (slug)
);

INSERT IGNORE INTO provider_schools (slug, name, city, state, created_at) VALUES
  ('palmer', 'Palmer College of Chiropractic — Florida', 'Port Orange', 'FL', NOW()),
  ('keiser', 'Keiser University College of Chiropractic Medicine', 'West Palm Beach', 'FL', NOW()),
  ('life', 'Life University College of Chiropractic', 'Marietta', 'GA', NOW()),
  ('sherman', 'Sherman College of Chiropractic', 'Spartanburg', 'SC', NOW()),
  ('logan', 'Logan University College of Chiropractic', 'Chesterfield', 'MO', NOW()),
  ('parker', 'Parker University', 'Dallas', 'TX', NOW()),
  ('national', 'National University of Health Sciences', 'Lombard', 'IL', NOW()),
  ('nwhsu', 'Northwestern Health Sciences University', 'Bloomington', 'MN', NOW()),
  ('cleveland', 'Cleveland University–Kansas City', 'Overland Park', 'KS', NOW()),
  ('texas', 'Texas Chiropractic College', 'Pasadena', 'TX', NOW()),
  ('uws', 'University of Western States', 'Portland', 'OR', NOW()),
  ('lifewest', 'Life Chiropractic College West', 'Hayward', 'CA', NOW()),
  ('scu', 'Southern California University of Health Sciences', 'Whittier', 'CA', NOW()),
  ('nycc', 'Northeast College of Health Sciences', 'Seneca Falls', 'NY', NOW()),
  ('bridgeport', 'University of Bridgeport School of Chiropractic', 'Bridgeport', 'CT', NOW()),
  ('palmer-davenport', 'Palmer College of Chiropractic — Davenport', 'Davenport', 'IA', NOW()),
  ('palmer-west', 'Palmer College of Chiropractic — West', 'San Jose', 'CA', NOW());

-- ---------- provider profiles (one per provider user) ----------
CREATE TABLE IF NOT EXISTS providers (
  user_id INT PRIMARY KEY,
  school_id INT NULL,
  school_name VARCHAR(200) NULL,
  graduation_date DATE NULL,
  licensure_applied VARCHAR(20) NOT NULL DEFAULT 'no', -- no | yes | licensed
  expected_licensure VARCHAR(30) NULL,                 -- licensed | 0-1 | 1-3 | 3-6 | 6-12 | 12+ | unsure (months)
  intended_states VARCHAR(200) NOT NULL DEFAULT 'FL',  -- comma-separated state codes
  preferred_area VARCHAR(200) NULL,
  zip_code VARCHAR(10) NULL,
  city VARCHAR(100) NULL,
  county VARCHAR(100) NULL,
  state CHAR(2) NULL,
  metro VARCHAR(100) NULL,
  lat DECIMAL(9,6) NULL,
  lng DECIMAL(9,6) NULL,
  travel_radius INT NOT NULL DEFAULT 50,               -- miles
  sms_consent TINYINT(1) NOT NULL DEFAULT 0,
  sms_consent_at DATETIME NULL,
  techniques VARCHAR(500) NULL,
  bio TEXT NULL,
  -- acquisition / attribution
  source VARCHAR(40) NOT NULL DEFAULT 'direct',
  source_detail VARCHAR(255) NULL,
  utm_source VARCHAR(150) NULL,
  utm_medium VARCHAR(150) NULL,
  utm_campaign VARCHAR(150) NULL,
  utm_term VARCHAR(150) NULL,
  utm_content VARCHAR(150) NULL,
  landing_path VARCHAR(255) NULL,
  referrer VARCHAR(500) NULL,
  referred_by VARCHAR(255) NULL,
  -- lifecycle (cached; recomputed from credentials by provider_refresh_status())
  lifecycle_status VARCHAR(40) NOT NULL DEFAULT 'registered',
  shift_eligible TINYINT(1) NOT NULL DEFAULT 0,
  status_changed_at DATETIME NULL,
  account_status VARCHAR(20) NOT NULL DEFAULT 'active', -- active | suspended
  suspended_reason VARCHAR(255) NULL,
  first_ready_at DATETIME NULL,
  ready_notified_at DATETIME NULL,
  first_shift_at DATETIME NULL,
  -- automated credential follow-up
  followup_step INT NOT NULL DEFAULT 0,
  last_followup_at DATETIME NULL,
  last_followup_kind VARCHAR(40) NULL,
  followups_opt_out TINYINT(1) NOT NULL DEFAULT 0,
  unsubscribe_token CHAR(48) NOT NULL,
  created_at DATETIME NOT NULL,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  FOREIGN KEY (school_id) REFERENCES provider_schools(id) ON DELETE SET NULL,
  KEY (lifecycle_status), KEY (source), KEY (state), KEY (zip_code), KEY (graduation_date)
);

-- ---------- credentials: license + malpractice, independently tracked ----------
-- One row per submission. status: uploaded (document saved, details
-- incomplete) | pending (awaiting admin verification) | verified | rejected
-- (needs correction) | expired | superseded (replaced by a newer submission).
-- A verified row keeps counting until its expiration date or until a newer
-- submission of the same type is verified, so a renewal under review never
-- interrupts coverage.
CREATE TABLE IF NOT EXISTS provider_credentials (
  id INT AUTO_INCREMENT PRIMARY KEY,
  provider_id INT NOT NULL,
  type VARCHAR(20) NOT NULL, -- license | malpractice
  status VARCHAR(20) NOT NULL DEFAULT 'pending',
  license_number VARCHAR(60) NULL,
  license_state CHAR(2) NULL,
  issue_date DATE NULL,
  carrier VARCHAR(150) NULL,
  policy_number VARCHAR(100) NULL,
  coverage_start DATE NULL,
  per_claim_limit DECIMAL(12,2) NULL,
  aggregate_limit DECIMAL(12,2) NULL,
  expiration_date DATE NULL,
  file_path VARCHAR(255) NULL, -- relative to php_backend/uploads/ (never web-reachable)
  file_name VARCHAR(255) NULL,
  review_notes VARCHAR(500) NULL,
  verified_by VARCHAR(255) NULL,
  verified_at DATETIME NULL,
  reviewed_at DATETIME NULL,
  renewal_reminded_days INT NULL, -- smallest "days before expiry" reminder already sent
  expired_notified_at DATETIME NULL,
  submitted_at DATETIME NOT NULL,
  FOREIGN KEY (provider_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY (provider_id, type), KEY (status), KEY (expiration_date)
);

-- ---------- coverage shifts offered to the provider network ----------
CREATE TABLE IF NOT EXISTS provider_shifts (
  id VARCHAR(50) PRIMARY KEY,
  booking_id VARCHAR(50) NULL,
  shift_date DATE NOT NULL,
  day_type VARCHAR(10) NOT NULL DEFAULT 'full', -- full | half
  start_time VARCHAR(5) NULL,
  end_time VARCHAR(5) NULL,
  clinic_name VARCHAR(255) NULL,
  address VARCHAR(255) NULL,
  city VARCHAR(100) NULL,
  state CHAR(2) NOT NULL DEFAULT 'FL',
  zip_code VARCHAR(10) NULL,
  lat DECIMAL(9,6) NULL,
  lng DECIMAL(9,6) NULL,
  pay_amount DECIMAL(10,2) NOT NULL,
  notes TEXT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'open', -- open | assigned | completed | cancelled
  provider_id INT NULL,
  assigned_at DATETIME NULL,
  assigned_by VARCHAR(255) NULL, -- 'self' or the admin's email
  completed_at DATETIME NULL,
  needs_review TINYINT(1) NOT NULL DEFAULT 0,
  review_reason VARCHAR(255) NULL,
  flagged_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (provider_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
  KEY (shift_date), KEY (status), KEY (provider_id), KEY (needs_review)
);

-- ---------- provider leads (started the join form, may not have finished) ----------
CREATE TABLE IF NOT EXISTS provider_leads (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) NOT NULL,
  name VARCHAR(255) NULL,
  phone VARCHAR(30) NULL,
  school_id INT NULL,
  graduation_date DATE NULL,
  source VARCHAR(40) NOT NULL DEFAULT 'direct',
  source_detail VARCHAR(255) NULL,
  utm_source VARCHAR(150) NULL,
  utm_medium VARCHAR(150) NULL,
  utm_campaign VARCHAR(150) NULL,
  landing_path VARCHAR(255) NULL,
  user_id INT NULL,
  converted_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  UNIQUE KEY provider_leads_email (email),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (school_id) REFERENCES provider_schools(id) ON DELETE SET NULL
);

-- ---------- log of every automated/transactional provider message ----------
CREATE TABLE IF NOT EXISTS provider_messages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  provider_id INT NOT NULL,
  kind VARCHAR(40) NOT NULL,
  subject VARCHAR(255) NULL,
  channel VARCHAR(10) NOT NULL DEFAULT 'email',
  ok TINYINT(1) NOT NULL DEFAULT 1,
  sent_at DATETIME NOT NULL,
  FOREIGN KEY (provider_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY (provider_id), KEY (kind)
);

-- ---------- ZIP geography cache (city / county / state / coordinates) ----------
CREATE TABLE IF NOT EXISTS zip_geo_cache (
  zip VARCHAR(5) PRIMARY KEY,
  lat DECIMAL(9,6) NULL,
  lng DECIMAL(9,6) NULL,
  city VARCHAR(100) NULL,
  county VARCHAR(100) NULL,
  state CHAR(2) NULL,
  fetched_at DATETIME NOT NULL
);
