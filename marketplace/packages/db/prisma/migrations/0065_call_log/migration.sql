-- Phone line call menu: "continue by text" and callback requests from callers to (855) 55-COVER.
CREATE TABLE IF NOT EXISTS "CallLog" (
  "id" TEXT NOT NULL,
  "contactKey" TEXT NOT NULL,
  "kind" TEXT NOT NULL,
  "callerPhone" TEXT,
  "phone" TEXT,
  "choice" TEXT NOT NULL,
  "outcome" TEXT NOT NULL,
  "error" TEXT,
  "handledAt" TIMESTAMPTZ(3),
  "handledById" TEXT,
  "createdAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
  CONSTRAINT "CallLog_pkey" PRIMARY KEY ("id")
);
CREATE UNIQUE INDEX IF NOT EXISTS "CallLog_contactKey_key" ON "CallLog"("contactKey");
CREATE INDEX IF NOT EXISTS "CallLog_kind_handledAt_idx" ON "CallLog"("kind", "handledAt");
CREATE INDEX IF NOT EXISTS "CallLog_phone_createdAt_idx" ON "CallLog"("phone", "createdAt");
