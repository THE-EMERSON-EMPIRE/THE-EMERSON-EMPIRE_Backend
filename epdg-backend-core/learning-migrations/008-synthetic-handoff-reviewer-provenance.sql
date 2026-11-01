-- Forward-only local synthetic correction; 001-007 and retained rows are unchanged.
-- The authenticated CRM producer proves current HR authority. Its signed reviewer
-- UUID is event provenance, not part of the immutable learner mapping identity.
-- No account, membership, role, session or enrollment is created or updated.
DO $local_guard$
BEGIN
  IF current_database()<>'epdg_synthetic' OR current_user<>'epdg_synthetic_operator'
    OR to_regprocedure('synthetic_handoff.guard_event()') IS NULL THEN
    RAISE EXCEPTION 'Reviewed local synthetic handoff schema required' USING ERRCODE='23514';
  END IF;
END;
$local_guard$;

CREATE OR REPLACE FUNCTION synthetic_handoff.guard_event() RETURNS trigger
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
  IF NOT FOUND OR EXISTS(
    SELECT 1 FROM synthetic_handoff.events event WHERE event.mapping_id=NEW.mapping_id AND event.decision_version>=NEW.decision_version)
    OR NEW.issued_at<clock_timestamp()-interval '300 seconds' OR NEW.issued_at>clock_timestamp()+interval '30 seconds' THEN
    RAISE EXCEPTION 'Current preconfigured clearance decision required' USING ERRCODE='23514';
  END IF;
  NEW.received_at=clock_timestamp(); RETURN NEW;
END;
$$;
