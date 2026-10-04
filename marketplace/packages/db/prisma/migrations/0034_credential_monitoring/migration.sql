-- Credential monitoring: state license checks, malpractice re-verification, coverage attestations. Re-runnable.
ALTER TABLE "License" ADD COLUMN IF NOT EXISTS "boardCheckedAt" TIMESTAMPTZ(3);
ALTER TABLE "License" ADD COLUMN IF NOT EXISTS "boardStatus" TEXT;
ALTER TABLE "MalpracticePolicy" ADD COLUMN IF NOT EXISTS "nextReverifyAt" TIMESTAMPTZ(3);
ALTER TABLE "Provider" ADD COLUMN IF NOT EXISTS "coverageAttestedAt" TIMESTAMPTZ(3);
-- Policies verified before this: due 90 days after verification (or 30 days before expiry, if sooner).
UPDATE "MalpracticePolicy" SET "nextReverifyAt" = LEAST(COALESCE("verifiedAt", "createdAt") + interval '90 days', "expiresAt" - interval '30 days')
WHERE "status" = 'VERIFIED' AND "nextReverifyAt" IS NULL;
