-- Coverage Chiropractic Database Schema
-- Run this in cPanel > MySQL Databases > phpMyAdmin (Import tab)
--
-- Covers: accounts, office-coverage bookings, Stripe payments (deposit +
-- balance + per-date standing-day payments), blackout-date management,
-- standing-day agreements, flex-rate dates, promo codes, and
-- video-interview requests. The admin analytics dashboard is computed live
-- from these tables (see api/analytics.php) rather than the reserved
-- analytics_cache table below, which is left for a future caching pass.

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

-- Standing-day requests (a clinic's ask for a recurring weekly/biweekly/
-- monthly coverage pattern, pending admin approval). No account is required
-- to submit one — user_id is set only if the visitor happened to be signed
-- in; ownership for viewing/cancelling is otherwise matched by contact_email.
CREATE TABLE standing_requests (
  id VARCHAR(50) PRIMARY KEY,
  user_id INT NULL,
  clinic_name VARCHAR(255),
  contact_email VARCHAR(255),
  region VARCHAR(50),
  zip_code VARCHAR(10),
  patterns JSON NOT NULL, -- [{dow, freq, type, count, actualStart}, ...]
  notes TEXT,
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending | approved | declined
  payment_plan VARCHAR(50) NOT NULL DEFAULT 'standard', -- standard | prepay | installment
  combined_count DECIMAL(5,1),
  tier_rate DECIMAL(5,4),
  custom_rate DECIMAL(5,4),
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  KEY (status), KEY (region), KEY (created_at), KEY (contact_email)
);

-- Standing-day agreements (approved requests, with the generated schedule)
CREATE TABLE standing_agreements (
  id VARCHAR(50) PRIMARY KEY,
  user_id INT NULL,
  request_id VARCHAR(50) NULL,
  clinic_name VARCHAR(255),
  contact_email VARCHAR(255),
  region VARCHAR(50),
  zip_code VARCHAR(10),
  patterns JSON NOT NULL,
  tier_rate DECIMAL(5,4),
  custom_rate DECIMAL(5,4),
  effective_rate DECIMAL(5,4) NOT NULL,
  payment_plan VARCHAR(50) NOT NULL DEFAULT 'standard',
  scheduled_dates JSON NOT NULL, -- [{date, type, status, patientVolume, paidAt}, ...]
  status VARCHAR(50) NOT NULL DEFAULT 'active', -- active | cancelling | cancelled
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (request_id) REFERENCES standing_requests(id) ON DELETE SET NULL,
  KEY (status), KEY (region), KEY (contact_email)
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

-- Payments (one row per Stripe transaction: deposit, balance, refund, or a
-- single standing-day date payment). Exactly one of booking_id /
-- standing_agreement_id is set, depending on what was paid for.
CREATE TABLE payments (
  id INT AUTO_INCREMENT PRIMARY KEY,
  booking_id VARCHAR(50) NULL,
  standing_agreement_id VARCHAR(50) NULL,
  standing_date DATE NULL,
  user_id INT NULL, -- null when the paying agreement predates an account (email-matched instead)
  amount DECIMAL(10,2) NOT NULL,
  purpose VARCHAR(20) NOT NULL, -- deposit | balance | refund | standing_date
  payment_method VARCHAR(50) DEFAULT 'stripe',
  stripe_payment_intent VARCHAR(255),
  stripe_charge_id VARCHAR(255),
  status VARCHAR(50) NOT NULL, -- succeeded | failed | refunded
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE CASCADE,
  FOREIGN KEY (standing_agreement_id) REFERENCES standing_agreements(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  KEY (booking_id), KEY (standing_agreement_id), KEY (status), KEY (created_at)
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

-- Flex Rate dates (admin-published promotional rate for a specific
-- otherwise-open date; withdrawn/booked rows are kept for analytics)
CREATE TABLE flex_rate_dates (
  id INT AUTO_INCREMENT PRIMARY KEY,
  date DATE NOT NULL,
  region VARCHAR(50) NOT NULL,
  day_type VARCHAR(20) NOT NULL DEFAULT 'full', -- full | half-am | half-pm
  discount_rate DECIMAL(4,2) NOT NULL,
  note VARCHAR(255),
  status VARCHAR(50) NOT NULL DEFAULT 'open', -- open | booked | withdrawn
  booked_booking_id VARCHAR(50) NULL,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (booked_booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
  KEY (date), KEY (status)
);

-- Promo codes (admin-managed discount codes)
CREATE TABLE promo_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(50) UNIQUE NOT NULL,
  type VARCHAR(20) NOT NULL, -- percent | fixed
  value DECIMAL(10,2) NOT NULL,
  active BOOLEAN NOT NULL DEFAULT TRUE,
  expires_at DATE NULL,
  max_uses INT NULL,
  used_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP
);

-- Video-interview requests (10-minute pre- or post-booking call request)
CREATE TABLE video_requests (
  id VARCHAR(50) PRIMARY KEY,
  user_id INT NULL,
  booking_id VARCHAR(50) NULL,
  name VARCHAR(255) NOT NULL,
  email VARCHAR(255) NOT NULL,
  requested_date DATE NOT NULL,
  status VARCHAR(50) NOT NULL DEFAULT 'pending', -- pending | scheduled | done
  requested_at TIMESTAMP DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL,
  FOREIGN KEY (booking_id) REFERENCES bookings(id) ON DELETE SET NULL,
  KEY (status)
);

-- Small admin-editable settings (currently just the last-minute discount toggle)
CREATE TABLE app_settings (
  name VARCHAR(100) PRIMARY KEY,
  value_json JSON NOT NULL
);

-- Reserved for a future caching pass on the admin analytics dashboard —
-- api/analytics.php currently computes everything live from the tables above.
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
