-- InjuryCase — database schema (MySQL 8 / MariaDB 10.6+)
--
-- Multi-tenant: every subscribing practice is a row in `practices`, and
-- every table holding a practice's data carries practice_id (directly, or
-- through the case it belongs to). The API scopes every query to the
-- signed-in user's practice.
-- Import once into an EMPTY database dedicated to this portal. Do not put
-- these tables in the marketing sites' database: PHI belongs on its own
-- HIPAA-eligible host, with its own credentials and backups.
--
-- Columns ending in _enc hold libsodium-encrypted values (see app/crypto.php),
-- never plaintext. Nothing is ever hard-deleted from the clinical tables;
-- rows are archived (archived_at) so the record and its audit trail survive
-- for the full retention period.

SET NAMES utf8mb4;

-- One row per subscribing practice (the tenant). Letterhead details live
-- here so letters go out under each practice's own name.
CREATE TABLE practices (
  id INT AUTO_INCREMENT PRIMARY KEY,
  name VARCHAR(160) NOT NULL,
  address VARCHAR(255) NULL,
  phone VARCHAR(40) NULL,
  fax VARCHAR(40) NULL,
  state CHAR(2) NOT NULL DEFAULT 'FL',
  -- Which financial categories the staff role may see (comma list of
  -- balances, ledger, settlement). Empty = none.
  staff_finance VARCHAR(60) NOT NULL DEFAULT '',
  -- The practice's EHR/EMR (label only; ledger uploads work with any).
  ehr_name VARCHAR(80) NULL,
  -- Daily email digest: which criteria are on and their thresholds (JSON;
  -- defaults in app/huddle.php).
  notify_rules TEXT NULL,
  plan VARCHAR(20) NOT NULL DEFAULT 'starter',
  subscription_status ENUM('trialing','active','past_due','canceled','comped') NOT NULL DEFAULT 'trialing',
  trial_ends_at DATETIME NULL,
  current_period_end DATETIME NULL,
  stripe_customer_id VARCHAR(64) NULL,
  stripe_subscription_id VARCHAR(64) NULL,
  billing_interval ENUM('monthly','annual') NOT NULL DEFAULT 'monthly',
  -- Promo code entered at signup (app/promo.php).
  promo_code_id INT NULL,
  promo_applied_at DATETIME NULL,
  -- Who accepted the Business Associate Agreement and Terms, which version, when.
  baa_version VARCHAR(20) NULL,
  baa_accepted_at DATETIME NULL,
  baa_accepted_by INT NULL,
  -- Public "Certified" website badge (app/badge.php): random token for the
  -- embed/verify links, switched on by an admin.
  badge_token CHAR(24) NULL,
  badge_enabled TINYINT(1) NOT NULL DEFAULT 0,
  badge_enabled_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  INDEX idx_practices_stripe (stripe_customer_id),
  UNIQUE INDEX idx_practices_badge (badge_token)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Promo codes entered at registration (app/promo.php); operators manage them.
CREATE TABLE promo_codes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  code VARCHAR(40) NOT NULL,
  description VARCHAR(200) NULL,
  kind ENUM('trial_days','percent','amount','comp') NOT NULL,
  trial_days INT NULL,
  percent_off INT NULL,
  amount_off DECIMAL(10,2) NULL,
  duration ENUM('once','repeating','forever') NOT NULL DEFAULT 'once',
  duration_months INT NULL,
  plans VARCHAR(60) NULL,
  max_redemptions INT NULL,
  redeemed INT NOT NULL DEFAULT 0,
  expires_on DATE NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  stripe_coupon_id VARCHAR(64) NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL,
  UNIQUE INDEX idx_promo_code (code)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Feature suggestions from practice users (no patient information).
CREATE TABLE feedback (
  id INT AUTO_INCREMENT PRIMARY KEY,
  practice_id INT NOT NULL,
  user_id INT NULL,
  kind ENUM('feature','change','problem') NOT NULL DEFAULT 'feature',
  area VARCHAR(60) NULL,
  title VARCHAR(160) NOT NULL,
  body TEXT NULL,
  page VARCHAR(80) NULL,
  status ENUM('new','reviewing','planned','done','declined') NOT NULL DEFAULT 'new',
  response TEXT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (practice_id) REFERENCES practices(id),
  INDEX idx_feedback_status (status)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Daily digests sent (one per person per day).
CREATE TABLE digest_log (
  user_id INT NOT NULL,
  sent_on DATE NOT NULL,
  items INT NOT NULL,
  PRIMARY KEY (user_id, sent_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Trial reminder emails already sent, so each goes out once.
CREATE TABLE trial_notices (
  practice_id INT NOT NULL,
  kind VARCHAR(20) NOT NULL,
  sent_at DATETIME NOT NULL,
  PRIMARY KEY (practice_id, kind),
  FOREIGN KEY (practice_id) REFERENCES practices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- A practice's offices (Platinum plan for more than one). Letters and exports
-- use the case's location for the letterhead.
CREATE TABLE locations (
  id INT AUTO_INCREMENT PRIMARY KEY,
  practice_id INT NOT NULL,
  name VARCHAR(120) NOT NULL,
  address VARCHAR(255) NULL,
  state CHAR(2) NULL,
  phone VARCHAR(40) NULL,
  fax VARCHAR(40) NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (practice_id) REFERENCES practices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- practice_id NULL = a platform operator (you, running the service):
-- operators manage subscriptions but can never open patient records.
CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  practice_id INT NULL,
  email VARCHAR(190) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  role ENUM('admin','provider','staff','billing') NOT NULL DEFAULT 'staff',
  -- Admin-granted: this staff member may see all financials.
  finance_access TINYINT(1) NOT NULL DEFAULT 0,
  -- Daily email digest: on/off, and which of the practice's criteria this
  -- person wants (comma list; NULL = all).
  -- Home location (default filter) and, optionally, access limited to the
  -- cases of that location.
  location_id INT NULL,
  location_restricted TINYINT(1) NOT NULL DEFAULT 0,
  notify_digest TINYINT(1) NOT NULL DEFAULT 0,
  notify_criteria VARCHAR(255) NULL,
  password_hash VARCHAR(255) NOT NULL,
  must_change_password TINYINT(1) NOT NULL DEFAULT 1,
  totp_secret_enc TEXT NULL,
  totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
  totp_last_step BIGINT NULL,
  failed_logins INT NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  last_login_at DATETIME NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (practice_id) REFERENCES practices(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE login_throttle (
  ip_address VARCHAR(45) NOT NULL PRIMARY KEY,
  attempt_count INT NOT NULL DEFAULT 0,
  window_start DATETIME NOT NULL,
  blocked_until DATETIME NULL
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Attorneys / law firms, insurers & adjusters, imaging centers, pain
-- management, ortho/neuro, hospitals. Business contacts — not PHI.
CREATE TABLE contacts (
  id INT AUTO_INCREMENT PRIMARY KEY,
  practice_id INT NOT NULL,
  type ENUM('attorney','insurer','imaging','pain_mgmt','ortho','neuro','md','hospital','pt','other') NOT NULL,
  organization VARCHAR(160) NULL,
  name VARCHAR(160) NULL,
  email VARCHAR(190) NULL,
  phone VARCHAR(40) NULL,
  fax VARCHAR(40) NULL,
  address VARCHAR(255) NULL,
  notes TEXT NULL,
  archived_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (practice_id) REFERENCES practices(id),
  INDEX idx_contacts_type (practice_id, type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Names stay plaintext so staff can search by them (the database volume
-- itself must be encrypted at rest by the host). Everything else that
-- identifies or locates the patient is encrypted in the application.
CREATE TABLE patients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  practice_id INT NOT NULL,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL DEFAULT '',
  dob_enc TEXT NULL,
  phone_enc TEXT NULL,
  email_enc TEXT NULL,
  address_enc TEXT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (practice_id) REFERENCES practices(id),
  INDEX idx_patients_name (practice_id, last_name, first_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE cases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  practice_id INT NOT NULL,
  case_number VARCHAR(20) NOT NULL,
  patient_id INT NOT NULL,
  location_id INT NULL,
  -- State whose law applies (app/jurisdictions.php); set from the location
  -- or practice when the case is created.
  jurisdiction CHAR(2) NULL,
  stage ENUM('intake','treating','tx_complete','demand','litigation','mediation','negotiating','settled','closed','dropped') NOT NULL DEFAULT 'intake',
  injury_type ENUM('auto','slip_fall','workers_comp','other_pi') NOT NULL DEFAULT 'auto',
  date_of_injury DATE NULL,
  first_visit DATE NULL,
  discharge_date DATE NULL,
  referral_source ENUM('attorney','self','provider','other') NULL,
  referred_by_contact_id INT NULL,
  referred_by_text VARCHAR(160) NULL,
  attorney_contact_id INT NULL,
  -- Summary of where the case's bills go, kept in sync from `coverages`
  -- (for list filters and reports): pip / benex (PIP exhausted) / denied /
  -- medpay / health / wc / lop (no insurance: patient balance only).
  benefits ENUM('pip','benex','denied','medpay','health','wc','lop') NULL,
  emc_status ENUM('pending','yes','no') NOT NULL DEFAULT 'pending',
  -- Who made the EMC determination (Florida: MD, DO, DMD, PA or APRN only).
  emc_by VARCHAR(10) NULL,
  emc_on DATE NULL,
  -- Choice states (NJ, PA, KY): the lawsuit option on the patient's policy.
  tort_option ENUM('unknown','limited','full') NOT NULL DEFAULT 'unknown',
  actively_treating TINYINT(1) NOT NULL DEFAULT 1,
  provider_user_id INT NULL,
  -- Letter of protection: the patient balance is held until settlement and
  -- then forwarded to the attorney. Law firms don't always countersign.
  lop_signed_on DATE NULL,
  lop_acknowledged_on DATE NULL,
  -- Florida §768.0427 letter-of-protection disclosures.
  lop_factored ENUM('unknown','no','yes') NOT NULL DEFAULT 'unknown',
  lop_factor_company VARCHAR(160) NULL,
  lop_factor_price DECIMAL(10,2) NULL,
  lop_health_coverage ENUM('unknown','no','yes') NOT NULL DEFAULT 'unknown',
  balance_forwarded_on DATE NULL,
  balance_forwarded_amount DECIMAL(10,2) NULL,
  atty_offer DECIMAL(10,2) NULL,
  final_settlement DECIMAL(10,2) NULL,
  date_authorized DATE NULL,
  check_received_on DATE NULL,
  notes_enc TEXT NULL,
  -- Head injury (hit head, loss of consciousness, concussion symptoms):
  -- decides whether the care guide suggests a neurology referral.
  head_injury ENUM('unknown','yes','no') NOT NULL DEFAULT 'unknown',
  -- Maximum medical improvement. At MMI the patient is discharged, or
  -- moves to maintenance care every N days (set by the doctor) until a
  -- final discharge.
  -- Treatment plan frequency (visits per week) and since when; attendance
  -- is compared against it.
  plan_visits_per_week DECIMAL(3,1) NULL,
  plan_set_on DATE NULL,
  -- Patient outreach: once the attorney/paralegal has been told the office
  -- can't reach the patient, calls pause from this date until the patient
  -- attends a visit again (or staff resume them).
  outreach_hold_on DATE NULL,
  paralegal VARCHAR(160) NULL,
  mmi_date DATE NULL,
  maintenance_every_days SMALLINT NULL,
  -- Liability coverage that will pay the claim (often learned on the
  -- attorney call): the at-fault party's bodily-injury limit, the patient's
  -- uninsured/underinsured motorist limit, and an estimate of other
  -- providers' bills (ER, imaging, specialists). Used to keep the medical
  -- bills proportionate to what the case can pay.
  liability_carrier VARCHAR(160) NULL,
  bi_limit DECIMAL(10,2) NULL,
  um_limit DECIMAL(10,2) NULL,
  other_medical_estimate DECIMAL(10,2) NULL,
  limits_source VARCHAR(160) NULL,
  limits_noted_on DATE NULL,
  -- Set once the case's financials come from uploaded EHR ledgers.
  ehr_system VARCHAR(80) NULL,
  ehr_synced_at DATETIME NULL,
  archived_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (practice_id) REFERENCES practices(id),
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (attorney_contact_id) REFERENCES contacts(id),
  FOREIGN KEY (referred_by_contact_id) REFERENCES contacts(id),
  FOREIGN KEY (provider_user_id) REFERENCES users(id),
  UNIQUE KEY uq_case_number (practice_id, case_number),
  INDEX idx_cases_stage (practice_id, stage),
  INDEX idx_cases_attorney (attorney_contact_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Insurance billed on a case, in billing order (priority 1 first): PIP,
-- MedPay, the patient's health insurance, or workers' comp. Each has its
-- own claim and lifecycle; whatever insurance doesn't cover is moved (by a
-- person, never automatically) to the patient balance.
CREATE TABLE coverages (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_id INT NOT NULL,
  type ENUM('pip','medpay','health','workers_comp') NOT NULL,
  priority TINYINT NOT NULL DEFAULT 1,
  carrier_contact_id INT NULL,
  carrier_text VARCHAR(160) NULL,
  adjuster VARCHAR(160) NULL,
  claim_number_enc TEXT NULL,
  policy_number_enc TEXT NULL,
  status ENUM('active','denied','exhausted','closed') NOT NULL DEFAULT 'active',
  status_on DATE NULL,
  status_reason VARCHAR(255) NULL,
  benefit_limit DECIMAL(10,2) NULL,
  -- Policy issued/renewed on: decides policy-dated rule changes (e.g. KY 2026).
  policy_effective_on DATE NULL,
  -- What the carrier says is left (PIP is shared with every provider, so
  -- the adjuster's figure beats our own payments), and as of when.
  remaining_reported DECIMAL(10,2) NULL,
  remaining_reported_on DATE NULL,
  authorized_visits INT NULL,
  authorized_through DATE NULL,
  -- Florida pre-suit demand letter (§627.736(10)) sent for overdue bills.
  demand_sent_on DATE NULL,
  notes_enc TEXT NULL,
  archived_at DATETIME NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id),
  FOREIGN KEY (carrier_contact_id) REFERENCES contacts(id),
  INDEX idx_cov_case (case_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Administrative checklist items (LOR, prior records, ADL surveys, letters).
-- The list of keys and their deadlines lives in app/pi_rules.php.
CREATE TABLE case_milestones (
  case_id INT NOT NULL,
  milestone VARCHAR(40) NOT NULL,
  completed_on DATE NULL,
  not_applicable TINYINT(1) NOT NULL DEFAULT 0,
  note VARCHAR(255) NULL,
  updated_by INT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (case_id, milestone),
  FOREIGN KEY (case_id) REFERENCES cases(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Co-management: imaging, EMC determinations, ortho/neuro/pain consults
-- sent out, and referrals that came in from other providers.
CREATE TABLE referrals (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_id INT NOT NULL,
  direction ENUM('out','in') NOT NULL DEFAULT 'out',
  type ENUM('mri','xray','ct','emg','emc','ortho','neuro','pain_mgmt','surgical','pt','other') NOT NULL,
  -- What kind of specialist, for type 'other' (e.g. Dental / TMJ, ENT).
  specialty VARCHAR(80) NULL,
  contact_id INT NULL,
  facility_text VARCHAR(160) NULL,
  body_region VARCHAR(120) NULL,
  status ENUM('ordered','scheduled','completed','report_received','no_show','cancelled') NOT NULL DEFAULT 'ordered',
  ordered_on DATE NULL,
  scheduled_on DATE NULL,
  completed_on DATE NULL,
  report_received_on DATE NULL,
  entered_in_chart TINYINT(1) NOT NULL DEFAULT 0,
  findings_enc TEXT NULL,
  notes_enc TEXT NULL,
  archived_at DATETIME NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id),
  FOREIGN KEY (contact_id) REFERENCES contacts(id),
  INDEX idx_referrals_case (case_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Attempts to reach a patient who has missed care (calls, texts, ...).
-- Outcomes are worded neutrally: these records can be requested in the
-- claim.
CREATE TABLE outreach (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_id INT NOT NULL,
  attempted_on DATE NOT NULL,
  method ENUM('call','text','email','letter') NOT NULL DEFAULT 'call',
  outcome ENUM('no_answer','left_message','spoke_scheduled','spoke_will_call','unable_to_schedule','wrong_number') NOT NULL,
  notes_enc TEXT NULL,
  archived_at DATETIME NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id),
  INDEX idx_outreach_case (case_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE visits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_id INT NOT NULL,
  visit_date DATE NOT NULL,
  visit_type ENUM('initial','treatment','re_exam','maintenance','discharge','no_show') NOT NULL DEFAULT 'treatment',
  location_id INT NULL,
  provider_user_id INT NULL,
  cpt_codes VARCHAR(255) NULL,
  icd_codes VARCHAR(500) NULL,
  -- Workers' comp: DWC-25 status form sent to the carrier for this visit.
  dwc25_sent TINYINT(1) NOT NULL DEFAULT 0,
  source ENUM('manual','ehr') NOT NULL DEFAULT 'manual',
  notes_enc TEXT NULL,
  archived_at DATETIME NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id),
  INDEX idx_visits_case (case_id, visit_date)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Outcome assessment tools (Bournemouth, Oswestry, NDI, HDI, ...).
CREATE TABLE outcomes (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_id INT NOT NULL,
  measure VARCHAR(40) NOT NULL,
  score DECIMAL(6,2) NOT NULL,
  taken_on DATE NOT NULL,
  archived_at DATETIME NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id),
  INDEX idx_outcomes_case (case_id, measure, taken_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE correspondence (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_id INT NOT NULL,
  occurred_on DATE NOT NULL,
  direction ENUM('out','in') NOT NULL DEFAULT 'out',
  method ENUM('fax','email','phone','mail','portal','in_person') NOT NULL DEFAULT 'fax',
  contact_id INT NULL,
  contact_text VARCHAR(160) NULL,
  subject VARCHAR(200) NOT NULL,
  notes_enc TEXT NULL,
  follow_up_on DATE NULL,
  follow_up_done TINYINT(1) NOT NULL DEFAULT 0,
  archived_at DATETIME NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id),
  FOREIGN KEY (contact_id) REFERENCES contacts(id),
  INDEX idx_corr_case (case_id, occurred_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Every dollar on a case. Balances are always derived from this table.
-- bucket = who owes it: insurance (with coverage_id) or the patient balance.
--   charge                         adds to its bucket
--   payment/adjustment/reduction/write_off   subtract from its bucket
--   transfer                       moves `amount` from bucket/coverage_id to
--                                  to_bucket/to_coverage_id (e.g. the 20% PIP
--                                  doesn't pay, a denial, or back again when a
--                                  late payment arrives)
-- applies_to_id links a payment/transfer to the charge (date of service) it
-- belongs to, so each charge shows what is still open. Nothing is locked:
-- every row stays editable, and edits are audited.
CREATE TABLE ledger (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_id INT NOT NULL,
  entry_date DATE NOT NULL,
  kind ENUM('charge','payment','adjustment','reduction','write_off','transfer') NOT NULL,
  bucket ENUM('insurance','patient') NOT NULL,
  coverage_id INT NULL,
  to_bucket ENUM('insurance','patient') NULL,
  to_coverage_id INT NULL,
  applies_to_id INT NULL,
  visit_id INT NULL,
  amount DECIMAL(10,2) NOT NULL,
  reference VARCHAR(120) NULL,
  memo VARCHAR(255) NULL,
  -- 'ehr' rows come from an uploaded EHR ledger and are replaced by the
  -- next upload; the EHR is the source of truth for them.
  source ENUM('manual','ehr') NOT NULL DEFAULT 'manual',
  ehr_import_id INT NULL,
  archived_at DATETIME NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL,
  updated_by INT NULL,
  updated_at DATETIME NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id),
  FOREIGN KEY (coverage_id) REFERENCES coverages(id),
  FOREIGN KEY (to_coverage_id) REFERENCES coverages(id),
  INDEX idx_ledger_case (case_id),
  INDEX idx_ledger_applies (applies_to_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Each EHR ledger upload applied to a case (the history of syncs).
CREATE TABLE ehr_imports (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_id INT NOT NULL,
  ehr_system VARCHAR(80) NOT NULL,
  method ENUM('pdf','spreadsheet','totals') NOT NULL DEFAULT 'pdf',
  file_sha256 CHAR(64) NOT NULL,
  summary_enc TEXT NULL,
  document_id INT NULL,
  uploaded_by INT NULL,
  uploaded_at DATETIME NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id),
  INDEX idx_ehr_case (case_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- The care guide's referral steps a clinic has set aside for a case:
-- "not needed" (with a reason) or "remind me later" (until a date).
CREATE TABLE case_guide (
  case_id INT NOT NULL,
  step VARCHAR(20) NOT NULL,
  status ENUM('dismissed','snoozed') NOT NULL,
  until DATE NULL,
  reason VARCHAR(255) NULL,
  updated_by INT NULL,
  updated_at DATETIME NOT NULL,
  PRIMARY KEY (case_id, step),
  FOREIGN KEY (case_id) REFERENCES cases(id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- A saved spreadsheet layout for one EHR's ledger export: which column
-- holds what. Recognised by its header row on later uploads. Holds column
-- names only, never patient data.
CREATE TABLE ehr_formats (
  id INT AUTO_INCREMENT PRIMARY KEY,
  practice_id INT NOT NULL,
  name VARCHAR(80) NOT NULL,
  layout ENUM('lines','transactions') NOT NULL,
  signature CHAR(64) NOT NULL,
  mapping TEXT NOT NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (practice_id) REFERENCES practices(id),
  UNIQUE KEY uq_ehr_format (practice_id, signature)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  practice_id INT NOT NULL,
  case_id INT NULL,
  title VARCHAR(200) NOT NULL,
  notes_enc TEXT NULL,
  priority ENUM('normal','high') NOT NULL DEFAULT 'normal',
  due_on DATE NULL,
  done_at DATETIME NULL,
  done_by INT NULL,
  archived_at DATETIME NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NULL,
  FOREIGN KEY (practice_id) REFERENCES practices(id),
  FOREIGN KEY (case_id) REFERENCES cases(id),
  INDEX idx_tasks_open (practice_id, done_at, due_on)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- A task can be assigned to one or more team members (none = anyone).
CREATE TABLE task_assignees (
  task_id INT NOT NULL,
  user_id INT NOT NULL,
  PRIMARY KEY (task_id, user_id),
  FOREIGN KEY (task_id) REFERENCES tasks(id),
  FOREIGN KEY (user_id) REFERENCES users(id),
  INDEX idx_task_assignee_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Files are encrypted on disk under storage/documents/ (outside the web
-- root); this table only holds metadata.
CREATE TABLE documents (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_id INT NOT NULL,
  category ENUM('lor','intake','prior_records','imaging_report','emc_report','consult_report','narrative','letter','billing','correspondence','other') NOT NULL DEFAULT 'other',
  original_name VARCHAR(255) NOT NULL,
  mime_type VARCHAR(100) NOT NULL,
  size_bytes INT NOT NULL,
  storage_name CHAR(64) NOT NULL UNIQUE,
  sha256 CHAR(64) NOT NULL,
  archived_at DATETIME NULL,
  uploaded_by INT NULL,
  uploaded_at DATETIME NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id),
  INDEX idx_docs_case (case_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Append-only record of who touched what PHI, when, from where (HIPAA
-- §164.312(b) audit controls). The app never updates or deletes rows here;
-- give the app's DB user INSERT/SELECT only on this table in production.
CREATE TABLE audit_log (
  id BIGINT AUTO_INCREMENT PRIMARY KEY,
  occurred_at DATETIME NOT NULL,
  practice_id INT NULL,
  user_id INT NULL,
  user_email VARCHAR(190) NULL,
  action VARCHAR(40) NOT NULL,
  entity VARCHAR(40) NULL,
  entity_id VARCHAR(40) NULL,
  case_id INT NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  detail VARCHAR(500) NULL,
  -- What changed: [{"f":field,"t":type,"from":..,"to":..}]. Values are kept
  -- only for structured fields (stages, dates, amounts, people); free text
  -- and encrypted fields are named without their contents.
  changes TEXT NULL,
  INDEX idx_audit_time (practice_id, occurred_at),
  INDEX idx_audit_case (case_id),
  INDEX idx_audit_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
