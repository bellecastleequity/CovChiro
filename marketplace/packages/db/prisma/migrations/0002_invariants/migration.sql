-- Platform invariants enforced in the database (SPEC §2, §5.1–5.3).
-- These are the last line of defense if application code has a bug.
-- Never weaken these (see CLAUDE.md).

-- ============================================================
-- Geo columns (PostGIS) kept in sync from lat/lng, with GiST indexes
-- ============================================================
CREATE OR REPLACE FUNCTION sync_doctor_geo() RETURNS trigger AS $$
BEGIN
  IF NEW."homeLat" IS NOT NULL AND NEW."homeLng" IS NOT NULL THEN
    NEW."homeGeo" := ST_SetSRID(ST_MakePoint(NEW."homeLng", NEW."homeLat"), 4326)::geography;
  ELSE
    NEW."homeGeo" := NULL;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER doctor_geo BEFORE INSERT OR UPDATE OF "homeLat", "homeLng" ON "Doctor"
FOR EACH ROW EXECUTE FUNCTION sync_doctor_geo();
CREATE INDEX doctor_home_geo_idx ON "Doctor" USING gist ("homeGeo");

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
-- Shift: state copied from location; INV-6 state must be enabled to post
-- ============================================================
CREATE OR REPLACE FUNCTION sync_shift_state() RETURNS trigger AS $$
DECLARE
  loc_state char(2);
BEGIN
  SELECT l.state INTO loc_state FROM "ClinicLocation" l WHERE l.id = NEW."locationId";
  IF TG_OP = 'INSERT' THEN
    NEW.state := loc_state;
  ELSIF NEW.state IS DISTINCT FROM loc_state THEN
    RAISE EXCEPTION 'INV-1: shift state must match its location state' USING ERRCODE = 'check_violation';
  END IF;
  IF NEW."endsAt" <= NEW."startsAt" THEN
    RAISE EXCEPTION 'shift must end after it starts' USING ERRCODE = 'check_violation';
  END IF;
  -- INV-6: leaving DRAFT (posting) requires the state to be enabled.
  IF NEW.status NOT IN ('DRAFT', 'CANCELLED', 'COMPLETED', 'UNFILLED', 'IN_PROGRESS')
     AND (TG_OP = 'INSERT' OR OLD.status = 'DRAFT')
     AND NOT EXISTS (SELECT 1 FROM "StateConfig" c WHERE c.state = NEW.state AND c.enabled) THEN
    RAISE EXCEPTION 'INV-6: state % is not enabled', NEW.state USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER shift_state_sync BEFORE INSERT OR UPDATE ON "Shift"
FOR EACH ROW EXECUTE FUNCTION sync_shift_state();

-- ============================================================
-- Shared credential check used by the Application and Assignment triggers
-- ============================================================
CREATE OR REPLACE FUNCTION doctor_has_credentials(p_doctor text, p_state char(2), p_ends timestamptz) RETURNS text AS $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM "License" l
    WHERE l."doctorId" = p_doctor AND l.state = p_state AND l.status = 'VERIFIED' AND l."expiresAt" > p_ends
  ) THEN
    RETURN format('INV-1: doctor %s has no verified license in %s valid through shift end', p_doctor, p_state);
  END IF;
  IF NOT EXISTS (
    SELECT 1 FROM "MalpracticePolicy" m
    WHERE m."doctorId" = p_doctor AND m.status = 'VERIFIED' AND m."expiresAt" > p_ends
  ) THEN
    RETURN format('INV-3: doctor %s has no verified malpractice valid through shift end', p_doctor);
  END IF;
  RETURN NULL;
END $$ LANGUAGE plpgsql STABLE;

-- ============================================================
-- Application: qualifying license at insert time
-- ============================================================
CREATE OR REPLACE FUNCTION enforce_application_eligibility() RETURNS trigger AS $$
DECLARE
  s record;
  err text;
BEGIN
  SELECT state, "endsAt" INTO s FROM "Shift" WHERE id = NEW."shiftId";
  err := doctor_has_credentials(NEW."doctorId", s.state, s."endsAt");
  IF err IS NOT NULL THEN
    RAISE EXCEPTION '%', err USING ERRCODE = 'check_violation';
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER application_eligibility BEFORE INSERT ON "Application"
FOR EACH ROW EXECUTE FUNCTION enforce_application_eligibility();

-- Offers too: nobody can be offered a shift they can't legally work.
CREATE OR REPLACE FUNCTION enforce_offer_eligibility() RETURNS trigger AS $$
DECLARE
  s record;
  err text;
BEGIN
  IF NEW.status = 'PENDING' THEN
    SELECT state, "endsAt" INTO s FROM "Shift" WHERE id = NEW."shiftId";
    err := doctor_has_credentials(NEW."doctorId", s.state, s."endsAt");
    IF err IS NOT NULL THEN
      RAISE EXCEPTION '%', err USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER offer_eligibility BEFORE INSERT ON "Offer"
FOR EACH ROW EXECUTE FUNCTION enforce_offer_eligibility();

-- ============================================================
-- Assignment: INV-1 / INV-3 last line of defense + buffered range
-- ============================================================
CREATE OR REPLACE FUNCTION enforce_assignment_eligibility() RETURNS trigger AS $$
DECLARE
  shift_state char(2);
  err text;
BEGIN
  NEW."bufferedRange" := tstzrange(
    NEW."startsAt" - make_interval(mins => NEW."bufferMinutes"),
    NEW."endsAt" + make_interval(mins => NEW."bufferMinutes"),
    '[)');
  IF NEW.status IN ('CONFIRMED', 'IN_PROGRESS') THEN
    SELECT s.state INTO shift_state FROM "Shift" s WHERE s.id = NEW."shiftId";
    IF NEW.state IS DISTINCT FROM shift_state THEN
      RAISE EXCEPTION 'INV-1: assignment state does not match shift state' USING ERRCODE = 'check_violation';
    END IF;
    err := doctor_has_credentials(NEW."doctorId", NEW.state, NEW."endsAt");
    IF err IS NOT NULL THEN
      RAISE EXCEPTION '%', err USING ERRCODE = 'check_violation';
    END IF;
  END IF;
  RETURN NEW;
END $$ LANGUAGE plpgsql;

CREATE TRIGGER assignment_eligibility BEFORE INSERT OR UPDATE ON "Assignment"
FOR EACH ROW EXECUTE FUNCTION enforce_assignment_eligibility();

-- INV-2: no double-booking (buffered ranges of active assignments may not overlap).
ALTER TABLE "Assignment"
  ADD CONSTRAINT no_doctor_overlap
  EXCLUDE USING gist ("doctorId" WITH =, "bufferedRange" WITH &&)
  WHERE (status IN ('CONFIRMED', 'IN_PROGRESS'));

-- One live assignment per shift (concurrent selections produce exactly one).
CREATE UNIQUE INDEX one_live_assignment_per_shift ON "Assignment" ("shiftId")
  WHERE status IN ('CONFIRMED', 'IN_PROGRESS', 'COMPLETED', 'DISPUTED');

-- ============================================================
-- INV-6: a state can only be enabled after legal review
-- ============================================================
ALTER TABLE "StateConfig"
  ADD CONSTRAINT state_enable_requires_legal_review CHECK (NOT enabled OR "legalReviewComplete");

-- ============================================================
-- Money integrity
-- ============================================================
ALTER TABLE "PromoCode" ADD CONSTRAINT promo_uses_within_max CHECK ("maxUses" IS NULL OR "usedCount" <= "maxUses");
ALTER TABLE "PromoCode" ADD CONSTRAINT promo_value_sane CHECK (value >= 0 AND (kind <> 'PERCENT' OR value <= 100));
ALTER TABLE "Payout" ADD CONSTRAINT payout_sign CHECK (kind = 'ADJUSTMENT' OR "amountCents" >= 0);
ALTER TABLE "PayoutTransfer" ADD CONSTRAINT transfer_positive CHECK ("amountCents" > 0);
ALTER TABLE "Payment" ADD CONSTRAINT payment_positive CHECK ("amountCents" > 0);
ALTER TABLE "Shift" ADD CONSTRAINT shift_discount_within_margin CHECK ("promoDiscountCents" >= 0 AND "promoDiscountCents" <= GREATEST(0, "clinicPriceCents" - "doctorPayCents"));

-- A paid ledger row is final: its amount can't change and it can't be un-paid.
CREATE OR REPLACE FUNCTION guard_paid_payout() RETURNS trigger AS $$
BEGIN
  IF OLD.status = 'PAID' AND (NEW.status <> 'PAID' OR NEW."amountCents" <> OLD."amountCents" OR NEW."doctorId" <> OLD."doctorId") THEN
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
