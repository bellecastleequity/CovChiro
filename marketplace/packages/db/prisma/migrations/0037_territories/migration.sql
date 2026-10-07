-- Puerto Rico and the U.S. Virgin Islands join the state list (off until an admin enables them). Re-runnable.
INSERT INTO "StateConfig" ("state") VALUES ('PR'), ('VI') ON CONFLICT ("state") DO NOTHING;
