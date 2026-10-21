-- PI Case Portal — database schema (MySQL 8 / MariaDB 10.6+)
-- Import once into an EMPTY database dedicated to this portal. Do not put
-- these tables in the marketing sites' database: PHI belongs on its own
-- HIPAA-eligible host, with its own credentials and backups.
--
-- Columns ending in _enc hold libsodium-encrypted values (see app/crypto.php),
-- never plaintext. Nothing is ever hard-deleted from the clinical tables;
-- rows are archived (archived_at) so the record and its audit trail survive
-- for the full retention period.

SET NAMES utf8mb4;

CREATE TABLE users (
  id INT AUTO_INCREMENT PRIMARY KEY,
  email VARCHAR(190) NOT NULL UNIQUE,
  name VARCHAR(120) NOT NULL,
  role ENUM('admin','provider','staff','billing') NOT NULL DEFAULT 'staff',
  password_hash VARCHAR(255) NOT NULL,
  must_change_password TINYINT(1) NOT NULL DEFAULT 1,
  totp_secret_enc TEXT NULL,
  totp_enabled TINYINT(1) NOT NULL DEFAULT 0,
  totp_last_step BIGINT NULL,
  failed_logins INT NOT NULL DEFAULT 0,
  locked_until DATETIME NULL,
  last_login_at DATETIME NULL,
  active TINYINT(1) NOT NULL DEFAULT 1,
  created_at DATETIME NOT NULL
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
  INDEX idx_contacts_type (type)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

-- Names stay plaintext so staff can search by them (the database volume
-- itself must be encrypted at rest by the host). Everything else that
-- identifies or locates the patient is encrypted in the application.
CREATE TABLE patients (
  id INT AUTO_INCREMENT PRIMARY KEY,
  first_name VARCHAR(80) NOT NULL,
  last_name VARCHAR(80) NOT NULL DEFAULT '',
  dob_enc TEXT NULL,
  phone_enc TEXT NULL,
  email_enc TEXT NULL,
  address_enc TEXT NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  INDEX idx_patients_name (last_name, first_name)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE cases (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_number VARCHAR(20) NOT NULL UNIQUE,
  patient_id INT NOT NULL,
  stage ENUM('intake','treating','tx_complete','demand','litigation','mediation','negotiating','settled','closed','dropped') NOT NULL DEFAULT 'intake',
  injury_type ENUM('auto','slip_fall','work','other') NOT NULL DEFAULT 'auto',
  date_of_injury DATE NULL,
  first_visit DATE NULL,
  discharge_date DATE NULL,
  referral_source ENUM('attorney','self','provider','other') NULL,
  referred_by_contact_id INT NULL,
  referred_by_text VARCHAR(160) NULL,
  attorney_contact_id INT NULL,
  insurer_contact_id INT NULL,
  adjuster VARCHAR(160) NULL,
  claim_number_enc TEXT NULL,
  policy_number_enc TEXT NULL,
  benefits ENUM('pip','benex','lop','medpay','denied','health','other') NULL,
  pip_limit DECIMAL(10,2) NOT NULL DEFAULT 10000.00,
  emc_status ENUM('pending','yes','no') NOT NULL DEFAULT 'pending',
  actively_treating TINYINT(1) NOT NULL DEFAULT 1,
  provider_user_id INT NULL,
  atty_offer DECIMAL(10,2) NULL,
  final_settlement DECIMAL(10,2) NULL,
  date_authorized DATE NULL,
  check_received_on DATE NULL,
  notes_enc TEXT NULL,
  archived_at DATETIME NULL,
  created_at DATETIME NOT NULL,
  updated_at DATETIME NOT NULL,
  FOREIGN KEY (patient_id) REFERENCES patients(id),
  FOREIGN KEY (attorney_contact_id) REFERENCES contacts(id),
  FOREIGN KEY (insurer_contact_id) REFERENCES contacts(id),
  FOREIGN KEY (referred_by_contact_id) REFERENCES contacts(id),
  FOREIGN KEY (provider_user_id) REFERENCES users(id),
  INDEX idx_cases_stage (stage),
  INDEX idx_cases_attorney (attorney_contact_id)
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
  type ENUM('mri','xray','ct','emc','ortho','neuro','pain_mgmt','surgical','pt','other') NOT NULL,
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

CREATE TABLE visits (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_id INT NOT NULL,
  visit_date DATE NOT NULL,
  visit_type ENUM('initial','treatment','re_exam','discharge','no_show') NOT NULL DEFAULT 'treatment',
  provider_user_id INT NULL,
  cpt_codes VARCHAR(255) NULL,
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

-- Every dollar on a case. Balances are always derived from this table,
-- split into two buckets: what insurance (PIP/MedPay) owes, and what the
-- patient / attorney (LOP, post-PIP balance) owes.
CREATE TABLE ledger (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_id INT NOT NULL,
  entry_date DATE NOT NULL,
  kind ENUM('charge','payment','adjustment','reduction','write_off') NOT NULL,
  bucket ENUM('insurance','patient') NOT NULL,
  amount DECIMAL(10,2) NOT NULL,
  reference VARCHAR(120) NULL,
  memo VARCHAR(255) NULL,
  archived_at DATETIME NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id),
  INDEX idx_ledger_case (case_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;

CREATE TABLE tasks (
  id INT AUTO_INCREMENT PRIMARY KEY,
  case_id INT NULL,
  title VARCHAR(200) NOT NULL,
  due_on DATE NULL,
  assigned_user_id INT NULL,
  done_at DATETIME NULL,
  created_by INT NULL,
  created_at DATETIME NOT NULL,
  FOREIGN KEY (case_id) REFERENCES cases(id),
  INDEX idx_tasks_open (done_at, due_on)
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
  user_id INT NULL,
  user_email VARCHAR(190) NULL,
  action VARCHAR(40) NOT NULL,
  entity VARCHAR(40) NULL,
  entity_id VARCHAR(40) NULL,
  case_id INT NULL,
  ip_address VARCHAR(45) NULL,
  user_agent VARCHAR(255) NULL,
  detail VARCHAR(500) NULL,
  INDEX idx_audit_time (occurred_at),
  INDEX idx_audit_case (case_id),
  INDEX idx_audit_user (user_id)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4;
