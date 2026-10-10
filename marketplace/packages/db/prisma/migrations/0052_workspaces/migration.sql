-- One login, two workspaces: a clinic owner can also take shifts as a provider (and a provider can add a clinic they own).
ALTER TABLE "Session" ADD COLUMN IF NOT EXISTS "workspace" TEXT;
