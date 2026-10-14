-- Editable standing bookings: a change to an active pattern (days, hours, an earlier end) waits for the provider.
ALTER TABLE "StandingBooking" ADD COLUMN IF NOT EXISTS "pendingChange" JSONB;
ALTER TABLE "StandingBooking" ADD COLUMN IF NOT EXISTS "pendingChangeAt" TIMESTAMPTZ(3);
