-- Additive local-only CRM clearance experiment; never a production migration.
-- Accounts, credentials, membership, enrollment and prior evidence are untouched.
CREATE SCHEMA synthetic_handoff;
REVOKE ALL ON SCHEMA synthetic_handoff FROM PUBLIC;

CREATE TABLE synthetic_handoff.mappings (
  id uuid PRIMARY KEY,
  person_id uuid NOT NULL,
  application_id uuid NOT NULL,
  crm_program_id uuid NOT NULL,
  reviewer_id uuid NOT NULL,
  user_id integer NOT NULL UNIQUE REFERENCES core.users(id),
  enrollment_id uuid NOT NULL UNIQUE REFERENCES synthetic_learning.enrollments(id),
  UNIQUE(person_id,application_id,crm_program_id)
);
CREATE TABLE synthetic_handoff.events (
  event_id uuid PRIMARY KEY,
  payload_sha256 text NOT NULL CHECK(payload_sha256 ~ '^[0-9a-f]{64}$'),
  mapping_id uuid NOT NULL REFERENCES synthetic_handoff.mappings(id),
  decision_id uuid NOT NULL UNIQUE,
  decision_version integer NOT NULL CHECK(decision_version BETWEEN 1 AND 1000000),
  decision text NOT NULL CHECK(decision IN ('cleared','held','revoked')),
  issued_at timestamptz NOT NULL,
  policy_version text NOT NULL CHECK(policy_version='synthetic-onboarding-v1'),
  reviewer_id uuid NOT NULL,
  identity_verified boolean NOT NULL,
  onboarding_complete boolean NOT NULL,
  agreements_complete boolean NOT NULL,
  hr_approved boolean NOT NULL,
  withdrawn boolean NOT NULL,
  received_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(mapping_id,decision_version),
  CHECK(decision<>'cleared' OR (identity_verified AND onboarding_complete AND agreements_complete AND hr_approved AND NOT withdrawn))
);
CREATE INDEX synthetic_handoff_latest ON synthetic_handoff.events(mapping_id,decision_version DESC);
CREATE TABLE synthetic_handoff.nonces (
  nonce uuid PRIMARY KEY,
  event_id uuid NOT NULL REFERENCES synthetic_handoff.events(event_id),
  received_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX synthetic_handoff_nonce_event ON synthetic_handoff.nonces(event_id);
ALTER TABLE synthetic_handoff.mappings ENABLE ROW LEVEL SECURITY;
ALTER TABLE synthetic_handoff.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE synthetic_handoff.nonces ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA synthetic_handoff FROM PUBLIC;

-- No definer privileges: GUC is an application feature gate, not a DB credential.
CREATE FUNCTION synthetic_handoff.enrollment_allowed(enrollment uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
  SELECT (enrollment<>'86000000-0000-4000-8000-000000000001'::uuid
    AND NOT EXISTS(SELECT 1 FROM synthetic_handoff.mappings m WHERE m.enrollment_id=enrollment))
    OR (coalesce(current_setting('synthetic_handoff.enabled',true)='on',false) AND EXISTS(
      SELECT 1 FROM synthetic_handoff.mappings m
      JOIN LATERAL (SELECT event.* FROM synthetic_handoff.events event WHERE event.mapping_id=m.id
        ORDER BY decision_version DESC LIMIT 1) latest ON true
      WHERE m.enrollment_id=enrollment AND latest.decision='cleared' AND NOT latest.withdrawn
        AND latest.identity_verified AND latest.onboarding_complete AND latest.agreements_complete AND latest.hr_approved));
$$;
CREATE FUNCTION synthetic_handoff.guard_mapping() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Synthetic mapping is immutable' USING ERRCODE='23514'; END IF;
  IF current_user<>'epdg_synthetic_operator' OR current_database()<>'epdg_synthetic'
    OR NEW.id<>'84000000-0000-4000-8000-000000000001'::uuid
    OR NEW.person_id<>'81000000-0000-4000-8000-000000000001'::uuid
    OR NEW.application_id<>'82000000-0000-4000-8000-000000000001'::uuid
    OR NEW.crm_program_id<>'83000000-0000-4000-8000-000000000001'::uuid
    OR NEW.reviewer_id<>'80000000-0000-4000-8000-000000000001'::uuid
    OR NEW.enrollment_id<>'86000000-0000-4000-8000-000000000001'::uuid OR NOT EXISTS(
    SELECT 1 FROM synthetic_learning.enrollments e JOIN synthetic_learning.programs p ON p.id=e.program_id AND p.school_id=e.school_id
    JOIN core.users u ON u.id=e.user_id
    JOIN portal_security.memberships m ON m.id=e.membership_id AND m.user_id=e.user_id AND m.school_id=e.school_id
    WHERE e.id=NEW.enrollment_id AND e.program_id='85000000-0000-4000-8000-000000000001'::uuid
      AND e.user_id=NEW.user_id AND e.active AND m.active
      AND u.email='learner-b@epdg.invalid' AND u.name LIKE 'SYNTHETIC %' AND p.title LIKE 'SYNTHETIC %') THEN
    RAISE EXCEPTION 'Preconfigured synthetic mapping required' USING ERRCODE='23514';
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER handoff_mapping_guard BEFORE INSERT OR UPDATE OR DELETE ON synthetic_handoff.mappings
FOR EACH ROW EXECUTE FUNCTION synthetic_handoff.guard_mapping();

CREATE FUNCTION synthetic_handoff.guard_event() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE mapping synthetic_handoff.mappings%ROWTYPE;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Handoff events are immutable' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('epdg-synthetic-crm-handoff-v1',0));
  IF current_user<>'epdg_synthetic_app' OR current_database()<>'epdg_synthetic'
    OR current_setting('synthetic_handoff.enabled',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Synthetic handoff is unavailable' USING ERRCODE='23514';
  END IF;
  SELECT * INTO mapping FROM synthetic_handoff.mappings m WHERE m.id=NEW.mapping_id;
  IF NOT FOUND OR mapping.reviewer_id<>NEW.reviewer_id OR EXISTS(
    SELECT 1 FROM synthetic_handoff.events event WHERE event.mapping_id=NEW.mapping_id AND event.decision_version>=NEW.decision_version)
    OR NEW.issued_at<clock_timestamp()-interval '300 seconds' OR NEW.issued_at>clock_timestamp()+interval '30 seconds' THEN
    RAISE EXCEPTION 'Current preconfigured clearance decision required' USING ERRCODE='23514';
  END IF;
  NEW.received_at=clock_timestamp(); RETURN NEW;
END;
$$;
CREATE TRIGGER handoff_event_guard BEFORE INSERT OR UPDATE OR DELETE ON synthetic_handoff.events
FOR EACH ROW EXECUTE FUNCTION synthetic_handoff.guard_event();

CREATE FUNCTION synthetic_handoff.guard_nonce() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Handoff nonces are retained' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('epdg-synthetic-crm-handoff-v1',0));
  IF current_user<>'epdg_synthetic_app' OR current_database()<>'epdg_synthetic'
    OR current_setting('synthetic_handoff.enabled',true) IS DISTINCT FROM 'on' THEN
    RAISE EXCEPTION 'Synthetic handoff is unavailable' USING ERRCODE='23514';
  END IF;
  NEW.received_at=clock_timestamp(); RETURN NEW;
END;
$$;
CREATE TRIGGER handoff_nonce_guard BEFORE INSERT OR UPDATE OR DELETE ON synthetic_handoff.nonces
FOR EACH ROW EXECUTE FUNCTION synthetic_handoff.guard_nonce();

-- Defense in depth for direct SQL through the restricted runtime role. Shared
-- operation locks serialize completed operations before a revocation receipt.
CREATE FUNCTION synthetic_handoff.guard_learning_write() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE enrollment uuid;
BEGIN
  PERFORM pg_advisory_xact_lock_shared(hashtextextended('epdg-synthetic-crm-handoff-v1',0));
  IF TG_TABLE_NAME IN ('mentor_review_drafts','mentor_review_feedback') THEN
    IF TG_OP='DELETE' THEN
      SELECT r.enrollment_id INTO enrollment FROM synthetic_learning.assignment_receipts r WHERE r.id=OLD.receipt_id;
    ELSE
      SELECT r.enrollment_id INTO enrollment FROM synthetic_learning.assignment_receipts r WHERE r.id=NEW.receipt_id;
    END IF;
  ELSIF TG_OP='DELETE' THEN enrollment=OLD.enrollment_id;
  ELSE enrollment=NEW.enrollment_id;
  END IF;
  IF enrollment IS NULL OR synthetic_handoff.enrollment_allowed(enrollment) IS DISTINCT FROM true THEN
    RAISE EXCEPTION 'Current onboarding clearance required' USING ERRCODE='23514';
  END IF;
  IF TG_OP='DELETE' THEN RETURN OLD; END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER a_handoff_completion_guard BEFORE INSERT OR UPDATE OR DELETE ON synthetic_learning.completions
FOR EACH ROW EXECUTE FUNCTION synthetic_handoff.guard_learning_write();
CREATE TRIGGER a_handoff_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON synthetic_learning.assignment_drafts
FOR EACH ROW EXECUTE FUNCTION synthetic_handoff.guard_learning_write();
CREATE TRIGGER a_handoff_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON synthetic_learning.assignment_receipts
FOR EACH ROW EXECUTE FUNCTION synthetic_handoff.guard_learning_write();
CREATE TRIGGER a_handoff_attachment_guard BEFORE INSERT OR UPDATE OR DELETE ON synthetic_learning.assignment_attachments
FOR EACH ROW EXECUTE FUNCTION synthetic_handoff.guard_learning_write();
CREATE TRIGGER a_handoff_mentor_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON synthetic_learning.mentor_review_drafts
FOR EACH ROW EXECUTE FUNCTION synthetic_handoff.guard_learning_write();
CREATE TRIGGER a_handoff_mentor_feedback_guard BEFORE INSERT OR UPDATE OR DELETE ON synthetic_learning.mentor_review_feedback
FOR EACH ROW EXECUTE FUNCTION synthetic_handoff.guard_learning_write();

-- Preserve the existing mentor predicate, adding the effective enrollment gate.
CREATE OR REPLACE FUNCTION synthetic_learning.mentor_scope_allowed(mapping uuid,receipt uuid) RETURNS boolean
LANGUAGE sql STABLE SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM synthetic_learning.mentor_assignments ma
 JOIN portal_security.memberships mm ON mm.id=ma.membership_id AND mm.user_id=ma.mentor_user_id AND mm.active AND mm.school_id=ma.school_id
 JOIN portal_security.account_states ms ON ms.user_id=ma.mentor_user_id AND ms.active
 JOIN core.users mu ON mu.id=ma.mentor_user_id AND mu.deleted_at IS NULL AND mu.is_verified
 JOIN epdg.users meu ON meu.id=mu.id AND meu.deleted_at IS NULL AND meu.is_verified AND meu.rejection_reason IS NULL
 JOIN synthetic_learning.enrollments e ON e.id=ma.enrollment_id AND e.active AND e.school_id=ma.school_id
 JOIN synthetic_learning.programs p ON p.id=e.program_id AND p.school_id=e.school_id
 JOIN portal_security.memberships lm ON lm.id=e.membership_id AND lm.user_id=e.user_id AND lm.active AND lm.school_id=e.school_id
 JOIN portal_security.account_states ls ON ls.user_id=e.user_id AND ls.active
 JOIN core.users lu ON lu.id=e.user_id AND lu.deleted_at IS NULL AND lu.is_verified
 JOIN epdg.users leu ON leu.id=lu.id AND leu.deleted_at IS NULL AND leu.is_verified AND leu.rejection_reason IS NULL
 JOIN epdg.schools s ON s.id=ma.school_id AND s.user_id=ma.mentor_user_id AND s.is_approved AND s.deleted_at IS NULL
 JOIN synthetic_learning.assignment_receipts r ON r.id=receipt AND r.enrollment_id=e.id AND r.program_id=p.id
 WHERE ma.id=mapping AND ma.active AND synthetic_handoff.enrollment_allowed(e.id)
 AND mu.name LIKE 'SYNTHETIC %' AND lu.name LIKE 'SYNTHETIC %'
 AND mu.email IN ('school-a@epdg.invalid','school-b@epdg.invalid')
 AND lu.email IN ('learner-a@epdg.invalid','learner-b@epdg.invalid')
 AND EXISTS(SELECT 1 FROM core.user_branch_roles ubr JOIN core.branches b ON b.id=ubr.branch_id
   WHERE ubr.user_id=mu.id AND b.code='epdg' AND ubr.role_name::text='school' AND ubr.rejection_reason IS NULL)
 AND EXISTS(SELECT 1 FROM core.user_branch_roles ubr JOIN core.branches b ON b.id=ubr.branch_id
   WHERE ubr.user_id=lu.id AND b.code='epdg' AND ubr.role_name::text='intern' AND ubr.rejection_reason IS NULL)
 AND EXISTS(SELECT 1 FROM epdg.intern_profiles ip WHERE ip.user_id=lu.id AND ip.school_id=e.school_id
   AND ip.is_approved AND ip.rejection_reason IS NULL));
$$;

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA synthetic_handoff FROM PUBLIC;
GRANT USAGE ON SCHEMA synthetic_handoff TO epdg_synthetic_app;
GRANT SELECT ON synthetic_handoff.mappings,synthetic_handoff.events,synthetic_handoff.nonces TO epdg_synthetic_app;
GRANT INSERT(event_id,payload_sha256,mapping_id,decision_id,decision_version,decision,issued_at,policy_version,reviewer_id,
  identity_verified,onboarding_complete,agreements_complete,hr_approved,withdrawn) ON synthetic_handoff.events TO epdg_synthetic_app;
GRANT INSERT(nonce,event_id) ON synthetic_handoff.nonces TO epdg_synthetic_app;
GRANT EXECUTE ON FUNCTION synthetic_handoff.enrollment_allowed(uuid) TO epdg_synthetic_app;
