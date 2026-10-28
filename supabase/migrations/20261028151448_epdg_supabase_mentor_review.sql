-- Local synthetic mentor mappings and text feedback only. No role/account edits.
CREATE TABLE synthetic_learning.mentor_assignments (
  id uuid PRIMARY KEY,
  mentor_user_id integer NOT NULL REFERENCES core.users(id),
  membership_id uuid NOT NULL REFERENCES portal_security.memberships(id),
  enrollment_id uuid NOT NULL REFERENCES synthetic_learning.enrollments(id),
  school_id integer NOT NULL REFERENCES epdg.schools(id),
  active boolean NOT NULL DEFAULT false,
  mentor_label text NOT NULL CHECK (mentor_label IN ('SYNTHETIC Mentor A','SYNTHETIC Mentor B')),
  UNIQUE(mentor_user_id,enrollment_id)
);
CREATE INDEX synthetic_mentor_assignment_membership ON synthetic_learning.mentor_assignments(membership_id);
CREATE INDEX synthetic_mentor_assignment_enrollment ON synthetic_learning.mentor_assignments(enrollment_id);
CREATE INDEX synthetic_mentor_assignment_school ON synthetic_learning.mentor_assignments(school_id);
CREATE TABLE synthetic_learning.mentor_review_drafts (
  assignment_id uuid NOT NULL REFERENCES synthetic_learning.mentor_assignments(id),
  receipt_id uuid NOT NULL REFERENCES synthetic_learning.assignment_receipts(id),
  comment text NOT NULL CHECK (char_length(comment)<=4000 AND octet_length(comment)<=12000),
  revision integer NOT NULL CHECK (revision>0),
  saved_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY(assignment_id,receipt_id)
);
CREATE INDEX synthetic_mentor_review_draft_receipt ON synthetic_learning.mentor_review_drafts(receipt_id);
CREATE TABLE synthetic_learning.mentor_review_feedback (
  id uuid NOT NULL UNIQUE DEFAULT gen_random_uuid(),
  assignment_id uuid NOT NULL,
  receipt_id uuid NOT NULL,
  comment text NOT NULL CHECK (char_length(comment) BETWEEN 1 AND 4000 AND octet_length(comment)<=12000),
  revision integer NOT NULL CHECK (revision>0),
  published_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  mentor_label text NOT NULL,
  PRIMARY KEY(assignment_id,receipt_id),
  FOREIGN KEY(assignment_id,receipt_id) REFERENCES synthetic_learning.mentor_review_drafts(assignment_id,receipt_id)
);
CREATE INDEX synthetic_mentor_review_feedback_receipt ON synthetic_learning.mentor_review_feedback(receipt_id,published_at);
ALTER TABLE synthetic_learning.mentor_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE synthetic_learning.mentor_review_drafts ENABLE ROW LEVEL SECURITY;
ALTER TABLE synthetic_learning.mentor_review_feedback ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON synthetic_learning.mentor_assignments,synthetic_learning.mentor_review_drafts,synthetic_learning.mentor_review_feedback FROM PUBLIC;

-- Invoker predicate: no privileged access, data mutation or browser execute.
CREATE FUNCTION synthetic_learning.mentor_scope_allowed(mapping uuid,receipt uuid) RETURNS boolean
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
 WHERE ma.id=mapping AND ma.active AND mu.name LIKE 'SYNTHETIC %' AND lu.name LIKE 'SYNTHETIC %'
 AND mu.email IN ('school-a@epdg.invalid','school-b@epdg.invalid')
 AND lu.email IN ('learner-a@epdg.invalid','learner-b@epdg.invalid')
 AND EXISTS(SELECT 1 FROM core.user_branch_roles ubr JOIN core.branches b ON b.id=ubr.branch_id
   WHERE ubr.user_id=mu.id AND b.code='epdg' AND ubr.role_name::text='school' AND ubr.rejection_reason IS NULL)
 AND EXISTS(SELECT 1 FROM core.user_branch_roles ubr JOIN core.branches b ON b.id=ubr.branch_id
   WHERE ubr.user_id=lu.id AND b.code='epdg' AND ubr.role_name::text='intern' AND ubr.rejection_reason IS NULL)
 AND EXISTS(SELECT 1 FROM epdg.intern_profiles ip WHERE ip.user_id=lu.id AND ip.school_id=e.school_id
   AND ip.is_approved AND ip.rejection_reason IS NULL));
$$;
REVOKE ALL ON FUNCTION synthetic_learning.mentor_scope_allowed(uuid,uuid) FROM PUBLIC;

CREATE FUNCTION synthetic_learning.guard_mentor_mapping() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Mentor mappings are retained' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('mentor-mapping:'||NEW.id::text,0));
 IF TG_OP='UPDATE' AND (NEW.id IS DISTINCT FROM OLD.id OR NEW.mentor_user_id IS DISTINCT FROM OLD.mentor_user_id
  OR NEW.membership_id IS DISTINCT FROM OLD.membership_id OR NEW.enrollment_id IS DISTINCT FROM OLD.enrollment_id
  OR NEW.school_id IS DISTINCT FROM OLD.school_id OR NEW.mentor_label IS DISTINCT FROM OLD.mentor_label) THEN
  RAISE EXCEPTION 'Mentor mapping identity is immutable' USING ERRCODE='23514';
 END IF;
 IF TG_OP='INSERT' AND NOT EXISTS(SELECT 1 FROM epdg.schools s
  JOIN portal_security.memberships m ON m.school_id=s.id AND m.user_id=s.user_id AND m.id=NEW.membership_id
  JOIN synthetic_learning.enrollments e ON e.id=NEW.enrollment_id AND e.school_id=s.id
  JOIN core.users u ON u.id=s.user_id
  WHERE s.id=NEW.school_id AND s.user_id=NEW.mentor_user_id
   AND ((u.email='school-a@epdg.invalid' AND NEW.mentor_label='SYNTHETIC Mentor A')
    OR (u.email='school-b@epdg.invalid' AND NEW.mentor_label='SYNTHETIC Mentor B'))) THEN
  RAISE EXCEPTION 'Explicit same-school synthetic mapping required' USING ERRCODE='23514';
 END IF;
 RETURN NEW;
END;
$$;
CREATE TRIGGER mentor_mapping_guard BEFORE INSERT OR UPDATE OR DELETE ON synthetic_learning.mentor_assignments
FOR EACH ROW EXECUTE FUNCTION synthetic_learning.guard_mentor_mapping();

CREATE FUNCTION synthetic_learning.guard_mentor_review_draft() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
 IF TG_OP='DELETE' THEN RAISE EXCEPTION 'Mentor review drafts are retained' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('mentor-mapping:'||NEW.assignment_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('mentor-review:'||NEW.assignment_id::text||':'||NEW.receipt_id::text,0));
 IF NOT synthetic_learning.mentor_scope_allowed(NEW.assignment_id,NEW.receipt_id) THEN
  RAISE EXCEPTION 'Current mentor review scope required' USING ERRCODE='23514';
 END IF;
 IF EXISTS(SELECT 1 FROM synthetic_learning.mentor_review_feedback f WHERE f.assignment_id=NEW.assignment_id AND f.receipt_id=NEW.receipt_id) THEN
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
CREATE TRIGGER mentor_review_draft_guard BEFORE INSERT OR UPDATE OR DELETE ON synthetic_learning.mentor_review_drafts
FOR EACH ROW EXECUTE FUNCTION synthetic_learning.guard_mentor_review_draft();

CREATE FUNCTION synthetic_learning.guard_mentor_feedback() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
DECLARE draft synthetic_learning.mentor_review_drafts%ROWTYPE;
BEGIN
 IF TG_OP<>'INSERT' THEN RAISE EXCEPTION 'Published feedback is immutable' USING ERRCODE='23514'; END IF;
 PERFORM pg_advisory_xact_lock_shared(hashtextextended('mentor-mapping:'||NEW.assignment_id::text,0));
 PERFORM pg_advisory_xact_lock(hashtextextended('mentor-review:'||NEW.assignment_id::text||':'||NEW.receipt_id::text,0));
 IF NOT synthetic_learning.mentor_scope_allowed(NEW.assignment_id,NEW.receipt_id) THEN
  RAISE EXCEPTION 'Current mentor review scope required' USING ERRCODE='23514';
 END IF;
 SELECT * INTO draft FROM synthetic_learning.mentor_review_drafts d
  WHERE d.assignment_id=NEW.assignment_id AND d.receipt_id=NEW.receipt_id FOR UPDATE;
 IF NOT FOUND OR draft.revision<>NEW.revision OR draft.comment<>NEW.comment OR
  btrim(NEW.comment,U&'\0009\000A\000B\000C\000D\0020\00A0\1680\2000\2001\2002\2003\2004\2005\2006\2007\2008\2009\200A\2028\2029\202F\205F\3000\FEFF')='' THEN
  RAISE EXCEPTION 'Saved nonblank review draft required' USING ERRCODE='23514';
 END IF;
 SELECT mentor_label INTO NEW.mentor_label FROM synthetic_learning.mentor_assignments WHERE id=NEW.assignment_id;
 NEW.published_at=clock_timestamp(); RETURN NEW;
END;
$$;
CREATE TRIGGER mentor_review_feedback_guard BEFORE INSERT OR UPDATE OR DELETE ON synthetic_learning.mentor_review_feedback
FOR EACH ROW EXECUTE FUNCTION synthetic_learning.guard_mentor_feedback();
REVOKE ALL ON FUNCTION synthetic_learning.guard_mentor_mapping() FROM PUBLIC;
REVOKE ALL ON FUNCTION synthetic_learning.guard_mentor_review_draft() FROM PUBLIC;
REVOKE ALL ON FUNCTION synthetic_learning.guard_mentor_feedback() FROM PUBLIC;
