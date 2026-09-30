-- Private post-shift feedback from a clinic to a provider (visible to the provider only).
CREATE TABLE IF NOT EXISTS "ProviderFeedback" (
    "id" TEXT NOT NULL,
    "assignmentId" TEXT NOT NULL,
    "providerId" TEXT NOT NULL,
    "clinicOrgId" TEXT NOT NULL,
    "authorUserId" TEXT NOT NULL,
    "body" TEXT NOT NULL,
    "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "updatedAt" TIMESTAMPTZ(3) NOT NULL,
    "readAt" TIMESTAMPTZ(3),
    CONSTRAINT "ProviderFeedback_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "ProviderFeedback_assignmentId_key" ON "ProviderFeedback"("assignmentId");
CREATE INDEX IF NOT EXISTS "ProviderFeedback_providerId_createdAt_idx" ON "ProviderFeedback"("providerId", "createdAt");
