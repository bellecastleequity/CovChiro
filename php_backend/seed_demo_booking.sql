-- Creates a persistent demo account + demo office-coverage booking so you can
-- see how the client dashboard and provider portal look with a real booking
-- in them, without a real client having to book. Safe to run more than once
-- (updates the same rows rather than duplicating them) — re-run it any time
-- to push the demo date back out to "10 days from now" if it's gone stale.
--
-- Demo login (client side): demo-client@coveragechiropractor.com / DemoPass123!
-- Booking reference: DEMO-0001
--
-- To remove the demo data later, run:
--   DELETE FROM payments WHERE stripe_payment_intent = 'demo_pi_0001';
--   DELETE FROM bookings WHERE id = 'DEMO-0001';
--   DELETE FROM users WHERE email = 'demo-client@coveragechiropractor.com';

INSERT INTO users (email, password_hash, name, clinic_name, phone, region, zip_code, email_verified)
VALUES (
  'demo-client@coveragechiropractor.com',
  '$2y$12$pcghh2aZihDdxnLKvk9PWOk2mKm7jbGu6TsoY51hajsn8YCuPDFfa',
  'Demo Test Clinic', 'Demo Test Clinic', '555-000-1234', 'central', '32801', 1
)
ON DUPLICATE KEY UPDATE name = VALUES(name);

SET @demo_user_id = (SELECT id FROM users WHERE email = 'demo-client@coveragechiropractor.com');
SET @demo_date = DATE_ADD(CURDATE(), INTERVAL 10 DAY);

INSERT INTO bookings
  (id, user_id, status, dates, day_types, day_times, coverage_type, coverage, signature,
   title, meta, region, zip_code, miles, total, paid, balance_status, pay_type, promo_code,
   created_at, start_date)
VALUES (
  'DEMO-0001', @demo_user_id, 'upcoming',
  JSON_ARRAY(DATE_FORMAT(@demo_date, '%Y-%m-%d')),
  JSON_ARRAY('full'),
  JSON_ARRAY(),
  'office',
  JSON_OBJECT(
    'patientVolume', 45,
    'dress', 'Business casual, tie',
    'techniques', JSON_ARRAY('Diversified', 'Gonstead'),
    'notes', 'This is a demo booking for trying out the dashboard and provider portal — safe to ignore or delete.',
    'pocName', 'Jane Office Manager',
    'pocTitle', 'Office Manager',
    'pocPhone', '555-000-1234'
  ),
  JSON_OBJECT(
    'name', 'Demo Test Clinic',
    'signedAt', DATE_FORMAT(NOW(), '%Y-%m-%dT%H:%i:%s.000Z'),
    'agreementType', 'office-coverage'
  ),
  'Office coverage — Central FL',
  '1 full day · ZIP 32801 · 0 mi one way',
  'central', '32801', 0,
  575.00, 57.50, 'not_due', 'deposit', NULL,
  NOW(), @demo_date
)
ON DUPLICATE KEY UPDATE
  dates = VALUES(dates),
  start_date = VALUES(start_date),
  status = 'upcoming',
  paid = VALUES(paid),
  balance_status = VALUES(balance_status);

INSERT INTO payments (booking_id, user_id, amount, purpose, stripe_payment_intent, stripe_charge_id, status)
SELECT 'DEMO-0001', @demo_user_id, 57.50, 'deposit', 'demo_pi_0001', 'demo_ch_0001', 'succeeded'
WHERE NOT EXISTS (SELECT 1 FROM payments WHERE stripe_payment_intent = 'demo_pi_0001');
