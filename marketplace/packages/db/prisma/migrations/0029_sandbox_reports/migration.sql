-- Test site (SANDBOX_MODE): error log and testers' problem reports. Unused on the live site. Re-runnable.
CREATE TABLE IF NOT EXISTS "SandboxError" (
  "id" TEXT NOT NULL,
  "fingerprint" TEXT NOT NULL,
  "source" TEXT NOT NULL,
  "message" TEXT NOT NULL,
  "detail" TEXT,
  "path" TEXT,
  "userId" TEXT,
  "count" INTEGER NOT NULL DEFAULT 1,
  "firstAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "lastAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMPTZ(3),
  CONSTRAINT "SandboxError_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "SandboxError_fingerprint_key" ON "SandboxError"("fingerprint");
CREATE INDEX IF NOT EXISTS "SandboxError_lastAt_idx" ON "SandboxError"("lastAt");

CREATE TABLE IF NOT EXISTS "SandboxReport" (
  "id" TEXT NOT NULL,
  "userId" TEXT,
  "reporterName" TEXT NOT NULL,
  "reporterEmail" TEXT,
  "actingAs" TEXT,
  "path" TEXT,
  "note" TEXT NOT NULL,
  "context" JSONB,
  "status" TEXT NOT NULL DEFAULT 'OPEN',
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  "resolvedAt" TIMESTAMPTZ(3),
  CONSTRAINT "SandboxReport_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "SandboxReport_status_createdAt_idx" ON "SandboxReport"("status", "createdAt");
