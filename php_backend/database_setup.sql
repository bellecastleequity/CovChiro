-- Coverage Chiropractic Database Schema
-- Run this in cPanel > MySQL Databases > phpMyAdmin (Import tab)
--
-- Phase A: real accounts, office-coverage bookings, Stripe payments (deposit +
-- balance), blackout-date management. Tables for standing-day agreements,
-- flex-rate dates, promo codes, and video-interview requests are included so
-- the schema is ready for Phase B, but the Phase A API does not write to them.

-- Users / Clinics
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(255) UNIQUE NOT NULL,
  password_hash VARCHAR(255) NOT NULL,
  name VARCHAR(255) NOT NULL,
  clinic_name VARCHAR(255),
  phone VARCHAR(20),
  region VARCHAR(50),
  zip_code VARCHAR(10),
  failed_logins INT NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  updated_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP
);

-- Bookings (office coverage)
CREATE TABLE bookings (
  id VARCHAR(50) PRIMARY KEY,
  user_id INT NOT NULL,
  status VARCHAR(20) NOT NULL DEFAULT 'upcoming', -- upcoming | cancelled
  dates JSON NOT NULL,
  day_types JSON NOT NULL,
  day_times JSON,
  coverage_type VARCHAR(50) NOT NULL DEFAULT 'office', -- service type (svc) — always 'office' today
  coverage JSON,       -- structured coverage details: dress, techniques[], notes, pocName, pocTitle, pocPhone
  signature JSON,       -- {name, signedAt, agreementType}
  title VARCHAR(255) NOT NULL,
  meta TEXT,
  region VARCHAR(50),
  zip_code VARCHAR(10),
  miles INT,
  usvi BOOLEAN NOT NULL DEFAULT FALSE,
  total DECIMAL(10,2) NOT NULL,
  paid DECIMAL(10,2) NOT NULL DEFAULT 0,
  balance_status VARCHAR(50) NOT NULL DEFAULT 'not_due', -- not_due | due | paid
  pay_type VARCHAR(50) NOT NULL DEFAULT 'deposit',
  promo_code VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  start_date DATE,
  completed_at DATETIME NULL,
  cancelled_at DATETIME NULL,
  review_rating INT,
  review_text TEXT,
  review_submitted_at DATETIME NULL,
  feedback JSON,
  stripe_payment_intent VARCHAR(255),
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY (region), KEY (start_date), KEY (created_at), KEY (status)
);

-- Payments (one row per Stripe transaction: deposit, balance, or refund)
CREATE TABLE payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id VARCHAR(50) NOT NULL,
  user_id INT NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  purpose VARCHAR(20) NOT NULL, -- deposit | balance | refund
  payment_method VARCHAR(50) DEFAULT 'stripe',
  stripe_payment_intent VARCHAR(255),
  stripe_charge_id VARCHAR(255),
  status VARCHAR(50) NOT NULL, -- succeeded | failed | refunded
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY (booking_id), KEY (status), KEY (created_at)
);

-- Blackout dates (admin-managed availability blocks)
CREATE TABLE blackout_dates (
  id VARCHAR(50) PRIMARY KEY,
  date_start DATE NOT NULL,
  date_end DATE NOT NULL,
  scope VARCHAR(10) NOT NULL DEFAULT 'all', -- all | am | pm
  note VARCHAR(255),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY (date_start), KEY (date_end)
);

-- Payment reminders log (cron writes here; caps reminders per booking)
CREATE TABLE payment_reminders (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id VARCHAR(50) NOT NULL,
  reminder_number INT NOT NULL,
  sent_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  KEY (booking_id), KEY (sent_at)
);

-- ============================================================
-- Phase B tables (schema reserved, not yet written to by the API)
-- ============================================================

CREATE TABLE standing_requests (
  id VARCHAR(50) PRIMARY KEY,
  user_id INT NOT NULL,
  clinic_name VARCHAR(255),
  contact_email VARCHAR(255),
  region VARCHAR(50),
  zip_code VARCHAR(10),
  patterns JSON NOT NULL,
  notes TEXT,
  status VARCHAR(50) DEFAULT 'pending',
  payment_plan VARCHAR(50),
  combined_count DECIMAL(5,1),
  tier_rate DECIMAL(4,2),
  custom_rate DECIMAL(4,2),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY (status), KEY (region), KEY (created_at)
);

CREATE TABLE standing_agreements (
  id VARCHAR(50) PRIMARY KEY,
  user_id INT NOT NULL,
  clinic_name VARCHAR(255),
  contact_email VARCHAR(255),
  region VARCHAR(50),
  zip_code VARCHAR(10),
  patterns JSON NOT NULL,
  tier_rate DECIMAL(4,2),
  effective_rate DECIMAL(4,2),
  payment_plan VARCHAR(50),
  scheduled_dates JSON,
  status VARCHAR(50) DEFAULT 'active',
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  next_due_date DATE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY (status), KEY (region), KEY (next_due_date)
);

CREATE TABLE flex_rate_dates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  date DATE NOT NULL,
  region VARCHAR(50),
  coverage_type VARCHAR(50),
  discount_rate DECIMAL(4,2),
  note TEXT,
  status VARCHAR(50) DEFAULT 'open',
  booked_booking_id VARCHAR(50),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY (date), KEY (status)
);

CREATE TABLE promo_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  type VARCHAR(20) NOT NULL, -- percent | flat
  value DECIMAL(10,2) NOT NULL,
  active BOOLEAN DEFAULT TRUE,
  expires_at DATE NULL,
  max_uses INT NULL,
  used_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

CREATE TABLE video_requests (
  id VARCHAR(50) PRIMARY KEY,
  booking_id VARCHAR(50) NULL,
  name VARCHAR(255),
  email VARCHAR(255),
  requested_date DATE,
  status VARCHAR(50) DEFAULT 'pending',
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  KEY (status)
);

CREATE TABLE clinic_feedback (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id VARCHAR(50) NOT NULL,
  user_id INT NOT NULL,
  punctuality INT,
  professionalism INT,
  patient_care INT,
  would_rebook VARCHAR(50),
  notes TEXT,
  submitted_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE,
  KEY (booking_id)
);

CREATE TABLE analytics_cache (
  id INT AUTO_INCREMENT PRIMARY KEY,
  metric_name VARCHAR(100),
  metric_value JSON,
  cached_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  KEY (metric_name)
);

CREATE INDEX idx_user_bookings ON bookings(user_id, start_date);
CREATE INDEX idx_payments_user ON payments(user_id, created_at);
CREATE INDEX idx_region_dates ON bookings(region, start_date);
