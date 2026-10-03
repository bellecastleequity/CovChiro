-- Test site (SANDBOX_MODE): emails and texts captured instead of sent. Unused on the live site. Re-runnable.
CREATE TABLE IF NOT EXISTS "SandboxMessage" (
  "id" TEXT NOT NULL,
  "channel" TEXT NOT NULL,
  "to" TEXT NOT NULL,
  "subject" TEXT,
  "body" TEXT NOT NULL,
  "html" TEXT,
  "delivered" BOOLEAN NOT NULL DEFAULT false,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "SandboxMessage_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SandboxMessage_createdAt_idx" ON "SandboxMessage"("createdAt");
CREATE INDEX IF NOT EXISTS "SandboxMessage_to_idx" ON "SandboxMessage"("to");
