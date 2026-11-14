-- Portable education candidate, translated from learning migrations 001/002/004/005/006.
-- Preserves the existing workflow, constraints, immutable receipts and authorship.
-- Creates NEW tables only. No synthetic content or historic records are copied.
-- Run once through the checksum-aware manual migrator, after accounts/access.
-- The sole DROP CONSTRAINT below replaces a primary key created in THIS file;
-- it never touches a pre-existing schema or an existing learner record.
DO $boundary$
DECLARE runtime_name text:=current_setting('epdg.access_runtime_role',true);
BEGIN
 IF current_setting('epdg.access_migrator_role',true) IS DISTINCT FROM current_user
   OR runtime_name IS NULL OR runtime_name=current_user
   OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=runtime_name AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb)
   OR to_regclass('portal_accounts.provisioning_plans') IS NULL OR to_regclass('portal_access.groups') IS NULL
   OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname='portal_learning') THEN
   RAISE EXCEPTION 'Reviewed migrator, restricted runtime, clean target and account prerequisites required';
 END IF;
END;
$boundary$;

CREATE SCHEMA portal_learning;
REVOKE ALL ON SCHEMA portal_learning FROM PUBLIC;

CREATE TABLE portal_learning.schema_migrations (
  version text PRIMARY KEY,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE portal_learning.programs (
  id uuid PRIMARY KEY,
  organization_id integer NOT NULL REFERENCES epdg.companies(id),
  access_group_id uuid NOT NULL,
  FOREIGN KEY(access_group_id, organization_id) REFERENCES portal_access.groups(id,organization_id),
  title text NOT NULL CHECK (length(btrim(title)) BETWEEN 1 AND 160),
  summary text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  UNIQUE (id, organization_id)
);
CREATE INDEX portal_learning_program_school ON portal_learning.programs(organization_id);
CREATE TABLE portal_learning.enrollments (
  id uuid PRIMARY KEY,
  program_id uuid NOT NULL,
  user_id integer NOT NULL REFERENCES core.users(id),
  organization_id integer NOT NULL,
  membership_id uuid NOT NULL REFERENCES portal_security.memberships(id),
  active boolean NOT NULL DEFAULT false,
  onboarding_plan_id uuid NOT NULL REFERENCES portal_accounts.provisioning_plans(id),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY (program_id, organization_id) REFERENCES portal_learning.programs(id, organization_id),
  UNIQUE (user_id, program_id),
  UNIQUE (id, program_id)
);
CREATE INDEX portal_learning_enrollment_scope ON portal_learning.enrollments(user_id, membership_id) WHERE active;
CREATE INDEX portal_learning_enrollment_program ON portal_learning.enrollments(program_id);
CREATE INDEX portal_learning_enrollment_membership ON portal_learning.enrollments(membership_id);
CREATE TABLE portal_learning.items (
  id uuid PRIMARY KEY,
  program_id uuid NOT NULL REFERENCES portal_learning.programs(id),
  position integer NOT NULL CHECK (position > 0),
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('lesson', 'assignment')),
  description text NOT NULL,
  content text NOT NULL,
  due_at timestamptz,
  UNIQUE (id, program_id),
  UNIQUE (program_id, position)
);
CREATE TABLE portal_learning.completions (
  enrollment_id uuid NOT NULL,
  program_id uuid NOT NULL,
  item_id uuid NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (enrollment_id, item_id),
  FOREIGN KEY (enrollment_id, program_id) REFERENCES portal_learning.enrollments(id, program_id),
  FOREIGN KEY (item_id, program_id) REFERENCES portal_learning.items(id, program_id)
);
CREATE INDEX portal_learning_completion_item ON portal_learning.completions(item_id, program_id);
CREATE TABLE portal_learning.feedback (
  id uuid PRIMARY KEY,
  enrollment_id uuid NOT NULL REFERENCES portal_learning.enrollments(id),
  title text NOT NULL,
  comment text NOT NULL,
  mentor_label text NOT NULL CHECK (length(btrim(mentor_label)) BETWEEN 1 AND 160),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX portal_learning_feedback_enrollment ON portal_learning.feedback(enrollment_id, created_at DESC);
CREATE TABLE portal_learning.resources (
  id uuid PRIMARY KEY,
  program_id uuid NOT NULL REFERENCES portal_learning.programs(id),
  title text NOT NULL,
  description text NOT NULL,
  body text NOT NULL
);
CREATE INDEX portal_learning_resource_program ON portal_learning.resources(program_id);

ALTER TABLE portal_learning.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_learning.programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_learning.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_learning.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_learning.completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_learning.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_learning.resources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA portal_learning FROM PUBLIC;
CREATE TABLE portal_learning.assignment_drafts (
  enrollment_id uuid NOT NULL,
  program_id uuid NOT NULL,
  item_id uuid NOT NULL,
  answer text NOT NULL CHECK (char_length(answer) <= 4000 AND octet_length(answer) <= 12000),
  revision integer NOT NULL CHECK (revision > 0),
  saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (enrollment_id, item_id),
  FOREIGN KEY (enrollment_id, program_id) REFERENCES portal_learning.enrollments(id, program_id),
  FOREIGN KEY (item_id, program_id) REFERENCES portal_learning.items(id, program_id)
);
CREATE INDEX synthetic_assignment_draft_item ON portal_learning.assignment_drafts(item_id, program_id);
CREATE TABLE portal_learning.assignment_receipts (
  id uuid NOT NULL DEFAULT gen_random_uuid() UNIQUE,
  enrollment_id uuid NOT NULL,
  program_id uuid NOT NULL,
  item_id uuid NOT NULL,
  answer text NOT NULL CHECK (char_length(answer) BETWEEN 1 AND 4000 AND octet_length(answer) <= 12000),
  revision integer NOT NULL CHECK (revision > 0),
  submitted_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (enrollment_id, item_id),
  FOREIGN KEY (enrollment_id, item_id) REFERENCES portal_learning.assignment_drafts(enrollment_id, item_id),
  FOREIGN KEY (enrollment_id, program_id) REFERENCES portal_learning.enrollments(id, program_id),
  FOREIGN KEY (item_id, program_id) REFERENCES portal_learning.items(id, program_id)
);
CREATE INDEX synthetic_assignment_receipt_item ON portal_learning.assignment_receipts(item_id, program_id);

CREATE FUNCTION portal_learning.guard_assignment_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.enrollment_id::text || ':' || NEW.item_id::text, 0));
  IF EXISTS (SELECT 1 FROM portal_learning.assignment_receipts r
    WHERE r.enrollment_id=NEW.enrollment_id AND r.item_id=NEW.item_id) THEN
    RAISE EXCEPTION 'Submitted assignment is immutable' USING ERRCODE='23514';
  END IF;
  IF NOT EXISTS (SELECT 1 FROM portal_learning.items i WHERE i.id=NEW.item_id
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
CREATE TRIGGER assignment_draft_guard BEFORE INSERT OR UPDATE ON portal_learning.assignment_drafts
FOR EACH ROW EXECUTE FUNCTION portal_learning.guard_assignment_draft();
CREATE FUNCTION portal_learning.guard_assignment_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE draft portal_learning.assignment_drafts%ROWTYPE;
BEGIN
  IF TG_OP<>'INSERT' THEN
    RAISE EXCEPTION 'Submitted assignment is immutable' USING ERRCODE='23514';
  END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.enrollment_id::text || ':' || NEW.item_id::text, 0));
  SELECT * INTO draft FROM portal_learning.assignment_drafts d
    WHERE d.enrollment_id=NEW.enrollment_id AND d.item_id=NEW.item_id FOR UPDATE;
  IF NOT FOUND OR draft.program_id<>NEW.program_id OR draft.revision<>NEW.revision OR draft.answer<>NEW.answer THEN
    RAISE EXCEPTION 'Saved draft required' USING ERRCODE='23514';
  END IF;
  NEW.submitted_at=clock_timestamp();
  RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_receipt_guard BEFORE INSERT OR UPDATE OR DELETE ON portal_learning.assignment_receipts
FOR EACH ROW EXECUTE FUNCTION portal_learning.guard_assignment_receipt();
REVOKE ALL ON FUNCTION portal_learning.guard_assignment_draft() FROM PUBLIC;
REVOKE ALL ON FUNCTION portal_learning.guard_assignment_receipt() FROM PUBLIC;
ALTER TABLE portal_learning.assignment_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_learning.assignment_receipts ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal_learning.assignment_drafts, portal_learning.assignment_receipts FROM PUBLIC;

CREATE TABLE portal_learning.assignment_attachments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  enrollment_id uuid NOT NULL,
  program_id uuid NOT NULL,
  item_id uuid NOT NULL,
  filename text NOT NULL CHECK (octet_length(filename) BETWEEN 5 AND 100
    AND filename ~* '^[A-Za-z0-9][A-Za-z0-9 ._-]*\.(txt|pdf|png|jpg|jpeg)$'
    AND position('..' in filename)=0),
  media_type text NOT NULL CHECK (media_type IN ('text/plain','application/pdf','image/png','image/jpeg')),
  bytes bytea NOT NULL CHECK (octet_length(bytes) BETWEEN 1 AND 1048576),
  size_bytes integer GENERATED ALWAYS AS (octet_length(bytes)) STORED,
  sha256 text GENERATED ALWAYS AS (encode(sha256(bytes),'hex')) STORED,
  uploaded_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  removed boolean NOT NULL DEFAULT false,
  FOREIGN KEY (enrollment_id,item_id) REFERENCES portal_learning.assignment_drafts(enrollment_id,item_id),
  FOREIGN KEY (enrollment_id,program_id) REFERENCES portal_learning.enrollments(id,program_id),
  FOREIGN KEY (item_id,program_id) REFERENCES portal_learning.items(id,program_id),
  CHECK (CASE lower(substring(filename from '\.([^.]+)$'))
    WHEN 'txt' THEN media_type='text/plain' WHEN 'pdf' THEN media_type='application/pdf'
    WHEN 'png' THEN media_type='image/png' WHEN 'jpg' THEN media_type='image/jpeg'
    WHEN 'jpeg' THEN media_type='image/jpeg' ELSE false END)
);
CREATE INDEX synthetic_assignment_attachment_scope ON portal_learning.assignment_attachments(enrollment_id,item_id,uploaded_at,id);
CREATE INDEX synthetic_assignment_attachment_item ON portal_learning.assignment_attachments(item_id,program_id);
ALTER TABLE portal_learning.assignment_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal_learning.assignment_attachments FROM PUBLIC;
ALTER TABLE portal_learning.assignment_receipts ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(attachments)='array' AND jsonb_array_length(attachments)<=3);

CREATE FUNCTION portal_learning.guard_assignment_attachment() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE active_count integer; lifetime_count integer; draft_revision integer; text_value text;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Attachment records are retained' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.enrollment_id::text||':'||NEW.item_id::text,0));
  IF EXISTS(SELECT 1 FROM portal_learning.assignment_receipts r
    WHERE r.enrollment_id=NEW.enrollment_id AND r.item_id=NEW.item_id) THEN
    RAISE EXCEPTION 'Submitted assignment is immutable' USING ERRCODE='23514';
  END IF;
  SELECT d.revision INTO draft_revision FROM portal_learning.assignment_drafts d
    WHERE d.enrollment_id=NEW.enrollment_id AND d.item_id=NEW.item_id AND d.program_id=NEW.program_id FOR UPDATE;
  IF NOT FOUND OR draft_revision=2147483647 THEN
    RAISE EXCEPTION 'Writable saved draft required' USING ERRCODE='23514';
  END IF;
  IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
    OR NEW.program_id IS DISTINCT FROM OLD.program_id OR NEW.item_id IS DISTINCT FROM OLD.item_id
    OR NEW.filename IS DISTINCT FROM OLD.filename OR NEW.media_type IS DISTINCT FROM OLD.media_type
    OR NEW.bytes IS DISTINCT FROM OLD.bytes OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at
    OR NEW.removed IS NOT DISTINCT FROM OLD.removed) THEN
    RAISE EXCEPTION 'Attachment bytes and metadata are immutable' USING ERRCODE='23514';
  END IF;
  SELECT count(*) FILTER(WHERE NOT a.removed),count(*) INTO active_count,lifetime_count
    FROM portal_learning.assignment_attachments a WHERE a.enrollment_id=NEW.enrollment_id AND a.item_id=NEW.item_id;
  IF (TG_OP='INSERT' AND lifetime_count>=6) OR ((TG_OP='INSERT' OR NOT NEW.removed) AND active_count>=3) THEN
    RAISE EXCEPTION 'Attachment count limit reached' USING ERRCODE='23514';
  END IF;
  IF TG_OP='INSERT' THEN
    NEW.removed=false; NEW.uploaded_at=clock_timestamp();
    IF NEW.media_type='text/plain' THEN
      BEGIN text_value=convert_from(NEW.bytes,'UTF8');
      EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid plain text attachment' USING ERRCODE='23514'; END;
      IF regexp_replace(text_value,E'[\t\r\n]','','g') ~ '[[:cntrl:]]' OR text_value ~ U&'[\007F-\009F]' OR
        text_value ~* '^\s*(%PDF-|<(!doctype[[:space:]]+html|html|head|body|script|svg|iframe|object|embed|meta|link|style)([[:space:]>])|<\?xml)' THEN
        RAISE EXCEPTION 'Invalid plain text attachment' USING ERRCODE='23514';
      END IF;
    ELSIF NEW.media_type='application/pdf' AND (substring(NEW.bytes from 1 for 5)<>convert_to('%PDF-','UTF8') OR
      position(convert_to('%%EOF','UTF8') in substring(NEW.bytes from greatest(1,octet_length(NEW.bytes)-1024)))=0) THEN
      RAISE EXCEPTION 'Invalid PDF signature' USING ERRCODE='23514';
    ELSIF NEW.media_type='image/png' AND (substring(NEW.bytes from 1 for 8)<>decode('89504e470d0a1a0a','hex') OR
      substring(NEW.bytes from greatest(1,octet_length(NEW.bytes)-11))<>decode('0000000049454e44ae426082','hex')) THEN
      RAISE EXCEPTION 'Invalid PNG signature' USING ERRCODE='23514';
    ELSIF NEW.media_type='image/jpeg' AND (substring(NEW.bytes from 1 for 3)<>decode('ffd8ff','hex') OR
      substring(NEW.bytes from greatest(1,octet_length(NEW.bytes)-1))<>decode('ffd9','hex')) THEN
      RAISE EXCEPTION 'Invalid JPEG signature' USING ERRCODE='23514';
    END IF;
  END IF;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_attachment_guard BEFORE INSERT OR UPDATE OR DELETE ON portal_learning.assignment_attachments
FOR EACH ROW EXECUTE FUNCTION portal_learning.guard_assignment_attachment();
CREATE FUNCTION portal_learning.revise_assignment_attachment() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  UPDATE portal_learning.assignment_drafts SET revision=revision+1
    WHERE enrollment_id=NEW.enrollment_id AND item_id=NEW.item_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_attachment_revision AFTER INSERT OR UPDATE ON portal_learning.assignment_attachments
FOR EACH ROW EXECUTE FUNCTION portal_learning.revise_assignment_attachment();
REVOKE ALL ON FUNCTION portal_learning.guard_assignment_attachment() FROM PUBLIC;
REVOKE ALL ON FUNCTION portal_learning.revise_assignment_attachment() FROM PUBLIC;

CREATE OR REPLACE FUNCTION portal_learning.guard_assignment_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE draft portal_learning.assignment_drafts%ROWTYPE;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Submitted assignment is immutable' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.enrollment_id::text||':'||NEW.item_id::text,0));
  SELECT * INTO draft FROM portal_learning.assignment_drafts d
    WHERE d.enrollment_id=NEW.enrollment_id AND d.item_id=NEW.item_id FOR UPDATE;
  IF NOT FOUND OR draft.program_id<>NEW.program_id OR draft.revision<>NEW.revision OR draft.answer<>NEW.answer THEN
    RAISE EXCEPTION 'Saved draft required' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'filename',a.filename,'media_type',a.media_type,
    'size_bytes',a.size_bytes,'sha256',a.sha256,'uploaded_at',a.uploaded_at) ORDER BY a.uploaded_at,a.id),'[]'::jsonb)
    INTO NEW.attachments FROM portal_learning.assignment_attachments a
    WHERE a.enrollment_id=NEW.enrollment_id AND a.item_id=NEW.item_id AND NOT a.removed;
  NEW.submitted_at=clock_timestamp();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION portal_learning.guard_assignment_receipt() FROM PUBLIC;

CREATE TABLE portal_learning.mentor_assignments (
  id uuid PRIMARY KEY,
  mentor_user_id integer NOT NULL REFERENCES core.users(id),
  membership_id uuid NOT NULL REFERENCES portal_security.memberships(id),
  enrollment_id uuid NOT NULL REFERENCES portal_learning.enrollments(id),
  organization_id integer NOT NULL REFERENCES epdg.companies(id),
  active boolean NOT NULL DEFAULT false,
  mentor_label text NOT NULL CHECK (length(btrim(mentor_label)) BETWEEN 1 AND 160),
  UNIQUE(mentor_user_id,enrollment_id)
);
CREATE INDEX synthetic_mentor_assignment_membership ON portal_learning.mentor_assignments(membership_id);
CREATE INDEX synthetic_mentor_assignment_enrollment ON portal_learning.mentor_assignments(enrollment_id);
CREATE INDEX synthetic_mentor_assignment_school ON portal_learning.mentor_assignments(organization_id);
CREATE TABLE portal_learning.mentor_review_drafts (
  assignment_id uuid NOT NULL REFERENCES portal_learning.mentor_assignments(id),
  receipt_id uuid NOT NULL REFERENCES portal_learning.assignment_receipts(id),
  comment text NOT NULL CHECK (char_length(comment)<=4000 AND octet_length(comment)<=12000),
  revision integer NOT NULL CHECK (revision>0),
  saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(assignment_id,receipt_id)
);
CREATE INDEX synthetic_mentor_review_draft_receipt ON portal_learning.mentor_review_drafts(receipt_id);
CREATE TABLE portal_learning.mentor_review_feedback (
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  comment text NOT NULL CHECK (char_length(comment) BETWEEN 1 AND 4000 AND octet_length(comment)<=12000),
  revision integer NOT NULL CHECK (revision>0),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  mentor_label text NOT NULL,
  PRIMARY KEY(assignment_id,receipt_id),
  FOREIGN KEY(assignment_id,receipt_id) REFERENCES portal_learning.mentor_review_drafts(assignment_id,receipt_id)
);
CREATE INDEX synthetic_mentor_review_feedback_receipt ON portal_learning.mentor_review_feedback(receipt_id,published_at);
ALTER TABLE portal_learning.mentor_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_learning.mentor_review_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_learning.mentor_review_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal_learning.mentor_assignments,portal_learning.mentor_review_drafts,portal_learning.mentor_review_feedback FROM PUBLIC;



CREATE FUNCTION portal_learning.guard_mentor_review_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Mentor review drafts are retained' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('mentor-mapping:'||NEW.assignment_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('mentor-review:'||NEW.assignment_id::text||':'||NEW.receipt_id::text,0));
 IF NOT portal_learning.mentor_scope_allowed(NEW.assignment_id,NEW.receipt_id) THEN
  RAISE EXCEPTION 'Current mentor review scope required' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM portal_learning.mentor_review_feedback f WHERE f.assignment_id=NEW.assignment_id AND f.receipt_id=NEW.receipt_id) THEN
  RAISE EXCEPTION 'Published feedback is immutable' USING ERRCODE='23514';
 END IF;
 IF (TG_OP='INSERT' AND NEW.revision<>1) OR (TG_OP='UPDATE' AND
  (NEW.assignment_id IS DISTINCT FROM OLD.assignment_id OR NEW.receipt_id IS DISTINCT FROM OLD.receipt_id
   OR NEW.revision::bigint<>OLD.revision::bigint+1)) THEN
  RAISE EXCEPTION 'Invalid review revision' USING ERRCODE='23514';
 END IF;
 NEW.saved_at=clock_timestamp(); RETURN NEW;
END;
$$;
CREATE TRIGGER mentor_review_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON portal_learning.mentor_review_drafts
FOR EACH ROW EXECUTE FUNCTION portal_learning.guard_mentor_review_draft();

CREATE FUNCTION portal_learning.guard_mentor_feedback() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE draft portal_learning.mentor_review_drafts%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Published feedback is immutable' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('mentor-mapping:'||NEW.assignment_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('mentor-review:'||NEW.assignment_id::text||':'||NEW.receipt_id::text,0));
 IF NOT portal_learning.mentor_scope_allowed(NEW.assignment_id,NEW.receipt_id) THEN
  RAISE EXCEPTION 'Current mentor review scope required' USING ERRCODE='23514';
 END IF;
 SELECT * INTO draft FROM portal_learning.mentor_review_drafts d
  WHERE d.assignment_id=NEW.assignment_id AND d.receipt_id=NEW.receipt_id FOR UPDATE;
 IF NOT FOUND OR draft.revision<>NEW.revision OR draft.comment<>NEW.comment OR
  btrim(NEW.comment,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')='' THEN
  RAISE EXCEPTION 'Saved nonblank review draft required' USING ERRCODE='23514';
 END IF;
 SELECT mentor_label INTO NEW.mentor_label FROM portal_learning.mentor_assignments WHERE id=NEW.assignment_id;
 NEW.published_at=clock_timestamp(); RETURN NEW;
END;
$$;
CREATE TRIGGER mentor_review_feedback_guard BEFORE INSERT OR UPDATE OR DELETE ON portal_learning.mentor_review_feedback
FOR EACH ROW EXECUTE FUNCTION portal_learning.guard_mentor_feedback();

REVOKE ALL ON FUNCTION portal_learning.guard_mentor_review_draft() FROM PUBLIC;
REVOKE ALL ON FUNCTION portal_learning.guard_mentor_feedback() FROM PUBLIC;
ALTER TABLE portal_learning.assignment_drafts ADD COLUMN attempt_number integer NOT NULL DEFAULT 1 CHECK(attempt_number BETWEEN 1 AND 5);
ALTER TABLE portal_learning.assignment_drafts ADD COLUMN previous_receipt_id uuid REFERENCES portal_learning.assignment_receipts(id);
ALTER TABLE portal_learning.assignment_drafts ADD CONSTRAINT synthetic_draft_attempt_parent CHECK
 ((attempt_number=1 AND previous_receipt_id IS NULL) OR (attempt_number>1 AND previous_receipt_id IS NOT NULL));
ALTER TABLE portal_learning.assignment_receipts ADD COLUMN attempt_number integer NOT NULL DEFAULT 1 CHECK(attempt_number BETWEEN 1 AND 5);
ALTER TABLE portal_learning.assignment_receipts ADD COLUMN previous_receipt_id uuid REFERENCES portal_learning.assignment_receipts(id);
ALTER TABLE portal_learning.assignment_receipts ADD CONSTRAINT synthetic_receipt_attempt_parent CHECK
 ((attempt_number=1 AND previous_receipt_id IS NULL) OR (attempt_number>1 AND previous_receipt_id IS NOT NULL));
ALTER TABLE portal_learning.assignment_receipts DROP CONSTRAINT assignment_receipts_pkey;
ALTER TABLE portal_learning.assignment_receipts ADD PRIMARY KEY(enrollment_id,item_id,attempt_number);
ALTER TABLE portal_learning.assignment_attachments ADD COLUMN attempt_number integer NOT NULL DEFAULT 1 CHECK(attempt_number BETWEEN 1 AND 5);
CREATE INDEX synthetic_attachment_attempt_scope ON portal_learning.assignment_attachments(enrollment_id,item_id,attempt_number,uploaded_at,id);
CREATE INDEX synthetic_draft_previous_receipt ON portal_learning.assignment_drafts(previous_receipt_id);
CREATE INDEX synthetic_receipt_previous_receipt ON portal_learning.assignment_receipts(previous_receipt_id);

CREATE OR REPLACE FUNCTION portal_learning.guard_assignment_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE prior portal_learning.assignment_receipts%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.enrollment_id::text||':'||NEW.item_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM portal_learning.items i WHERE i.id=NEW.item_id AND i.program_id=NEW.program_id AND i.kind='assignment') THEN
  RAISE EXCEPTION 'Assignment required' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' THEN
  IF NEW.revision<>1 OR NEW.attempt_number<>1 OR NEW.previous_receipt_id IS NOT NULL THEN
   RAISE EXCEPTION 'Invalid initial draft' USING ERRCODE='23514';
  END IF;
 ELSE
  IF NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id OR NEW.program_id IS DISTINCT FROM OLD.program_id
   OR NEW.item_id IS DISTINCT FROM OLD.item_id OR NEW.revision::bigint<>OLD.revision::bigint+1 THEN
   RAISE EXCEPTION 'Invalid draft revision' USING ERRCODE='23514';
  END IF;
  IF NEW.attempt_number=OLD.attempt_number THEN
   IF NEW.previous_receipt_id IS DISTINCT FROM OLD.previous_receipt_id OR EXISTS(SELECT 1 FROM portal_learning.assignment_receipts r
    WHERE r.enrollment_id=NEW.enrollment_id AND r.item_id=NEW.item_id AND r.attempt_number=NEW.attempt_number) THEN
    RAISE EXCEPTION 'Submitted attempt is immutable' USING ERRCODE='23514';
   END IF;
  ELSIF NEW.attempt_number=OLD.attempt_number+1 AND OLD.attempt_number<5 THEN
   SELECT * INTO prior FROM portal_learning.assignment_receipts r
    WHERE r.enrollment_id=OLD.enrollment_id AND r.item_id=OLD.item_id AND r.attempt_number=OLD.attempt_number;
   IF NOT FOUND OR prior.id IS DISTINCT FROM NEW.previous_receipt_id OR NOT EXISTS
    (SELECT 1 FROM portal_learning.mentor_review_feedback f WHERE f.receipt_id=prior.id) THEN
    RAISE EXCEPTION 'Published feedback on the latest receipt is required' USING ERRCODE='23514';
   END IF;
   IF NOT portal_learning.enrollment_allowed(NEW.enrollment_id) THEN
    RAISE EXCEPTION 'Current verified learner enrollment is required' USING ERRCODE='23514';
   END IF;
   NEW.answer=prior.answer;
  ELSE
   RAISE EXCEPTION 'Invalid or exhausted attempt chain' USING ERRCODE='23514';
  END IF;
 END IF;
 NEW.saved_at=clock_timestamp(); RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION portal_learning.guard_assignment_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE draft portal_learning.assignment_drafts%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Submitted assignment is immutable' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.enrollment_id::text||':'||NEW.item_id::text,0));
 SELECT * INTO draft FROM portal_learning.assignment_drafts d
  WHERE d.enrollment_id=NEW.enrollment_id AND d.item_id=NEW.item_id FOR UPDATE;
 IF NOT FOUND OR draft.program_id<>NEW.program_id OR draft.revision<>NEW.revision OR draft.answer<>NEW.answer OR
  btrim(NEW.answer,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')='' THEN
  RAISE EXCEPTION 'Saved nonblank draft required' USING ERRCODE='23514';
 END IF;
 NEW.attempt_number=draft.attempt_number; NEW.previous_receipt_id=draft.previous_receipt_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'filename',a.filename,'media_type',a.media_type,
  'size_bytes',a.size_bytes,'sha256',a.sha256,'uploaded_at',a.uploaded_at) ORDER BY a.uploaded_at,a.id),'[]'::jsonb)
  INTO NEW.attachments FROM portal_learning.assignment_attachments a
  WHERE a.enrollment_id=NEW.enrollment_id AND a.item_id=NEW.item_id AND a.attempt_number=draft.attempt_number AND NOT a.removed;
 NEW.submitted_at=clock_timestamp(); RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION portal_learning.guard_assignment_attachment() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE active_count integer; lifetime_count integer; draft_revision integer; current_attempt integer; text_value text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Attachment records are retained' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.enrollment_id::text||':'||NEW.item_id::text,0));
 SELECT d.revision,d.attempt_number INTO draft_revision,current_attempt FROM portal_learning.assignment_drafts d
  WHERE d.enrollment_id=NEW.enrollment_id AND d.item_id=NEW.item_id AND d.program_id=NEW.program_id FOR UPDATE;
 IF NOT FOUND OR draft_revision=2147483647 THEN RAISE EXCEPTION 'Writable saved draft required' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM portal_learning.assignment_receipts r WHERE r.enrollment_id=NEW.enrollment_id
  AND r.item_id=NEW.item_id AND r.attempt_number=current_attempt) THEN
  RAISE EXCEPTION 'Submitted attempt is immutable' USING ERRCODE='23514';
 END IF;
 IF TG_OP='UPDATE' AND (OLD.attempt_number<>current_attempt OR NEW.attempt_number IS DISTINCT FROM OLD.attempt_number
  OR NEW.id IS DISTINCT FROM OLD.id OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
  OR NEW.program_id IS DISTINCT FROM OLD.program_id OR NEW.item_id IS DISTINCT FROM OLD.item_id
  OR NEW.filename IS DISTINCT FROM OLD.filename OR NEW.media_type IS DISTINCT FROM OLD.media_type
  OR NEW.bytes IS DISTINCT FROM OLD.bytes OR NEW.uploaded_at IS DISTINCT FROM OLD.uploaded_at
  OR NEW.removed IS NOT DISTINCT FROM OLD.removed) THEN
  RAISE EXCEPTION 'Attachment attempt and bytes are immutable' USING ERRCODE='23514';
 END IF;
 NEW.attempt_number=current_attempt;
 SELECT count(*) FILTER(WHERE NOT a.removed),count(*) INTO active_count,lifetime_count FROM portal_learning.assignment_attachments a
  WHERE a.enrollment_id=NEW.enrollment_id AND a.item_id=NEW.item_id AND a.attempt_number=current_attempt;
 IF (TG_OP='INSERT' AND lifetime_count>=6) OR ((TG_OP='INSERT' OR NOT NEW.removed) AND active_count>=3) THEN
  RAISE EXCEPTION 'Attachment count limit reached' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' THEN
  NEW.removed=false; NEW.uploaded_at=clock_timestamp();
  IF NEW.media_type='text/plain' THEN
   BEGIN text_value=convert_from(NEW.bytes,'UTF8');
   EXCEPTION WHEN OTHERS THEN RAISE EXCEPTION 'Invalid plain text attachment' USING ERRCODE='23514'; END;
   IF regexp_replace(text_value,E'[\t\r\n]','','g') ~ '[[:cntrl:]]' OR text_value ~ U&'[\007F-\009F]' OR
    text_value ~* '^\s*(%PDF-|<(!doctype[[:space:]]+html|html|head|body|script|svg|iframe|object|embed|meta|link|style)([[:space:]>])|<\?xml)' THEN
    RAISE EXCEPTION 'Invalid plain text attachment' USING ERRCODE='23514';
   END IF;
  ELSIF NEW.media_type='application/pdf' AND (substring(NEW.bytes from 1 for 5)<>convert_to('%PDF-','UTF8') OR
   position(convert_to('%%EOF','UTF8') in substring(NEW.bytes from greatest(1,octet_length(NEW.bytes)-1024)))=0) THEN
   RAISE EXCEPTION 'Invalid PDF signature' USING ERRCODE='23514';
  ELSIF NEW.media_type='image/png' AND (substring(NEW.bytes from 1 for 8)<>decode('89504e470d0a1a0a','hex') OR
   substring(NEW.bytes from greatest(1,octet_length(NEW.bytes)-11))<>decode('0000000049454e44ae426082','hex')) THEN
   RAISE EXCEPTION 'Invalid PNG signature' USING ERRCODE='23514';
  ELSIF NEW.media_type='image/jpeg' AND (substring(NEW.bytes from 1 for 3)<>decode('ffd8ff','hex') OR
   substring(NEW.bytes from greatest(1,octet_length(NEW.bytes)-1))<>decode('ffd9','hex')) THEN
   RAISE EXCEPTION 'Invalid JPEG signature' USING ERRCODE='23514';
  END IF;
 END IF;
 RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION portal_learning.guard_assignment_draft() FROM PUBLIC;
REVOKE ALL ON FUNCTION portal_learning.guard_assignment_receipt() FROM PUBLIC;
REVOKE ALL ON FUNCTION portal_learning.guard_assignment_attachment() FROM PUBLIC;

-- Runtime identity is a transaction-local opaque session hash, not a caller user ID.
CREATE FUNCTION portal_learning.session_actor() RETURNS integer
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT s.user_id FROM portal_security.sessions s JOIN portal_security.account_states a ON a.user_id=s.user_id AND a.active
 JOIN core.users c ON c.id=a.user_id AND c.deleted_at IS NULL AND c.is_verified
 JOIN epdg.users e ON e.id=c.id AND e.deleted_at IS NULL AND e.is_verified AND lower(btrim(e.email))=lower(btrim(c.email)) AND e.rejection_reason IS NULL
 WHERE s.token_hash=current_setting('portal_learning.session_hash',true) AND s.revoked_at IS NULL
   AND s.expires_at>statement_timestamp() AND s.account_revision=a.revision
$$;

CREATE FUNCTION portal_learning.learner_eligible(enrollment uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM portal_learning.enrollments e
 JOIN portal_learning.programs p ON p.id=e.program_id AND p.organization_id=e.organization_id
 JOIN portal_security.memberships m ON m.id=e.membership_id AND m.user_id=e.user_id AND m.company_id=e.organization_id AND m.active
 JOIN portal_security.account_states a ON a.user_id=e.user_id AND a.active
 WHERE e.id=enrollment AND e.active
 AND portal_access.has_permission(e.user_id,'learning.participate','group',p.access_group_id::text)
 AND EXISTS(SELECT 1 FROM portal_accounts.provisioning_plans plan
   WHERE plan.id=e.onboarding_plan_id AND plan.user_id=e.user_id AND plan.organization_id=e.organization_id AND plan.status='provisioned'
     AND plan.onboarding_status='verified' AND plan.onboarding_verified_by IS NOT NULL
     AND length(btrim(plan.onboarding_evidence_ref))>=8 AND plan.approved_by IS NOT NULL
     AND plan.approved_hash=plan.payload_hash AND plan.approved_revision=plan.revision
     AND portal_accounts.plan_current(plan.id)))
$$;
CREATE FUNCTION portal_learning.enrollment_allowed(enrollment uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM portal_learning.enrollments e WHERE e.id=enrollment
  AND e.user_id=portal_learning.session_actor() AND portal_learning.learner_eligible(e.id))
$$;
CREATE FUNCTION portal_learning.mentor_enrollment_allowed(enrollment uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM portal_learning.mentor_assignments ma
 JOIN portal_learning.enrollments e ON e.id=ma.enrollment_id AND e.organization_id=ma.organization_id
 JOIN portal_learning.programs p ON p.id=e.program_id AND p.organization_id=e.organization_id
 JOIN portal_security.memberships m ON m.id=ma.membership_id AND m.user_id=ma.mentor_user_id AND m.company_id=ma.organization_id AND m.active
 WHERE ma.enrollment_id=enrollment AND ma.active AND ma.mentor_user_id=portal_learning.session_actor()
 AND portal_learning.learner_eligible(enrollment)
 AND portal_access.has_permission(ma.mentor_user_id,'learning.review','group',p.access_group_id::text))
$$;
CREATE FUNCTION portal_learning.mentor_scope_allowed(mapping uuid,receipt uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM portal_learning.mentor_assignments ma
 JOIN portal_learning.assignment_receipts r ON r.enrollment_id=ma.enrollment_id
 WHERE ma.id=mapping AND r.id=receipt AND ma.active AND ma.mentor_user_id=portal_learning.session_actor()
 AND portal_learning.mentor_enrollment_allowed(ma.enrollment_id))
$$;
CREATE FUNCTION portal_learning.enrollment_readable(enrollment uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT portal_learning.enrollment_allowed(enrollment) OR portal_learning.mentor_enrollment_allowed(enrollment)
$$;
CREATE FUNCTION portal_learning.program_readable(program uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM portal_learning.enrollments e WHERE e.program_id=program AND portal_learning.enrollment_readable(e.id))
$$;
CREATE FUNCTION portal_learning.receipt_readable(receipt uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path=pg_catalog AS $$
 SELECT EXISTS(SELECT 1 FROM portal_learning.assignment_receipts r WHERE r.id=receipt AND portal_learning.enrollment_readable(r.enrollment_id))
$$;
-- Every runtime SELECT/write is bounded at the database as well as in the service.
CREATE POLICY ledger_read ON portal_learning.schema_migrations FOR SELECT USING(true);
CREATE POLICY program_read ON portal_learning.programs FOR SELECT USING(portal_learning.program_readable(id));
CREATE POLICY enrollment_read ON portal_learning.enrollments FOR SELECT USING(portal_learning.enrollment_readable(id));
CREATE POLICY item_read ON portal_learning.items FOR SELECT USING(portal_learning.program_readable(program_id));
CREATE POLICY resource_read ON portal_learning.resources FOR SELECT USING(portal_learning.program_readable(program_id));
CREATE POLICY feedback_read ON portal_learning.feedback FOR SELECT USING(portal_learning.enrollment_allowed(enrollment_id));
CREATE POLICY completion_read ON portal_learning.completions FOR SELECT USING(portal_learning.enrollment_readable(enrollment_id));
CREATE POLICY completion_write ON portal_learning.completions FOR INSERT WITH CHECK(portal_learning.enrollment_allowed(enrollment_id)
 AND EXISTS(SELECT 1 FROM portal_learning.items i WHERE i.id=completions.item_id AND i.program_id=completions.program_id AND i.kind='lesson'));
CREATE POLICY draft_read ON portal_learning.assignment_drafts FOR SELECT USING(portal_learning.enrollment_allowed(enrollment_id));
CREATE POLICY draft_insert ON portal_learning.assignment_drafts FOR INSERT WITH CHECK(portal_learning.enrollment_allowed(enrollment_id));
CREATE POLICY draft_update ON portal_learning.assignment_drafts FOR UPDATE USING(portal_learning.enrollment_allowed(enrollment_id)) WITH CHECK(portal_learning.enrollment_allowed(enrollment_id));
CREATE POLICY receipt_read ON portal_learning.assignment_receipts FOR SELECT USING(portal_learning.enrollment_readable(enrollment_id));
CREATE POLICY receipt_insert ON portal_learning.assignment_receipts FOR INSERT WITH CHECK(portal_learning.enrollment_allowed(enrollment_id));
CREATE POLICY attachment_read ON portal_learning.assignment_attachments FOR SELECT USING(portal_learning.enrollment_allowed(enrollment_id)
 OR (portal_learning.mentor_enrollment_allowed(enrollment_id) AND NOT removed AND EXISTS(
  SELECT 1 FROM portal_learning.assignment_receipts r WHERE r.enrollment_id=assignment_attachments.enrollment_id
   AND r.item_id=assignment_attachments.item_id AND r.attempt_number=assignment_attachments.attempt_number
   AND r.attachments @> jsonb_build_array(jsonb_build_object('id',assignment_attachments.id)))));
CREATE POLICY attachment_insert ON portal_learning.assignment_attachments FOR INSERT WITH CHECK(portal_learning.enrollment_allowed(enrollment_id));
CREATE POLICY attachment_update ON portal_learning.assignment_attachments FOR UPDATE USING(portal_learning.enrollment_allowed(enrollment_id)) WITH CHECK(portal_learning.enrollment_allowed(enrollment_id));
CREATE POLICY mentor_mapping_read ON portal_learning.mentor_assignments FOR SELECT USING(mentor_user_id=portal_learning.session_actor() AND active AND portal_learning.mentor_enrollment_allowed(enrollment_id));
CREATE POLICY mentor_draft_read ON portal_learning.mentor_review_drafts FOR SELECT USING(portal_learning.mentor_scope_allowed(assignment_id,receipt_id));
CREATE POLICY mentor_draft_insert ON portal_learning.mentor_review_drafts FOR INSERT WITH CHECK(portal_learning.mentor_scope_allowed(assignment_id,receipt_id));
CREATE POLICY mentor_draft_update ON portal_learning.mentor_review_drafts FOR UPDATE USING(portal_learning.mentor_scope_allowed(assignment_id,receipt_id)) WITH CHECK(portal_learning.mentor_scope_allowed(assignment_id,receipt_id));
CREATE POLICY mentor_feedback_read ON portal_learning.mentor_review_feedback FOR SELECT USING(portal_learning.receipt_readable(receipt_id));
CREATE POLICY mentor_feedback_insert ON portal_learning.mentor_review_feedback FOR INSERT WITH CHECK(portal_learning.mentor_scope_allowed(assignment_id,receipt_id));

REVOKE ALL ON ALL FUNCTIONS IN SCHEMA portal_learning FROM PUBLIC;
DO $grants$
DECLARE role_name text:=current_setting('epdg.access_runtime_role');
BEGIN
 EXECUTE format('GRANT USAGE ON SCHEMA portal_learning TO %I',role_name);
 EXECUTE format('GRANT SELECT ON ALL TABLES IN SCHEMA portal_learning TO %I',role_name);
 EXECUTE format('GRANT INSERT(enrollment_id,program_id,item_id) ON portal_learning.completions TO %I',role_name);
 EXECUTE format('GRANT INSERT(enrollment_id,program_id,item_id,answer,revision) ON portal_learning.assignment_drafts,portal_learning.assignment_receipts TO %I',role_name);
 EXECUTE format('GRANT UPDATE(answer,revision,attempt_number,previous_receipt_id) ON portal_learning.assignment_drafts TO %I',role_name);
 EXECUTE format('GRANT INSERT(enrollment_id,program_id,item_id,filename,media_type,bytes) ON portal_learning.assignment_attachments TO %I',role_name);
 EXECUTE format('GRANT UPDATE(removed) ON portal_learning.assignment_attachments TO %I',role_name);
 EXECUTE format('GRANT INSERT(assignment_id,receipt_id,comment,revision) ON portal_learning.mentor_review_drafts,portal_learning.mentor_review_feedback TO %I',role_name);
 EXECUTE format('GRANT UPDATE(comment,revision) ON portal_learning.mentor_review_drafts TO %I',role_name);
 EXECUTE format('GRANT EXECUTE ON FUNCTION portal_learning.session_actor(),portal_learning.enrollment_allowed(uuid),portal_learning.mentor_enrollment_allowed(uuid),portal_learning.mentor_scope_allowed(uuid,uuid),portal_learning.enrollment_readable(uuid),portal_learning.program_readable(uuid),portal_learning.receipt_readable(uuid) TO %I',role_name);
END;
$grants$;
