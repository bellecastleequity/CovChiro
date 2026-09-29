-- Platform invariants enforced in the database (SPEC §2, §5.1–5.3, as revised
-- by Addendum 01 §5.4: licensure is profession + state, plus INV-8 supervision).
-- These are the last line of defense if application code has a bug.
-- Never weaken these (see CLAUDE.md).

-- ============================================================
-- Geo columns (PostGIS) kept in sync from lat/lng, with GiST indexes
-- ============================================================
CREATE OR REPLACE FUNCTION sync_provider_geo() RETURNS trigger AS $$
BEGIN
  IF NEW."homeLat" IS NOT NULL AND NEW."homeLng" IS NOT NULL THEN
    NEW."homeGeo" := ST_SetSRID(ST_MakePoint(NEW."homeLng", NEW."homeLat"), 4326)::geography;
  ELSE
    NEW."homeGeo" := NULL;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER provider_geo BEFORE INSERT OR UPDATE OF "homeLat", "homeLng" ON "Provider"
FOR EACH ROW EXECUTE FUNCTION sync_provider_geo();
CREATE INDEX provider_home_geo_idx ON "Provider" USING gist ("homeGeo");

-- ============================================================
-- ClinicLocation: state comes from the geocoder only (INV-1 definitions)
-- ============================================================
CREATE OR REPLACE FUNCTION guard_location_state() RETURNS trigger AS $$
BEGIN
  NEW.geo := ST_SetSRID(ST_MakePoint(NEW.lng, NEW.lat), 4326)::geography;
  IF TG_OP = 'UPDATE' THEN
    IF (NEW.state IS DISTINCT FROM OLD.state
        OR NEW.lat IS DISTINCT FROM OLD.lat
        OR NEW.lng IS DISTINCT FROM OLD.lng
        OR NEW."addressLine1" IS DISTINCT FROM OLD."addressLine1"
        OR NEW.zip IS DISTINCT FROM OLD.zip)
       AND NEW."geocodedAt" IS NOT DISTINCT FROM OLD."geocodedAt" THEN
      RAISE EXCEPTION 'INV-1: location address/state can only change through a fresh geocode'
        USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.state IS DISTINCT FROM OLD.state AND EXISTS (
      SELECT 1 FROM "Shift" s WHERE s."locationId" = NEW.id
        AND s.status NOT IN ('COMPLETED', 'UNFILLED', 'CANCELLED')
    ) THEN
      RAISE EXCEPTION 'INV-1: cannot move location % to another state while it has active shifts', NEW.id
        USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER location_state_guard BEFORE INSERT OR UPDATE ON "ClinicLocation"
FOR EACH ROW EXECUTE FUNCTION guard_location_state();
CREATE INDEX clinic_location_geo_idx ON "ClinicLocation" USING gist (geo);

-- ============================================================
-- Shift: state copied from location; posting requires StateConfig AND
-- ProfessionStateConfig enabled (INV-6), supervision attestation where
-- required (INV-8), and only in-scope skills (Addendum 01 §6.1).
-- ============================================================
CREATE OR REPLACE FUNCTION supervision_problem(p_attestation jsonb, p_codes text[]) RETURNS text AS $$
BEGIN
  IF p_attestation IS NULL THEN
    RETURN 'no attestation';
  END IF;
  IF length(coalesce(p_attestation->>'supervisorName', '')) < 2
     OR length(coalesce(p_attestation->>'supervisorLicenseNumber', '')) < 3
     OR coalesce((p_attestation->>'onSiteEntireShift')::boolean, false) IS NOT TRUE THEN
    RETURN 'incomplete attestation';
  END IF;
  IF NOT (upper(p_attestation->>'supervisorProfessionCode') = ANY(p_codes)) THEN
    RETURN format('supervisor profession %s not allowed (need one of %s)', p_attestation->>'supervisorProfessionCode', array_to_string(p_codes, ', '));
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql IMMUTABLE;

CREATE OR REPLACE FUNCTION sync_shift_state() RETURNS trigger AS $$
DECLARE
  loc_state char(2);
  psc record;
  posting boolean;
  bad_skills int;
  sup text;
BEGIN
  SELECT l.state INTO loc_state FROM "ClinicLocation" l WHERE l.id = NEW."locationId";
  IF TG_OP = 'INSERT' THEN
    NEW.state := loc_state;
  ELSIF NEW.state IS DISTINCT FROM loc_state THEN
    RAISE EXCEPTION 'INV-1: shift state must match its location state' USING ERRCODE = 'check_violation';
  END IF;
  IF TG_OP = 'UPDATE' AND OLD.status <> 'DRAFT' AND NEW."professionCode" IS DISTINCT FROM OLD."professionCode" THEN
    RAISE EXCEPTION 'INV-1: a posted shift cannot change profession' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."endsAt" <= NEW."startsAt" THEN
    RAISE EXCEPTION 'shift must end after it starts' USING ERRCODE = 'check_violation';
  END IF;

  posting := NEW.status NOT IN ('DRAFT', 'CANCELLED', 'COMPLETED', 'UNFILLED', 'IN_PROGRESS')
             AND (TG_OP = 'INSERT' OR OLD.status = 'DRAFT');
  IF posting THEN
    IF NOT EXISTS (SELECT 1 FROM "StateConfig" c WHERE c.state = NEW.state AND c.enabled) THEN
      RAISE EXCEPTION 'INV-6: state % is not enabled', NEW.state USING ERRCODE = 'check_violation';
    END IF;
    SELECT * INTO psc FROM "ProfessionStateConfig" WHERE "professionCode" = NEW."professionCode" AND state = NEW.state;
    IF psc IS NULL OR psc.enabled IS NOT TRUE THEN
      RAISE EXCEPTION 'INV-6: profession % not enabled in %', NEW."professionCode", NEW.state USING ERRCODE = 'check_violation';
    END IF;
    IF psc."supervisionRequired" THEN
      sup := supervision_problem(NEW."supervisionAttestation"::jsonb, psc."supervisingProfessionCodes");
      IF sup IS NOT NULL OR NEW."supervisionAttestedAt" IS NULL THEN
        RAISE EXCEPTION 'INV-8: supervision not attested for shift % (%)', NEW.id, coalesce(sup, 'not attested') USING ERRCODE = 'check_violation';
      END IF;
    END IF;
    SELECT count(*) INTO bad_skills
    FROM "Skill" k
    WHERE k.id = ANY(NEW."requiredSkillIds" || NEW."preferredSkillIds")
      AND k."scopeSensitive"
      AND NOT EXISTS (
        SELECT 1 FROM "SkillStateRule" r
        WHERE r."skillId" = k.id AND r."professionCode" = NEW."professionCode" AND r.state = NEW.state AND r.allowed
      );
    IF bad_skills > 0 THEN
      RAISE EXCEPTION 'SCOPE: % skill(s) not allowed for % in %', bad_skills, NEW."professionCode", NEW.state USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER shift_state_sync BEFORE INSERT OR UPDATE ON "Shift"
FOR EACH ROW EXECUTE FUNCTION sync_shift_state();

-- ============================================================
-- Shared credential check (INV-1 profession + state, INV-3, INV-6, INV-8),
-- used by the Application, Offer and Assignment triggers. Returns NULL when
-- the provider may work the shift, otherwise the reason.
-- ============================================================
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
      AND l.state = s.state
      AND l.status = 'VERIFIED'
      AND l."expiresAt" > p_ends
  ) THEN
    RETURN format('INV-1: provider %s lacks verified %s license in %s valid through shift end', p_provider, s."professionCode", s.state);
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

-- ============================================================
-- Application and Offer: qualifying credentials at insert time
-- ============================================================
CREATE OR REPLACE FUNCTION enforce_application_eligibility() RETURNS trigger AS $$
DECLARE
  err text;
BEGIN
  err := provider_shift_problem(NEW."providerId", NEW."shiftId", (SELECT "endsAt" FROM "Shift" WHERE id = NEW."shiftId"));
  IF err IS NOT NULL THEN
    RAISE EXCEPTION '%', err USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER application_eligibility BEFORE INSERT ON "Application"
FOR EACH ROW EXECUTE FUNCTION enforce_application_eligibility();

CREATE OR REPLACE FUNCTION enforce_offer_eligibility() RETURNS trigger AS $$
DECLARE
  err text;
BEGIN
  IF NEW.status = 'PENDING' THEN
    err := provider_shift_problem(NEW."providerId", NEW."shiftId", (SELECT "endsAt" FROM "Shift" WHERE id = NEW."shiftId"));
    IF err IS NOT NULL THEN
      RAISE EXCEPTION '%', err USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER offer_eligibility BEFORE INSERT ON "Offer"
FOR EACH ROW EXECUTE FUNCTION enforce_offer_eligibility();

-- ============================================================
-- Assignment: last line of defense (Addendum 01 §5.4) + buffered range
-- ============================================================
CREATE OR REPLACE FUNCTION enforce_assignment_eligibility() RETURNS trigger AS $$
DECLARE
  s record;
  err text;
BEGIN
  NEW."bufferedRange" := tstzrange(
    NEW."startsAt" - make_interval(mins => NEW."bufferMinutes"),
    NEW."endsAt" + make_interval(mins => NEW."bufferMinutes"),
    '[)');
  IF NEW.status IN ('CONFIRMED', 'IN_PROGRESS') THEN
    SELECT * INTO s FROM "Shift" WHERE id = NEW."shiftId";
    IF NEW.state IS DISTINCT FROM s.state OR NEW."professionCode" IS DISTINCT FROM s."professionCode" THEN
      RAISE EXCEPTION 'INV-1: assignment state/profession does not match shift' USING ERRCODE = 'check_violation';
    END IF;
    err := provider_shift_problem(NEW."providerId", NEW."shiftId", NEW."endsAt");
    IF err IS NOT NULL THEN
      RAISE EXCEPTION '%', err USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER assignment_eligibility BEFORE INSERT OR UPDATE ON "Assignment"
FOR EACH ROW EXECUTE FUNCTION enforce_assignment_eligibility();

-- INV-2: no double-booking across ALL professions (buffered ranges of a provider's active assignments may not overlap).
ALTER TABLE "Assignment"
  ADD CONSTRAINT no_provider_overlap
  EXCLUDE USING gist ("providerId" WITH =, "bufferedRange" WITH &&)
  WHERE (status IN ('CONFIRMED', 'IN_PROGRESS'));

-- One live assignment per shift (concurrent selections produce exactly one).
CREATE UNIQUE INDEX one_live_assignment_per_shift ON "Assignment" ("shiftId")
  WHERE status IN ('CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'DISPUTED');

-- ============================================================
-- INV-6: a state can only be enabled after legal review
-- ============================================================
ALTER TABLE "StateConfig"
  ADD CONSTRAINT state_enable_requires_legal_review CHECK (NOT enabled OR "legalReviewComplete");

-- Addendum 01 §3.2: a profession-state pair can be enabled only when its
-- checklist is complete. (Rate-card completeness is checked in the service
-- layer, which also refuses to enable when the state row is disabled.)
ALTER TABLE "ProfessionStateConfig"
  ADD CONSTRAINT psc_enable_checklist CHECK (
    NOT enabled OR (
      "legalReviewComplete"
      AND ("licensedAtStateLevel" OR "alternativeCredentialAllowed")
      AND "boardLookupUrl" IS NOT NULL
      AND "supervisionRequired" IS NOT NULL
      AND (NOT "supervisionRequired" OR cardinality("supervisingProfessionCodes") > 0)
      AND "malpracticeMinOccurrenceCents" IS NOT NULL
      AND "malpracticeMinAggregateCents" IS NOT NULL
    ));

CREATE OR REPLACE FUNCTION guard_psc_state_enabled() RETURNS trigger AS $$
BEGIN
  IF NEW.enabled AND NOT EXISTS (SELECT 1 FROM "StateConfig" c WHERE c.state = NEW.state AND c.enabled) THEN
    RAISE EXCEPTION 'INV-6: enable state % before enabling % there', NEW.state, NEW."professionCode" USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER psc_requires_state BEFORE INSERT OR UPDATE ON "ProfessionStateConfig"
FOR EACH ROW EXECUTE FUNCTION guard_psc_state_enabled();

-- ============================================================
-- Money integrity
-- ============================================================
ALTER TABLE "PromoCode" ADD CONSTRAINT promo_uses_within_max CHECK ("maxUses" IS NULL OR "usedCount" <= "maxUses");
ALTER TABLE "PromoCode" ADD CONSTRAINT promo_value_sane CHECK (value >= 0 AND (kind <> 'PERCENT' OR value <= 100));
ALTER TABLE "Payout" ADD CONSTRAINT payout_sign CHECK (kind = 'ADJUSTMENT' OR "amountCents" >= 0);
ALTER TABLE "PayoutTransfer" ADD CONSTRAINT transfer_positive CHECK ("amountCents" > 0);
ALTER TABLE "Payment" ADD CONSTRAINT payment_positive CHECK ("amountCents" > 0);
ALTER TABLE "Shift" ADD CONSTRAINT shift_discount_within_margin CHECK ("promoDiscountCents" >= 0 AND "promoDiscountCents" <= GREATEST(0, "clinicPriceCents" - "providerPayCents"));

-- A paid ledger row is final: its amount can't change and it can't be un-paid.
CREATE OR REPLACE FUNCTION guard_paid_payout() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'PAID' AND (NEW.status <> 'PAID' OR NEW."amountCents" <> OLD."amountCents" OR NEW."providerId" <> OLD."providerId") THEN
    RAISE EXCEPTION 'paid payouts are immutable (use an ADJUSTMENT)' USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER payout_paid_guard BEFORE UPDATE ON "Payout"
FOR EACH ROW EXECUTE FUNCTION guard_paid_payout();

-- Audit log is append-only.
CREATE OR REPLACE FUNCTION audit_log_append_only() RETURNS trigger AS $$
BEGIN
  RAISE EXCEPTION 'AuditLog is append-only' USING ERRCODE = 'check_violation';
END $$ LANGUAGE plpgsql;

CREATE TRIGGER audit_log_immutable BEFORE UPDATE OR DELETE ON "AuditLog"
FOR EACH ROW EXECUTE FUNCTION audit_log_append_only();
