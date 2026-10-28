-- Supabase synthetic-only app-schema policy model. Managed schemas are untouched.
-- Runtime role has no memberships, ownership, bypass, browser or provider API grant.
DO $gate$
BEGIN
  IF current_database()<>'postgres' OR current_user<>'postgres' OR (SELECT count(*) FROM synthetic_meta.identity)<>1
    OR NOT EXISTS(SELECT 1 FROM synthetic_meta.identity WHERE provider='supabase' AND supabase_project_ref ~ '^[a-z]{20}$'
      AND baseline_sha256 ~ '^[0-9a-f]{64}$' AND isolation_sha256 ~ '^[0-9a-f]{64}$')
    OR to_regclass('synthetic_handoff.events') IS NULL
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='epdg_synthetic_app'
      AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls)
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='epdg_synthetic_app')) THEN
    RAISE EXCEPTION 'Dedicated hosted practice operator and isolated schema required' USING ERRCODE='23514';
  END IF;
END;
$gate$;

CREATE SCHEMA IF NOT EXISTS hosted_practice;
REVOKE ALL ON SCHEMA hosted_practice FROM PUBLIC;
CREATE TABLE IF NOT EXISTS hosted_practice.identity (
  singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),
  instance_id uuid NOT NULL UNIQUE,
  project_id uuid NOT NULL,
  environment_id uuid NOT NULL,
  service_id uuid NOT NULL,
  supabase_project_ref text NOT NULL CHECK(supabase_project_ref ~ '^[a-z]{20}$'),
  supabase_organization_id text NOT NULL CHECK(length(supabase_organization_id) BETWEEN 1 AND 200),
  database_host text NOT NULL CHECK(database_host='db.' || supabase_project_ref || '.supabase.co'),
  baseline_sha256 text NOT NULL CHECK(baseline_sha256 ~ '^[0-9a-f]{64}$'),
  isolation_sha256 text NOT NULL CHECK(isolation_sha256 ~ '^[0-9a-f]{64}$'),
  schema_sha256 text NOT NULL CHECK(schema_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS hosted_practice.mail_capture (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  from_address text NOT NULL CHECK(from_address='EPDG Synthetic <no-reply@epdg.invalid>'),
  recipient text NOT NULL CHECK(recipient ~ '^[a-z0-9._+-]+@[a-z0-9.-]+\.invalid$' AND octet_length(recipient)<=150),
  subject text NOT NULL CHECK(subject='EPDG portal password recovery'),
  html text NOT NULL CHECK(octet_length(html)>0 AND octet_length(html)<=16384),
  captured_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE hosted_practice.identity ENABLE ROW LEVEL SECURITY;
ALTER TABLE hosted_practice.mail_capture ENABLE ROW LEVEL SECURITY;

-- The app cannot mutate identity or routing. Operator reads are private; there is
-- no browser capture endpoint and no external delivery dispatcher.
CREATE OR REPLACE FUNCTION hosted_practice.immutable_record() RETURNS trigger
LANGUAGE plpgsql SET search_path=pg_catalog AS $$
BEGIN
  RAISE EXCEPTION 'Hosted practice records are immutable' USING ERRCODE='23514';
END;
$$;
DO $immutable$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='hosted_practice.identity'::regclass AND tgname='hosted_identity_immutable') THEN
    CREATE TRIGGER hosted_identity_immutable BEFORE UPDATE OR DELETE ON hosted_practice.identity
      FOR EACH ROW EXECUTE FUNCTION hosted_practice.immutable_record();
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='hosted_practice.mail_capture'::regclass AND tgname='hosted_capture_immutable') THEN
    CREATE TRIGGER hosted_capture_immutable BEFORE UPDATE OR DELETE ON hosted_practice.mail_capture
      FOR EACH ROW EXECUTE FUNCTION hosted_practice.immutable_record();
  END IF;
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='synthetic_meta.identity'::regclass AND tgname='supabase_marker_immutable') THEN
    CREATE TRIGGER supabase_marker_immutable BEFORE INSERT OR UPDATE OR DELETE ON synthetic_meta.identity
      FOR EACH ROW EXECUTE FUNCTION hosted_practice.immutable_record();
  END IF;
  -- SELECT FOR SHARE of existing role rows requires UPDATE privilege. The one
  -- column grant below enables locking, while every actual app UPDATE is denied.
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='core.user_branch_roles'::regclass AND tgname='hosted_role_immutable') THEN
    CREATE TRIGGER hosted_role_immutable BEFORE UPDATE ON core.user_branch_roles
      FOR EACH ROW WHEN (current_user='epdg_synthetic_app') EXECUTE FUNCTION hosted_practice.immutable_record();
  END IF;
END;
$immutable$;

-- Fresh hosted isolation uses its own named constraints; local-only isolation.sql
-- is neither edited nor executed on the hosted database.
DO $isolation$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['core.users','epdg.users','epdg.companies','epdg.schools'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_constraint WHERE conrelid=target::regclass AND conname='hosted_practice_email_only') THEN
      EXECUTE format('ALTER TABLE %s ADD CONSTRAINT hosted_practice_email_only CHECK (email IS NULL OR email ~* %L)',
        target,'^[a-z0-9._+-]+@[a-z0-9.-]+\.invalid$');
    END IF;
  END LOOP;
END;
$isolation$;

-- Scope every revoke to newly created app schemas. Preserve managed database,
-- public/auth/storage/realtime/extension ACLs and inherited PUBLIC TEMP privilege.
-- Remove table/column/function/type/sequence rights from app objects explicitly;
-- no global postgres default ACL is changed.
DO $private_app_objects$
DECLARE principal text; namespace text; target record; columns text; type_target record;
BEGIN
  FOREACH principal IN ARRAY ARRAY['PUBLIC','anon','authenticated','authenticator','service_role','epdg_synthetic_app'] LOOP
    IF principal<>'PUBLIC' AND NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=principal) THEN CONTINUE; END IF;
    FOREACH namespace IN ARRAY ARRAY['core','epdg','portal_security','synthetic_learning','synthetic_handoff','hosted_practice','synthetic_meta'] LOOP
      EXECUTE format('REVOKE ALL ON SCHEMA %I FROM %s',namespace,CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
      EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA %I FROM %s',namespace,CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
      EXECUTE format('REVOKE ALL ON ALL SEQUENCES IN SCHEMA %I FROM %s',namespace,CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
      EXECUTE format('REVOKE ALL ON ALL FUNCTIONS IN SCHEMA %I FROM %s',namespace,CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
      FOR target IN SELECT c.oid,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
        WHERE n.nspname=namespace AND c.relkind IN ('r','p') LOOP
        SELECT string_agg(quote_ident(attname),',' ORDER BY attnum) INTO columns FROM pg_attribute
          WHERE attrelid=target.oid AND attnum>0 AND NOT attisdropped;
        EXECUTE format('REVOKE SELECT(%s),INSERT(%s),UPDATE(%s),REFERENCES(%s) ON TABLE %I.%I FROM %s',
          columns,columns,columns,columns,namespace,target.relname,CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
      END LOOP;
      FOR type_target IN SELECT t.typname FROM pg_type t JOIN pg_namespace n ON n.oid=t.typnamespace
        WHERE n.nspname=namespace AND t.typtype='e' LOOP
        EXECUTE format('REVOKE ALL ON TYPE %I.%I FROM %s',namespace,type_target.typname,CASE WHEN principal='PUBLIC' THEN 'PUBLIC' ELSE quote_ident(principal) END);
      END LOOP;
    END LOOP;
  END LOOP;
END;
$private_app_objects$;
-- Schema-scoped future function defaults only; no managed/global default rewrite.
ALTER DEFAULT PRIVILEGES IN SCHEMA core,epdg,portal_security,synthetic_learning,synthetic_handoff,hosted_practice,synthetic_meta REVOKE EXECUTE ON FUNCTIONS FROM PUBLIC;
GRANT USAGE ON SCHEMA core,epdg,portal_security,synthetic_learning,synthetic_handoff,hosted_practice,synthetic_meta TO epdg_synthetic_app;
GRANT SELECT ON synthetic_meta.identity TO epdg_synthetic_app;
GRANT SELECT ON core.users,core.branches,core.user_branch_roles,epdg.users,epdg.schools,epdg.companies,epdg.intern_profiles,epdg.admins TO epdg_synthetic_app;
GRANT UPDATE(password) ON core.users,epdg.users TO epdg_synthetic_app;
GRANT UPDATE(role_name) ON core.user_branch_roles TO epdg_synthetic_app;
GRANT SELECT ON portal_security.schema_migrations,portal_security.account_states,portal_security.memberships,
  portal_security.sessions,portal_security.recovery_tokens TO epdg_synthetic_app;
GRANT UPDATE(revision) ON portal_security.account_states TO epdg_synthetic_app;
GRANT INSERT(user_id,token_hash,credential_version,account_revision,membership_fingerprint,expires_at) ON portal_security.sessions TO epdg_synthetic_app;
GRANT UPDATE(last_seen_at,revoked_at,revoked_reason) ON portal_security.sessions TO epdg_synthetic_app;
GRANT INSERT(user_id,token_hash,credential_version,account_revision,expires_at) ON portal_security.recovery_tokens TO epdg_synthetic_app;
GRANT UPDATE(consumed_at,revoked_at) ON portal_security.recovery_tokens TO epdg_synthetic_app;
GRANT INSERT(event,user_id,session_id) ON portal_security.audit_events TO epdg_synthetic_app;
GRANT SELECT ON ALL TABLES IN SCHEMA synthetic_learning TO epdg_synthetic_app;
GRANT INSERT(enrollment_id,program_id,item_id) ON synthetic_learning.completions TO epdg_synthetic_app;
GRANT INSERT(enrollment_id,program_id,item_id,answer,revision) ON synthetic_learning.assignment_drafts,synthetic_learning.assignment_receipts TO epdg_synthetic_app;
GRANT UPDATE(answer,revision,attempt_number,previous_receipt_id) ON synthetic_learning.assignment_drafts TO epdg_synthetic_app;
GRANT INSERT(enrollment_id,program_id,item_id,filename,media_type,bytes) ON synthetic_learning.assignment_attachments TO epdg_synthetic_app;
GRANT UPDATE(removed) ON synthetic_learning.assignment_attachments TO epdg_synthetic_app;
GRANT INSERT(assignment_id,receipt_id,comment,revision) ON synthetic_learning.mentor_review_drafts,synthetic_learning.mentor_review_feedback TO epdg_synthetic_app;
GRANT UPDATE(comment,revision) ON synthetic_learning.mentor_review_drafts TO epdg_synthetic_app;
GRANT SELECT ON synthetic_handoff.mappings,synthetic_handoff.events,synthetic_handoff.nonces TO epdg_synthetic_app;
GRANT INSERT(event_id,payload_sha256,mapping_id,decision_id,decision_version,decision,issued_at,policy_version,reviewer_id,
  identity_verified,onboarding_complete,agreements_complete,hr_approved,withdrawn) ON synthetic_handoff.events TO epdg_synthetic_app;
GRANT INSERT(nonce,event_id) ON synthetic_handoff.nonces TO epdg_synthetic_app;
GRANT EXECUTE ON FUNCTION synthetic_learning.mentor_scope_allowed(uuid,uuid),synthetic_handoff.enrollment_allowed(uuid) TO epdg_synthetic_app;
GRANT SELECT ON hosted_practice.identity TO epdg_synthetic_app;
GRANT INSERT(from_address,recipient,subject,html) ON hosted_practice.mail_capture TO epdg_synthetic_app;

-- Policies name only the private server role. Per-user session/scope checks stay
-- in the application and invoker guards; no authenticated/anon/browser grant.
DO $policies$
DECLARE target text;
BEGIN
  FOREACH target IN ARRAY ARRAY['core.users','core.branches','core.user_branch_roles','epdg.users','epdg.schools',
    'epdg.companies','epdg.intern_profiles','epdg.admins','portal_security.schema_migrations','portal_security.account_states',
    'portal_security.memberships','portal_security.sessions','portal_security.recovery_tokens','synthetic_learning.schema_migrations',
    'synthetic_learning.programs','synthetic_learning.enrollments','synthetic_learning.items','synthetic_learning.completions',
    'synthetic_learning.feedback','synthetic_learning.resources','synthetic_learning.assignment_drafts','synthetic_learning.assignment_receipts',
    'synthetic_learning.assignment_attachments','synthetic_learning.mentor_assignments','synthetic_learning.mentor_review_drafts',
    'synthetic_learning.mentor_review_feedback','synthetic_handoff.mappings','synthetic_handoff.events','synthetic_handoff.nonces','hosted_practice.identity','synthetic_meta.identity'] LOOP
    EXECUTE format('ALTER TABLE %s ENABLE ROW LEVEL SECURITY',target);
    IF NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=target::regclass AND polname='hosted_app_select') THEN
      EXECUTE format('CREATE POLICY hosted_app_select ON %s FOR SELECT TO epdg_synthetic_app USING (current_user=%L)',target,'epdg_synthetic_app');
    END IF;
  END LOOP;
  FOREACH target IN ARRAY ARRAY['portal_security.sessions','portal_security.recovery_tokens','portal_security.audit_events',
    'synthetic_learning.completions','synthetic_learning.assignment_drafts','synthetic_learning.assignment_receipts',
    'synthetic_learning.assignment_attachments','synthetic_learning.mentor_review_drafts','synthetic_learning.mentor_review_feedback',
    'synthetic_handoff.events','synthetic_handoff.nonces','hosted_practice.mail_capture'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=target::regclass AND polname='hosted_app_insert') THEN
      EXECUTE format('CREATE POLICY hosted_app_insert ON %s FOR INSERT TO epdg_synthetic_app WITH CHECK (current_user=%L)',target,'epdg_synthetic_app');
    END IF;
  END LOOP;
  FOREACH target IN ARRAY ARRAY['core.users','core.user_branch_roles','epdg.users','portal_security.account_states',
    'portal_security.sessions','portal_security.recovery_tokens','synthetic_learning.assignment_drafts',
    'synthetic_learning.assignment_attachments','synthetic_learning.mentor_review_drafts'] LOOP
    IF NOT EXISTS(SELECT 1 FROM pg_policy WHERE polrelid=target::regclass AND polname='hosted_app_update') THEN
      EXECUTE format('CREATE POLICY hosted_app_update ON %s FOR UPDATE TO epdg_synthetic_app USING (current_user=%L) WITH CHECK (current_user=%L)',
        target,'epdg_synthetic_app','epdg_synthetic_app');
    END IF;
  END LOOP;
END;
$policies$;
