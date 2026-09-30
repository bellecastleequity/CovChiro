-- A5: national registry credentials (License.state = 'US') where a state
-- doesn't license the profession, plus a send log for booking digests.

-- Only where the state issues no license of its own.
-- (Statements are re-runnable so the cPanel update script can be run twice.)
ALTER TABLE "ProfessionStateConfig" DROP CONSTRAINT IF EXISTS psc_national_credential_only_unlicensed;
ALTER TABLE "ProfessionStateConfig"
  ADD CONSTRAINT psc_national_credential_only_unlicensed CHECK (NOT "alternativeCredentialAllowed" OR NOT "licensedAtStateLevel");

-- Same rule as @cm/core hasQualifyingLicense.
CREATE OR REPLACE FUNCTION provider_shift_problem(p_provider text, p_shift text, p_ends timestamptz) RETURNS text AS $$
DECLARE
  s record;
  psc record;
BEGIN
  SELECT * INTO s FROM "Shift" WHERE id = p_shift;
  SELECT * INTO psc FROM "ProfessionStateConfig" WHERE "professionCode" = s."professionCode" AND state = s.state;
  IF psc IS NULL OR psc.enabled IS NOT TRUE
     OR NOT EXISTS (SELECT 1 FROM "StateConfig" c WHERE c.state = s.state AND c.enabled) THEN
    RETURN format('INV-6: profession %s not enabled in %s', s."professionCode", s.state);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "License" l
    WHERE l."providerId" = p_provider
      AND l."professionCode" = s."professionCode"
      AND (l.state = s.state
           -- A5: a national registry credential counts only where the state
           -- issues no license and the admin accepts national credentials.
           OR (l.state = 'US' AND psc."alternativeCredentialAllowed" AND NOT psc."licensedAtStateLevel"))
      AND l.status = 'VERIFIED'
      AND l."expiresAt" > p_ends
  ) THEN
    RETURN format('INV-1: provider %s lacks verified %s license (or accepted national credential) in %s valid through shift end', p_provider, s."professionCode", s.state);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "MalpracticePolicy" m
    WHERE m."providerId" = p_provider
      AND s."professionCode" = ANY(m."coveredProfessionCodes")
      AND m.status = 'VERIFIED'
      AND m."expiresAt" > p_ends
      AND m."perOccurrenceCents" >= COALESCE(psc."malpracticeMinOccurrenceCents", 0)
      AND m."aggregateCents" >= COALESCE(psc."malpracticeMinAggregateCents", 0)
  ) THEN
    RETURN format('INV-3: provider %s lacks qualifying malpractice for %s', p_provider, s."professionCode");
  END IF;
  IF psc."supervisionRequired" AND (s."supervisionAttestedAt" IS NULL
      OR supervision_problem(s."supervisionAttestation"::jsonb, psc."supervisingProfessionCodes") IS NOT NULL) THEN
    RETURN format('INV-8: supervision not attested for shift %s', s.id);
  END IF;
  -- Required certification-based / scope-sensitive skills (Addendum 01 §6.1).
  IF EXISTS (
    SELECT 1 FROM "Skill" k
    WHERE k.id = ANY(s."requiredSkillIds")
      AND (
        (k."requiresCertification" AND NOT EXISTS (
          SELECT 1 FROM "ProviderSkill" ps
          WHERE ps."providerId" = p_provider AND ps."skillId" = k.id
            AND ps."certificationStatus" = 'VERIFIED' AND ps."certificationExpiresAt" > p_ends))
        OR (k."scopeSensitive" AND NOT EXISTS (
          SELECT 1 FROM "SkillStateRule" r
          WHERE r."skillId" = k.id AND r."professionCode" = s."professionCode" AND r.state = s.state AND r.allowed))
      )
  ) THEN
    RETURN format('SCOPE: provider %s lacks a verified certification (or the skill is out of scope) for shift %s', p_provider, s.id);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql STABLE;

-- One row per digest email sent (e.g. "daily:<providerId>:2026-10-01"), so
-- overlapping or repeated cron ticks never send the same digest twice.
CREATE TABLE IF NOT EXISTS "DigestSend" (
    "key" TEXT NOT NULL,
    "userId" TEXT NOT NULL,
    "sentAt" TIMESTAMPTZ(3) NOT NULL DEFAULT CURRENT_TIMESTAMP,

    CONSTRAINT "DigestSend_pkey" PRIMARY KEY ("key")
);
