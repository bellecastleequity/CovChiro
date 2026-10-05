-- Sign in with Google (clinic and provider accounts): the Google account id linked to a user. Re-runnable.
ALTER TABLE "User" ADD COLUMN IF NOT EXISTS "googleSub" TEXT;
CREATE UNIQUE INDEX IF NOT EXISTS "User_googleSub_key" ON "User"("googleSub");
