-- Instagram follow list on clinic prospects (handles from research, paced manual follows). Re-runnable.
ALTER TABLE "ClinicProspect" ADD COLUMN IF NOT EXISTS "instagramHandle" TEXT;
ALTER TABLE "ClinicProspect" ADD COLUMN IF NOT EXISTS "igStatus" TEXT NOT NULL DEFAULT 'NONE';
ALTER TABLE "ClinicProspect" ADD COLUMN IF NOT EXISTS "igApprovedAt" TIMESTAMPTZ(3);
ALTER TABLE "ClinicProspect" ADD COLUMN IF NOT EXISTS "igAutoApproved" BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE "ClinicProspect" ADD COLUMN IF NOT EXISTS "igFollowedAt" TIMESTAMPTZ(3);
CREATE INDEX IF NOT EXISTS "ClinicProspect_igStatus_idx" ON "ClinicProspect"("igStatus");
