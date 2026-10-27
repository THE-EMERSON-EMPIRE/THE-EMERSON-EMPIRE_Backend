-- Local synthetic only: private bounded BYTEA files; no cloud/public storage.
CREATE TABLE synthetic_learning.assignment_attachments (
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
  FOREIGN KEY (enrollment_id,item_id) REFERENCES synthetic_learning.assignment_drafts(enrollment_id,item_id),
  FOREIGN KEY (enrollment_id,program_id) REFERENCES synthetic_learning.enrollments(id,program_id),
  FOREIGN KEY (item_id,program_id) REFERENCES synthetic_learning.items(id,program_id),
  CHECK (CASE lower(substring(filename from '\.([^.]+)$'))
    WHEN 'txt' THEN media_type='text/plain' WHEN 'pdf' THEN media_type='application/pdf'
    WHEN 'png' THEN media_type='image/png' WHEN 'jpg' THEN media_type='image/jpeg'
    WHEN 'jpeg' THEN media_type='image/jpeg' ELSE false END)
);
CREATE INDEX synthetic_assignment_attachment_scope ON synthetic_learning.assignment_attachments(enrollment_id,item_id,uploaded_at,id);
CREATE INDEX synthetic_assignment_attachment_item ON synthetic_learning.assignment_attachments(item_id,program_id);
ALTER TABLE synthetic_learning.assignment_attachments ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON synthetic_learning.assignment_attachments FROM PUBLIC;
ALTER TABLE synthetic_learning.assignment_receipts ADD COLUMN attachments jsonb NOT NULL DEFAULT '[]'::jsonb
  CHECK (jsonb_typeof(attachments)='array' AND jsonb_array_length(attachments)<=3);

CREATE FUNCTION synthetic_learning.guard_assignment_attachment() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE active_count integer; lifetime_count integer; draft_revision integer; text_value text;
BEGIN
  IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Attachment records are retained' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.enrollment_id::text||':'||NEW.item_id::text,0));
  IF EXISTS(SELECT 1 FROM synthetic_learning.assignment_receipts r
    WHERE r.enrollment_id=NEW.enrollment_id AND r.item_id=NEW.item_id) THEN
    RAISE EXCEPTION 'Submitted assignment is immutable' USING ERRCODE='23514';
  END IF;
  SELECT d.revision INTO draft_revision FROM synthetic_learning.assignment_drafts d
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
    FROM synthetic_learning.assignment_attachments a WHERE a.enrollment_id=NEW.enrollment_id AND a.item_id=NEW.item_id;
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
CREATE TRIGGER assignment_attachment_guard BEFORE INSERT OR UPDATE OR DELETE ON synthetic_learning.assignment_attachments
FOR EACH ROW EXECUTE FUNCTION synthetic_learning.guard_assignment_attachment();
CREATE FUNCTION synthetic_learning.revise_assignment_attachment() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
BEGIN
  UPDATE synthetic_learning.assignment_drafts SET revision=revision+1
    WHERE enrollment_id=NEW.enrollment_id AND item_id=NEW.item_id;
  RETURN NEW;
END;
$$;
CREATE TRIGGER assignment_attachment_revision AFTER INSERT OR UPDATE ON synthetic_learning.assignment_attachments
FOR EACH ROW EXECUTE FUNCTION synthetic_learning.revise_assignment_attachment();
REVOKE ALL ON FUNCTION synthetic_learning.guard_assignment_attachment() FROM PUBLIC;
REVOKE ALL ON FUNCTION synthetic_learning.revise_assignment_attachment() FROM PUBLIC;

-- Replace the invoker guard forward; existing immutable receipt rows retain [].
CREATE OR REPLACE FUNCTION synthetic_learning.guard_assignment_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path = pg_catalog AS $$
DECLARE draft synthetic_learning.assignment_drafts%ROWTYPE;
BEGIN
  IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Submitted assignment is immutable' USING ERRCODE='23514'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended(NEW.enrollment_id::text||':'||NEW.item_id::text,0));
  SELECT * INTO draft FROM synthetic_learning.assignment_drafts d
    WHERE d.enrollment_id=NEW.enrollment_id AND d.item_id=NEW.item_id FOR UPDATE;
  IF NOT FOUND OR draft.program_id<>NEW.program_id OR draft.revision<>NEW.revision OR draft.answer<>NEW.answer THEN
    RAISE EXCEPTION 'Saved draft required' USING ERRCODE='23514';
  END IF;
  SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'filename',a.filename,'media_type',a.media_type,
    'size_bytes',a.size_bytes,'sha256',a.sha256,'uploaded_at',a.uploaded_at) ORDER BY a.uploaded_at,a.id),'[]'::jsonb)
    INTO NEW.attachments FROM synthetic_learning.assignment_attachments a
    WHERE a.enrollment_id=NEW.enrollment_id AND a.item_id=NEW.item_id AND NOT a.removed;
  NEW.submitted_at=clock_timestamp();
  RETURN NEW;
END;
$$;
REVOKE ALL ON FUNCTION synthetic_learning.guard_assignment_receipt() FROM PUBLIC;

-- Exact known fixture descriptions limit this wording correction to local data.
UPDATE synthetic_learning.items SET content=replace(content,
  'No uploads, grading, awards or lesson progress are created.',
  'Optional fictional TXT, PDF, PNG or JPEG files may be attached before submission. No grading, awards or lesson progress are created.')
WHERE id='30000000-0000-4000-8000-000000000004' AND kind='assignment'
  AND description='Write a fictional reflection, save a draft, then submit it once.';
UPDATE synthetic_learning.items SET content=replace(content,
  'No documents, grading or real personal information.',
  'Optional fictional TXT, PDF, PNG or JPEG files may be attached before submission. No grading or real personal information.')
WHERE id='30000000-0000-4000-8000-000000000007' AND kind='assignment'
  AND description='Write a fictional action plan, save a draft, then submit it once.';
UPDATE synthetic_learning.items SET content=replace(content,'No files, grading or awards.',
  'Optional fictional TXT, PDF, PNG or JPEG files may be attached before submission. No grading or awards.')
WHERE id='30000000-0000-4000-8000-000000000010' AND kind='assignment'
  AND description='Write a fictional School B reflection, save a draft, then submit it once.';
