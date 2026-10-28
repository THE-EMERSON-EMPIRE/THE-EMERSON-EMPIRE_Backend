-- Forward-only local synthetic text submission extension. No production objects.
CREATE TABLE synthetic_learning.assignment_drafts (
  enrollment_id uuid NOT NULL,
  program_id uuid NOT NULL,
  item_id uuid NOT NULL,
  answer text NOT NULL CHECK (char_length(answer) <= 4000 AND octet_length(answer) <= 12000),
  revision integer NOT NULL CHECK (revision > 0),
  saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (enrollment_id, item_id),
  FOREIGN KEY (enrollment_id, program_id) REFERENCES synthetic_learning.enrollments(id, program_id),
  FOREIGN KEY (item_id, program_id) REFERENCES synthetic_learning.items(id, program_id)
);
CREATE INDEX synthetic_assignment_draft_item ON synthetic_learning.assignment_drafts(item_id, program_id);
CREATE TABLE synthetic_learning.assignment_receipts (
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  enrollment_id uuid NOT NULL,
  program_id uuid NOT NULL,
  item_id uuid NOT NULL,
  answer text NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 4000 AND octet_length(answer) <= 12000),
  revision integer NOT NULL CHECK (revision > 0),
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (enrollment_id, item_id),
  FOREIGN KEY (enrollment_id, item_id) REFERENCES synthetic_learning.assignment_drafts(enrollment_id, item_id),
  FOREIGN KEY (enrollment_id, program_id) REFERENCES synthetic_learning.enrollments(id, program_id),
  FOREIGN KEY (item_id, program_id) REFERENCES synthetic_learning.items(id, program_id)
);
CREATE INDEX synthetic_assignment_receipt_item ON synthetic_learning.assignment_receipts(item_id, program_id);

-- Invoker functions cannot activate accounts, edit content or bypass grants.
-- The same transaction lock covers insert/update/submit even when no draft exists.
CREATE FUNCTION synthetic_learning.guard_assignment_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.enrollment_id::text || ':' || NEW.item_id::text, 0));
  IF EXISTS (SELECT 1 FROM synthetic_learning.assignment_receipts r
    WHERE r.enrollment_id=NEW.enrollment_id AND r.item_id=NEW.item_id) THEN
    RAISE EXCEPTION 'Submitted assignment is immutable' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM synthetic_learning.items i WHERE i.id=NEW.item_id
    AND i.program_id=NEW.program_id AND i.kind='assignment') THEN
    RAISE EXCEPTION 'Assignment required' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' AND NEW.revision<>1 THEN
    RAISE EXCEPTION 'Invalid draft revision' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
    OR NEW.program_id IS DISTINCT FROM OLD.program_id OR NEW.item_id IS DISTINCT FROM OLD.item_id
    OR NEW.revision::bigint<>OLD.revision::bigint+1) THEN
    RAISE EXCEPTION 'Invalid draft revision' USING ERRCODE='23514';
  END IF;
  NEW.saved_at=clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_draft_guard BEFORE INSERT OR UPDATE ON synthetic_learning.assignment_drafts
FOR EACH ROW EXECUTE FUNCTION synthetic_learning.guard_assignment_draft();
CREATE FUNCTION synthetic_learning.guard_assignment_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE draft synthetic_learning.assignment_drafts%ROWTYPE;
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'Submitted assignment is immutable' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.enrollment_id::text || ':' || NEW.item_id::text, 0));
  SELECT * INTO draft FROM synthetic_learning.assignment_drafts d
    WHERE d.enrollment_id=NEW.enrollment_id AND d.item_id=NEW.item_id FOR UPDATE;
  IF NOT FOUND OR draft.program_id<>NEW.program_id OR draft.revision<>NEW.revision OR draft.answer<>NEW.answer THEN
    RAISE EXCEPTION 'Saved draft required' USING ERRCODE='23514';
  END IF;
  NEW.submitted_at=clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON synthetic_learning.assignment_receipts
FOR EACH ROW EXECUTE FUNCTION synthetic_learning.guard_assignment_receipt();
REVOKE ALL ON FUNCTION synthetic_learning.guard_assignment_draft() FROM PUBLIC;
REVOKE ALL ON FUNCTION synthetic_learning.guard_assignment_receipt() FROM PUBLIC;
ALTER TABLE synthetic_learning.assignment_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE synthetic_learning.assignment_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON synthetic_learning.assignment_drafts, synthetic_learning.assignment_receipts FROM PUBLIC;

-- Update only the three reviewed local prompts, preserving any altered fixture.
UPDATE synthetic_learning.items SET description='Write a fictional reflection, save a draft, then submit it once.',
  content='SYNTHETIC ASSIGNMENT\nUsing an invented situation, describe how you would communicate a changed deadline. Include the audience, the message, and one question to confirm understanding.\nUse fictional text only. Submitted answers are final. No uploads, grading, awards or lesson progress are created.'
WHERE id='30000000-0000-4000-8000-000000000004' AND kind='assignment'
  AND description='Read the fictional reflection prompt. Submission is unavailable in this milestone.';
UPDATE synthetic_learning.items SET description='Write a fictional action plan, save a draft, then submit it once.',
  content='SYNTHETIC ASSIGNMENT\nPrepare an imaginary action plan with a goal, a first step, and a review date.\nUse fictional text only. Submitted answers are final. No documents, grading or real personal information.'
WHERE id='30000000-0000-4000-8000-000000000007' AND kind='assignment'
  AND description='Review the practice brief; submissions stay closed.';
UPDATE synthetic_learning.items SET description='Write a fictional School B reflection, save a draft, then submit it once.',
  content='SYNTHETIC SCHOOL B ASSIGNMENT\nDescribe an imaginary work routine using fictional text only. Save a draft, then submit it once. Submitted answers are final. No files, grading or awards.'
WHERE id='30000000-0000-4000-8000-000000000010' AND kind='assignment'
  AND description='Read-only School B assignment used to verify closed submission controls.';
