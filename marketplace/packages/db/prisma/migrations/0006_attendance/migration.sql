-- Shift reconfirmation (ask, reminder, confirmed) and day-of check-in (prompt, on my way, alert).
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "reconfirmRequestedAt" TIMESTAMPTZ(3);
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "reconfirmRemindedAt" TIMESTAMPTZ(3);
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "reconfirmedAt" TIMESTAMPTZ(3);
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "checkinPromptedAt" TIMESTAMPTZ(3);
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "onMyWayAt" TIMESTAMPTZ(3);
ALTER TABLE "Assignment" ADD COLUMN IF NOT EXISTS "checkinAlertedAt" TIMESTAMPTZ(3);
