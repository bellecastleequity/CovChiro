-- Provider profile: personal-injury (PI) case experience. NULL = not answered.
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "personalInjuryExperience" BOOLEAN;
