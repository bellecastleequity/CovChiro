-- Admin → Texts: texts to the business number that aren't shift-offer replies, and the team's replies.
CREATE TABLE IF NOT EXISTS "TextMessage" (
  "id" TEXT NOT NULL,
  "phone" TEXT NOT NULL,
  "direction" TEXT NOT NULL,
  "body" TEXT NOT NULL,
  "userId" TEXT,
  "authorUserId" TEXT,
  "status" TEXT,
  "error" TEXT,
  "readAt" TIMESTAMPTZ(3),
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "TextMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "TextMessage_phone_createdAt_idx" ON "TextMessage"("phone", "createdAt");
CREATE INDEX IF NOT EXISTS "TextMessage_direction_readAt_idx" ON "TextMessage"("direction", "readAt");
DO $$ BEGIN
  ALTER TABLE "TextMessage" ADD CONSTRAINT "TextMessage_userId_fkey" FOREIGN KEY ("userId") REFERENCES "User"("id") ON DELETE SET NULL ON UPDATE CASCADE;
EXCEPTION WHEN duplicate_object THEN NULL; END $$;
