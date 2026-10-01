-- This release: the Growth system (clinic prospect CRM, campaign links, suppression list,
-- communications log, prompts, knowledge base, escalations, agent audit log, AI spend)
-- and automatic clinic prospecting (NPI registry discovery + AI web research).
-- Run AFTER update-009 (pre-licensure). Safe to run more than once.
-- Run in Neon: SQL Editor → paste → Run.
-- @migration 0011_growth
-- @migration 0012_prospecting
-- Students who signed up on the student path before this update count as students in Growth too.
UPDATE "Provider" SET "isStudent" = true WHERE "preLicensure" = true AND "isStudent" = false;
SELECT 'update-010 applied' AS result;
