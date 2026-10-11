-- Blog posts: an embedded YouTube video and an optional suggested video at the end. Re-runnable.
ALTER TABLE "BlogPost" ADD COLUMN IF NOT EXISTS "videoUrl" TEXT;
ALTER TABLE "BlogPost" ADD COLUMN IF NOT EXISTS "suggestedVideoUrl" TEXT;
