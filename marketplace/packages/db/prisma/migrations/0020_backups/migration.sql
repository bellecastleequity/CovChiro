-- Backups: nightly encrypted exports, Neon restore points and restores. Re-runnable.
CREATE TABLE IF NOT EXISTS "BackupRun" (
    "id" TEXT NOT NULL,
    "kind" TEXT NOT NULL,
    "status" TEXT NOT NULL DEFAULT 'RUNNING',
    "label" TEXT,
    "tier" TEXT,
    "storageKey" TEXT,
    "sizeBytes" INTEGER,
    "rowCount" INTEGER,
    "tables" JSONB,
    "neonBranchId" TEXT,
    "restoredTo" TIMESTAMPTZ(3),
    "error" TEXT,
    "createdById" TEXT,
    "startedAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,
    "finishedAt" TIMESTAMPTZ(3),
    CONSTRAINT "BackupRun_pkey" PRIMARY KEY ("id")
);
CREATE INDEX IF NOT EXISTS "BackupRun_kind_startedAt_idx" ON "BackupRun"("kind", "startedAt");
