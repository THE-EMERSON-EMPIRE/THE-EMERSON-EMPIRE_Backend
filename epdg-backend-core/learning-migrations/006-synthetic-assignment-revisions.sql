-- Local synthetic attempt chain. Existing immutable receipt IDs/content remain.
ALTER TABLE synthetic_learning.assignment_drafts ADD COLUMN attempt_number integer NOT NULL DEFAULT 1 CHECK(attempt_number BETWEEN 1 AND 5);
ALTER TABLE synthetic_learning.assignment_drafts ADD COLUMN previous_receipt_id uuid REFERENCES synthetic_learning.assignment_receipts(id);
ALTER TABLE synthetic_learning.assignment_drafts ADD CONSTRAINT synthetic_draft_attempt_parent CHECK
 ((attempt_number=1 AND previous_receipt_id IS NULL) OR (attempt_number>1 AND previous_receipt_id IS NOT NULL));
ALTER TABLE synthetic_learning.assignment_receipts ADD COLUMN attempt_number integer NOT NULL DEFAULT 1 CHECK(attempt_number BETWEEN 1 AND 5);
ALTER TABLE synthetic_learning.assignment_receipts ADD COLUMN previous_receipt_id uuid REFERENCES synthetic_learning.assignment_receipts(id);
ALTER TABLE synthetic_learning.assignment_receipts ADD CONSTRAINT synthetic_receipt_attempt_parent CHECK
 ((attempt_number=1 AND previous_receipt_id IS NULL) OR (attempt_number>1 AND previous_receipt_id IS NOT NULL));
-- Reviewed structural exception: replace only this index/constraint, no rows.
-- The existing UNIQUE(id) and every mentor receipt-ID foreign key are retained.
ALTER TABLE synthetic_learning.assignment_receipts DROP CONSTRAINT assignment_receipts_pkey;
ALTER TABLE synthetic_learning.assignment_receipts ADD PRIMARY KEY(enrollment_id,item_id,attempt_number);
ALTER TABLE synthetic_learning.assignment_attachments ADD COLUMN attempt_number integer NOT NULL DEFAULT 1 CHECK(attempt_number BETWEEN 1 AND 5);
CREATE INDEX synthetic_attachment_attempt_scope ON synthetic_learning.assignment_attachments(enrollment_id,item_id,attempt_number,uploaded_at,id);
CREATE INDEX synthetic_draft_previous_receipt ON synthetic_learning.assignment_drafts(previous_receipt_id);
CREATE INDEX synthetic_receipt_previous_receipt ON synthetic_learning.assignment_receipts(previous_receipt_id);

CREATE OR REPLACE FUNCTION synthetic_learning.guard_assignment_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE prior synthetic_learning.assignment_receipts%ROWTYPE;
BEGIN
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.enrollment_id::text||':'||NEW.item_id::text,0));
 IF NOT EXISTS(SELECT 1 FROM synthetic_learning.items i WHERE i.id=NEW.item_id AND i.program_id=NEW.program_id AND i.kind='assignment') THEN
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
   IF NEW.previous_receipt_id IS DISTINCT FROM OLD.previous_receipt_id OR EXISTS(SELECT 1 FROM synthetic_learning.assignment_receipts r
    WHERE r.enrollment_id=NEW.enrollment_id AND r.item_id=NEW.item_id AND r.attempt_number=NEW.attempt_number) THEN
    RAISE EXCEPTION 'Submitted attempt is immutable' USING ERRCODE='23514';
   END IF;
  ELSIF NEW.attempt_number=OLD.attempt_number+1 AND OLD.attempt_number<5 THEN
   SELECT * INTO prior FROM synthetic_learning.assignment_receipts r
    WHERE r.enrollment_id=OLD.enrollment_id AND r.item_id=OLD.item_id AND r.attempt_number=OLD.attempt_number;
   IF NOT FOUND OR prior.id IS DISTINCT FROM NEW.previous_receipt_id OR NOT EXISTS
    (SELECT 1 FROM synthetic_learning.mentor_review_feedback f WHERE f.receipt_id=prior.id) THEN
    RAISE EXCEPTION 'Published feedback on the latest receipt is required' USING ERRCODE='23514';
   END IF;
   IF NOT EXISTS(SELECT 1 FROM synthetic_learning.enrollments e
    JOIN synthetic_learning.programs p ON p.id=e.program_id AND p.school_id=e.school_id
    JOIN portal_security.memberships m ON m.id=e.membership_id AND m.user_id=e.user_id AND m.school_id=e.school_id AND m.active
    JOIN portal_security.account_states a ON a.user_id=e.user_id AND a.active
    JOIN core.users u ON u.id=e.user_id AND u.deleted_at IS NULL AND u.is_verified AND u.name LIKE 'SYNTHETIC %'
    JOIN epdg.users eu ON eu.id=u.id AND eu.deleted_at IS NULL AND eu.is_verified AND eu.rejection_reason IS NULL
    JOIN epdg.schools s ON s.id=e.school_id AND s.is_approved AND s.deleted_at IS NULL
    JOIN epdg.intern_profiles ip ON ip.user_id=u.id AND ip.school_id=s.id AND ip.is_approved AND ip.rejection_reason IS NULL
    WHERE e.id=NEW.enrollment_id AND e.program_id=NEW.program_id AND e.active
     AND u.email IN ('learner-a@epdg.invalid','learner-b@epdg.invalid')
     AND EXISTS(SELECT 1 FROM core.user_branch_roles ubr JOIN core.branches b ON b.id=ubr.branch_id
      WHERE ubr.user_id=u.id AND b.code='epdg' AND ubr.role_name::text='intern' AND ubr.rejection_reason IS NULL)) THEN
    RAISE EXCEPTION 'Current learner enrollment is required' USING ERRCODE='23514';
   END IF;
   NEW.answer=prior.answer;
  ELSE
   RAISE EXCEPTION 'Invalid or exhausted attempt chain' USING ERRCODE='23514';
  END IF;
 END IF;
 NEW.saved_at=clock_timestamp(); RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION synthetic_learning.guard_assignment_receipt() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE draft synthetic_learning.assignment_drafts%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Submitted assignment is immutable' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.enrollment_id::text||':'||NEW.item_id::text,0));
 SELECT * INTO draft FROM synthetic_learning.assignment_drafts d
  WHERE d.enrollment_id=NEW.enrollment_id AND d.item_id=NEW.item_id FOR UPDATE;
 IF NOT FOUND OR draft.program_id<>NEW.program_id OR draft.revision<>NEW.revision OR draft.answer<>NEW.answer OR
  btrim(NEW.answer,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')='' THEN
  RAISE EXCEPTION 'Saved nonblank draft required' USING ERRCODE='23514';
 END IF;
 NEW.attempt_number=draft.attempt_number; NEW.previous_receipt_id=draft.previous_receipt_id;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id,'filename',a.filename,'media_type',a.media_type,
  'size_bytes',a.size_bytes,'sha256',a.sha256,'uploaded_at',a.uploaded_at) ORDER BY a.uploaded_at,a.id),'[]'::jsonb)
  INTO NEW.attachments FROM synthetic_learning.assignment_attachments a
  WHERE a.enrollment_id=NEW.enrollment_id AND a.item_id=NEW.item_id AND a.attempt_number=draft.attempt_number AND NOT a.removed;
 NEW.submitted_at=clock_timestamp(); RETURN NEW;
END;
$$;

CREATE OR REPLACE FUNCTION synthetic_learning.guard_assignment_attachment() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE active_count integer; lifetime_count integer; draft_revision integer; current_attempt integer; text_value text;
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Attachment records are retained' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended(NEW.enrollment_id::text||':'||NEW.item_id::text,0));
 SELECT d.revision,d.attempt_number INTO draft_revision,current_attempt FROM synthetic_learning.assignment_drafts d
  WHERE d.enrollment_id=NEW.enrollment_id AND d.item_id=NEW.item_id AND d.program_id=NEW.program_id FOR UPDATE;
 IF NOT FOUND OR draft_revision=2147483647 THEN RAISE EXCEPTION 'Writable saved draft required' USING ERRCODE='23514'; END IF;
 IF EXISTS(SELECT 1 FROM synthetic_learning.assignment_receipts r WHERE r.enrollment_id=NEW.enrollment_id
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
 SELECT count(*) FILTER(WHERE NOT a.removed),count(*) INTO active_count,lifetime_count FROM synthetic_learning.assignment_attachments a
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
REVOKE ALL ON FUNCTION synthetic_learning.guard_assignment_draft() FROM PUBLIC;
REVOKE ALL ON FUNCTION synthetic_learning.guard_assignment_receipt() FROM PUBLIC;
REVOKE ALL ON FUNCTION synthetic_learning.guard_assignment_attachment() FROM PUBLIC;
