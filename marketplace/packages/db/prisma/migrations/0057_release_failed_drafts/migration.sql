-- Approved outreach drafts whose send failed (the Oct 12 2026 SendGrid credits outage) were marked REJECTED
-- while still holding the step's dedupeKey, so the outreach sweep skipped that step for good. Release them:
-- status FAILED and dedupeKey cleared, so the sweep writes the step again. A failed send of an approved draft
-- leaves its own FAILED row (same record, prompt and approver, created after the draft); drafts a person
-- rejected have none and stay REJECTED. Data only, re-runnable.
UPDATE "Communication" d
SET "status" = 'FAILED', "dedupeKey" = NULL, "error" = COALESCE(d."error", 'Approved, but the send failed; step released for a new draft')
WHERE d."status" = 'REJECTED'
  AND d."dedupeKey" IS NOT NULL
  AND d."channel" = 'EMAIL'
  AND EXISTS (
    SELECT 1 FROM "Communication" f
    WHERE f."id" <> d."id"
      AND f."entityType" = d."entityType" AND f."entityId" = d."entityId"
      AND f."channel" = 'EMAIL' AND f."status" = 'FAILED' AND f."dedupeKey" IS NULL
      AND f."promptKey" IS NOT DISTINCT FROM d."promptKey"
      AND f."createdById" IS NOT DISTINCT FROM d."createdById"
      AND f."createdAt" >= d."createdAt"
  );
