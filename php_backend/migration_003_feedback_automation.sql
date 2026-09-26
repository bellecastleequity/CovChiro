-- Adds tracking for the one automatic feedback-request follow-up reminder
-- (sent once, ~3 days after coverage is marked complete, if no feedback has
-- been submitted yet). Safe to run on the existing live database.

ALTER TABLE bookings
  ADD COLUMN feedback_reminder_sent_at DATETIME NULL;
