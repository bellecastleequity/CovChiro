-- Rewards & Badges: custom badges and badges given to providers by hand. Re-runnable.
CREATE TABLE IF NOT EXISTS "CustomBadge" (
  "id" TEXT NOT NULL,
  "key" TEXT NOT NULL,
  "label" TEXT NOT NULL,
  "description" TEXT NOT NULL,
  "tone" TEXT NOT NULL,
  "createdById" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "updatedAt" TIMESTAMPTZ(3) NOT NULL,
  "archivedAt" TIMESTAMPTZ(3),
  CONSTRAINT "CustomBadge_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CustomBadge_key_key" ON "CustomBadge"("key");

CREATE TABLE IF NOT EXISTS "BadgeAward" (
  "id" TEXT NOT NULL,
  "providerId" TEXT NOT NULL,
  "badgeKey" TEXT NOT NULL,
  "note" TEXT,
  "awardedById" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "BadgeAward_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "BadgeAward_providerId_badgeKey_key" ON "BadgeAward"("providerId", "badgeKey");
CREATE INDEX IF NOT EXISTS "BadgeAward_badgeKey_idx" ON "BadgeAward"("badgeKey");
DO $$ BEGIN
  ALTER TABLE "BadgeAward" ADD CONSTRAINT "BadgeAward_providerId_fkey" FOREIGN KEY ("providerId") REFERENCES "Provider"("id") ON DELETE CASCADE ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
