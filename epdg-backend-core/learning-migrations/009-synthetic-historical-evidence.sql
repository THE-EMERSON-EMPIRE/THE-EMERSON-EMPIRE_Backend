-- Forward-only local-only synthetic resource and historical evidence catalog.
-- No source bytes, real identities, native receipts, grades, or completion are created.
DO $local_guard$
BEGIN
  IF current_database()<>'epdg_synthetic' OR current_user<>'epdg_synthetic_operator'
    OR to_regclass('synthetic_learning.schema_migrations') IS NULL
    OR NOT EXISTS(SELECT 1 FROM synthetic_learning.schema_migrations
      WHERE version='2026-10-24-synthetic-handoff-reviewer-provenance-v1'
        AND sha256='cb742fc41ce3b915585d779423dbc69ebc26397fe976f598f9d92f0479519d06') THEN
    RAISE EXCEPTION 'Reviewed local synthetic learning schema required' USING ERRCODE='23514';
  END IF;
END;
$local_guard$;

CREATE TABLE synthetic_learning.imported_resources (
  id uuid PRIMARY KEY,
  batch_id text NOT NULL CHECK(batch_id ~ '^SYNTHETIC-[A-Z0-9][A-Z0-9-]{0,79}$'),
  mapping_version text NOT NULL CHECK(mapping_version ~ '^SYNTHETIC-[A-Z0-9][A-Z0-9-]{0,79}$'),
  reviewer_key text NOT NULL CHECK(reviewer_key='SYNTHETIC-OPERATOR'),
  source_id text NOT NULL UNIQUE CHECK(source_id ~ '^SYNTHETIC-RESOURCE-[A-Z0-9][A-Z0-9-]{0,79}$'),
  source_version text NOT NULL CHECK(source_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),
  source_fingerprint text NOT NULL CHECK(source_fingerprint ~ '^[0-9a-f]{64}$'),
  program_id uuid NOT NULL REFERENCES synthetic_learning.programs(id),
  resource_kind text NOT NULL CHECK(resource_kind IN ('guide','reading','template','presentation','training','other')),
  format text NOT NULL CHECK(format IN ('docx','pdf','xlsx','pptx','image','video','audio','link','other')),
  title text NOT NULL CHECK(title LIKE 'SYNTHETIC %' AND char_length(title)<=200),
  description text NOT NULL CHECK(char_length(description) BETWEEN 1 AND 2000),
  source_ref text NOT NULL CHECK(source_ref ~ '^urn:epdg-synthetic:[A-Z0-9][A-Z0-9-]{0,99}$'),
  rights_use text NOT NULL CHECK(rights_use IN ('internal_training','approved')),
  source_permission_state text NOT NULL CHECK(source_permission_state='not_applicable_synthetic'),
  source_modified_at timestamptz NOT NULL,
  imported_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX synthetic_learning_imported_resources_program ON synthetic_learning.imported_resources(program_id,title,id);

CREATE TABLE synthetic_learning.historical_evidence (
  id uuid PRIMARY KEY,
  batch_id text NOT NULL CHECK(batch_id ~ '^SYNTHETIC-[A-Z0-9][A-Z0-9-]{0,79}$'),
  mapping_version text NOT NULL CHECK(mapping_version ~ '^SYNTHETIC-[A-Z0-9][A-Z0-9-]{0,79}$'),
  reviewer_key text NOT NULL CHECK(reviewer_key='SYNTHETIC-OPERATOR'),
  source_id text NOT NULL UNIQUE CHECK(source_id ~ '^SYNTHETIC-HISTORY-[A-Z0-9][A-Z0-9-]{0,79}$'),
  source_version text NOT NULL CHECK(source_version ~ '^[A-Za-z0-9][A-Za-z0-9._-]{0,39}$'),
  source_fingerprint text NOT NULL CHECK(source_fingerprint ~ '^[0-9a-f]{64}$'),
  learner_id integer NOT NULL REFERENCES core.users(id),
  enrollment_id uuid NOT NULL,
  program_id uuid NOT NULL,
  assignment_id uuid,
  record_kind text NOT NULL CHECK(record_kind IN ('deliverable','revision','mentor_feedback','evaluation')),
  source_format text NOT NULL CHECK(source_format IN ('docx','pdf','xlsx','pptx','image','video','audio','link','other')),
  title text NOT NULL CHECK(title LIKE 'SYNTHETIC %' AND char_length(title)<=200),
  summary text NOT NULL CHECK(summary LIKE 'SYNTHETIC %' AND char_length(summary) BETWEEN 1 AND 2000),
  source_ref text NOT NULL CHECK(source_ref ~ '^urn:epdg-synthetic:[A-Z0-9][A-Z0-9-]{0,99}$'),
  original_work_at timestamptz NOT NULL,
  source_modified_at timestamptz NOT NULL,
  source_permission_state text NOT NULL CHECK(source_permission_state='not_applicable_synthetic'),
  privacy_decision text NOT NULL CHECK(privacy_decision IN ('learner_and_assigned_mentor','learner_only')),
  imported_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(enrollment_id,program_id) REFERENCES synthetic_learning.enrollments(id,program_id),
  FOREIGN KEY(assignment_id,program_id) REFERENCES synthetic_learning.items(id,program_id)
);
CREATE INDEX synthetic_learning_history_learner ON synthetic_learning.historical_evidence(learner_id,program_id,original_work_at DESC,id);
CREATE INDEX synthetic_learning_history_enrollment ON synthetic_learning.historical_evidence(enrollment_id,privacy_decision,original_work_at DESC);
CREATE INDEX synthetic_learning_history_mentor_assignment ON synthetic_learning.historical_evidence(enrollment_id,privacy_decision,assignment_id);

CREATE FUNCTION synthetic_learning.guard_imported_resource() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  IF TG_OP<>'INSERT' OR current_database()<>'epdg_synthetic' OR current_user<>'epdg_synthetic_operator' THEN
    RAISE EXCEPTION 'Synthetic resource imports are immutable' USING ERRCODE='23514';
  END IF;
  NEW.imported_at=clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER imported_resource_guard BEFORE INSERT OR UPDATE OR DELETE ON synthetic_learning.imported_resources
FOR EACH ROW EXECUTE FUNCTION synthetic_learning.guard_imported_resource();

CREATE FUNCTION synthetic_learning.guard_historical_evidence() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE enrollment synthetic_learning.enrollments%ROWTYPE;
BEGIN
  IF TG_OP<>'INSERT' OR current_database()<>'epdg_synthetic' OR current_user<>'epdg_synthetic_operator' THEN
    RAISE EXCEPTION 'Historical learning evidence is immutable' USING ERRCODE='23514';
  END IF;
  SELECT * INTO enrollment FROM synthetic_learning.enrollments e
    WHERE e.id=NEW.enrollment_id AND e.program_id=NEW.program_id;
  IF NOT FOUND OR enrollment.user_id<>NEW.learner_id OR
    (NEW.assignment_id IS NOT NULL AND NOT EXISTS(SELECT 1 FROM synthetic_learning.items i
      WHERE i.id=NEW.assignment_id AND i.program_id=NEW.program_id AND i.kind='assignment')) THEN
    RAISE EXCEPTION 'Mapped synthetic learner enrollment and assignment required' USING ERRCODE='23514';
  END IF;
  NEW.imported_at=clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER historical_evidence_guard BEFORE INSERT OR UPDATE OR DELETE ON synthetic_learning.historical_evidence
FOR EACH ROW EXECUTE FUNCTION synthetic_learning.guard_historical_evidence();

ALTER TABLE synthetic_learning.imported_resources ENABLE ROW LEVEL SECURITY;
ALTER TABLE synthetic_learning.historical_evidence ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON synthetic_learning.imported_resources,synthetic_learning.historical_evidence FROM PUBLIC;
REVOKE ALL ON FUNCTION synthetic_learning.guard_imported_resource() FROM PUBLIC;
REVOKE ALL ON FUNCTION synthetic_learning.guard_historical_evidence() FROM PUBLIC;
