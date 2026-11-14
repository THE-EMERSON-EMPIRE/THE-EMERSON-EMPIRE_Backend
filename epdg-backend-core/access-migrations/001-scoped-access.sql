-- Portable additive candidate. Manual migrator execution only; never startup.
-- Explicit reviewed roles must be supplied with SET LOCAL inside the migration transaction.
DO $boundary$
DECLARE runtime_name text := current_setting('epdg.access_runtime_role',true);
DECLARE migrator_name text := current_setting('epdg.access_migrator_role',true);
BEGIN
  IF migrator_name IS NULL OR migrator_name<>current_user OR runtime_name IS NULL OR runtime_name=current_user
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname=runtime_name AND NOT rolsuper AND NOT rolbypassrls AND NOT rolcreaterole AND NOT rolcreatedb)
    OR to_regclass('portal_security.role_assignments') IS NULL THEN
    RAISE EXCEPTION 'Reviewed migrator, restricted runtime and security/admin prerequisites required';
  END IF;
END;
$boundary$;
CREATE SCHEMA IF NOT EXISTS portal_access;
REVOKE ALL ON SCHEMA portal_access FROM PUBLIC;
CREATE TABLE IF NOT EXISTS portal_access.schema_migrations(version text PRIMARY KEY,sha256 text NOT NULL CHECK(sha256~'^[0-9a-f]{64}$'),applied_at timestamptz NOT NULL DEFAULT clock_timestamp());
-- Preserve the two historical staging role codes and every existing assignment.
ALTER TABLE portal_security.role_assignments DROP CONSTRAINT IF EXISTS role_assignments_role_code_check;
ALTER TABLE portal_security.role_assignments ADD CONSTRAINT role_assignments_role_code_check CHECK(role_code IN
  ('founder_admin','webdev_technical','founder_owner','organization_admin','hr_admin','technical_maintainer','program_coordinator','intern_team_lead','content_editor','sales_staff','global_outreach','restricted_viewer','participant'));
CREATE TABLE IF NOT EXISTS portal_access.groups(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id integer NOT NULL REFERENCES epdg.companies(id),
  kind text NOT NULL CHECK(kind IN('program','cohort','team')),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 160),
  UNIQUE(id,organization_id)
);
CREATE TABLE IF NOT EXISTS portal_access.group_memberships(
  group_id uuid NOT NULL REFERENCES portal_access.groups(id),user_id integer NOT NULL REFERENCES portal_security.account_states(user_id),
  active boolean NOT NULL DEFAULT false,PRIMARY KEY(group_id,user_id)
);
CREATE TABLE IF NOT EXISTS portal_access.resources(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id integer NOT NULL REFERENCES epdg.companies(id),
  kind text NOT NULL CHECK(kind IN('learning','assignment','portfolio','feedback','progress','team','curriculum','education_handoff','technical_diagnostic','content','commercial','outreach','operational_setting')),
  group_id uuid,subject_user_id integer REFERENCES portal_security.account_states(user_id),
  title text NOT NULL CHECK(length(title) BETWEEN 1 AND 160),body text NOT NULL DEFAULT '' CHECK(octet_length(body)<=16384),
  founder_only boolean NOT NULL DEFAULT false,status text NOT NULL DEFAULT 'draft' CHECK(status IN('draft','published','archived')),
  revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  FOREIGN KEY(group_id,organization_id) REFERENCES portal_access.groups(id,organization_id)
);
CREATE TABLE IF NOT EXISTS portal_access.scopes(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),assignment_id uuid NOT NULL REFERENCES portal_security.role_assignments(id),
  organization_id integer NOT NULL REFERENCES epdg.companies(id),scope_type text NOT NULL CHECK(scope_type IN('organization','group','resource','self')),
  scope_id text NOT NULL CHECK(length(scope_id) BETWEEN 1 AND 80),
  approved_by_user_id integer NOT NULL REFERENCES core.users(id),approval_reference text NOT NULL CHECK(length(btrim(approval_reference)) BETWEEN 8 AND 200),
  active boolean NOT NULL DEFAULT true,revision bigint NOT NULL DEFAULT 1 CHECK(revision>0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  UNIQUE(assignment_id,scope_type,scope_id),CHECK(approval_reference !~ '[\r\n]')
);
CREATE INDEX IF NOT EXISTS access_scopes_active ON portal_access.scopes(assignment_id,organization_id) WHERE active;
CREATE TABLE IF NOT EXISTS portal_access.events(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),actor_user_id integer NOT NULL REFERENCES core.users(id),target_user_id integer REFERENCES core.users(id),
  event text NOT NULL CHECK(event IN('role_granted','scope_revoked','resource_updated','resource_reviewed','resource_published')),
  scope_id uuid,resource_id uuid REFERENCES portal_access.resources(id),approval_reference text,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS portal_access.reviews(
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),resource_id uuid NOT NULL REFERENCES portal_access.resources(id),
  actor_user_id integer NOT NULL REFERENCES core.users(id),body text NOT NULL CHECK(length(btrim(body)) BETWEEN 1 AND 4000),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
DO $trigger$
BEGIN
  IF NOT EXISTS(SELECT 1 FROM pg_trigger WHERE tgrelid='portal_access.scopes'::regclass AND tgname='access_scope_revision') THEN
    CREATE TRIGGER access_scope_revision BEFORE UPDATE ON portal_access.scopes FOR EACH ROW EXECUTE FUNCTION portal_security.advance_revision();
  END IF;
END;
$trigger$;

CREATE OR REPLACE FUNCTION portal_access.has_permission(p_actor integer,p_permission text,p_type text,p_id text) RETURNS boolean
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $permission$
DECLARE g record; r portal_access.resources%ROWTYPE; org integer; grp uuid; subject integer; matched boolean;
BEGIN
  p_permission:=CASE p_permission WHEN 'admin.accounts.approve' THEN 'role.grant'
    WHEN 'admin.accounts.provision' THEN 'admin.accounts.prepare' WHEN 'admin.invitations.send' THEN 'admin.accounts.send'
    WHEN 'admin.audit.read' THEN 'admin.accounts.audit' WHEN 'profile.self.write' THEN 'account.self.update' ELSE p_permission END;
  IF p_actor IS NULL OR p_permission IS NULL OR p_type IS NULL OR p_id IS NULL
    OR NOT EXISTS(SELECT 1 FROM portal_security.account_states s JOIN core.users c ON c.id=s.user_id JOIN epdg.users e ON e.id=c.id
      WHERE s.user_id=p_actor AND s.active AND c.deleted_at IS NULL AND e.deleted_at IS NULL AND c.is_verified AND e.is_verified
      AND lower(btrim(c.email))=lower(btrim(e.email)) AND e.rejection_reason IS NULL
      AND (SELECT count(*) FROM core.users ci WHERE lower(btrim(ci.email))=lower(btrim(c.email)))=1
      AND (SELECT count(*) FROM epdg.users ei WHERE lower(btrim(ei.email))=lower(btrim(e.email)))=1) THEN RETURN false; END IF;
  IF p_type='resource' THEN
    SELECT * INTO r FROM portal_access.resources WHERE id::text=p_id;
    IF r.id IS NULL OR r.status='archived' THEN RETURN false; END IF;
    org:=r.organization_id;grp:=r.group_id;subject:=r.subject_user_id;
  ELSIF p_type='organization' THEN
    SELECT id INTO org FROM epdg.companies WHERE id::text=p_id AND is_approved AND deleted_at IS NULL;
  ELSIF p_type='group' THEN
    SELECT organization_id,id INTO org,grp FROM portal_access.groups WHERE id::text=p_id;
  ELSIF p_type IN('self','user') THEN
    SELECT user_id INTO subject FROM portal_security.account_states WHERE user_id::text=p_id;
    IF subject IS NULL THEN RETURN false; END IF;
  ELSE RETURN false; END IF;
  FOR g IN SELECT a.role_code,s.* FROM portal_security.role_assignments a JOIN portal_access.scopes s ON s.assignment_id=a.id
    JOIN epdg.companies c ON c.id=s.organization_id AND c.is_approved AND c.deleted_at IS NULL
    WHERE a.user_id=p_actor AND a.status='active' AND s.active
      AND EXISTS(SELECT 1 FROM portal_security.memberships m WHERE m.user_id=p_actor AND m.company_id=s.organization_id AND m.active)
      AND (s.scope_type<>'group' OR EXISTS(SELECT 1 FROM portal_access.group_memberships gm WHERE gm.group_id::text=s.scope_id AND gm.user_id=p_actor AND gm.active))
  LOOP
    IF org IS NOT NULL AND g.organization_id<>org THEN CONTINUE; END IF;
    IF p_type IN('self','user') AND NOT EXISTS(
      SELECT 1 FROM portal_security.memberships m WHERE m.user_id=subject AND m.company_id=g.organization_id AND m.active
      UNION ALL SELECT 1 FROM portal_access.group_memberships m JOIN portal_access.groups gr ON gr.id=m.group_id
        WHERE m.user_id=subject AND m.active AND gr.organization_id=g.organization_id) THEN CONTINUE; END IF;
    -- An eligible scoped identity can edit its own safe profile even when its
    -- work assignment is a single resource. This never authorizes another user.
    IF p_type IN('self','user') AND p_permission IN('account.self.read','account.self.update') AND subject=p_actor THEN RETURN true; END IF;
    matched := (g.scope_type='organization' AND g.scope_id=g.organization_id::text)
      OR (g.scope_type='resource' AND p_type='resource' AND g.scope_id=p_id)
      OR (g.scope_type='group' AND (g.scope_id=grp::text OR (p_type='user' AND EXISTS(
        SELECT 1 FROM portal_access.group_memberships m WHERE m.group_id::text=g.scope_id AND m.user_id=subject AND m.active))))
      OR (g.scope_type='self' AND g.scope_id=p_actor::text AND subject=p_actor);
    IF NOT coalesce(matched,false) THEN CONTINUE; END IF;
    IF p_permission='role.grant' THEN
      IF g.role_code='founder_owner' AND g.scope_type='organization' THEN RETURN true; END IF;
      CONTINUE;
    END IF;
    IF p_permission='onboarding.verify' AND g.role_code IN('founder_owner','organization_admin','hr_admin') THEN RETURN true; END IF;
    IF p_permission='admin.accounts.manage_staff' AND g.role_code IN('founder_owner','organization_admin') THEN RETURN true; END IF;
    IF p_permission IN('admin.accounts.read','admin.accounts.prepare','admin.accounts.send','admin.accounts.disable','admin.accounts.audit') THEN
      IF g.role_code NOT IN('founder_owner','organization_admin','hr_admin') THEN CONTINUE; END IF;
      IF subject IS NOT NULL AND p_permission IN('admin.accounts.prepare','admin.accounts.send','admin.accounts.disable') AND subject=p_actor THEN CONTINUE; END IF;
      IF subject IS NOT NULL AND g.role_code<>'founder_owner' AND EXISTS(SELECT 1 FROM portal_security.role_assignments a
        WHERE a.user_id=subject AND a.status='active' AND (a.role_code IN('founder_owner','founder_admin','organization_admin')
          OR (g.role_code='hr_admin' AND a.role_code NOT IN('participant','intern_team_lead')))) THEN CONTINUE; END IF;
      RETURN true;
    END IF;
    IF p_permission='program.coordinate' AND g.role_code IN('founder_owner','organization_admin','program_coordinator','intern_team_lead') THEN RETURN true; END IF;
    IF p_type='group' AND p_permission='learning.review' AND g.role_code IN('founder_owner','organization_admin','program_coordinator','intern_team_lead') THEN RETURN true; END IF;
    IF p_type='group' AND p_permission='learning.enroll' AND g.role_code IN('founder_owner','organization_admin','program_coordinator') THEN RETURN true; END IF;
    IF p_type='group' AND p_permission='learning.curriculum' AND g.role_code IN('founder_owner','organization_admin','program_coordinator','content_editor') THEN RETURN true; END IF;
    IF p_type='group' AND p_permission='learning.participate' AND g.scope_type='group' AND g.role_code IN('participant','intern_team_lead') THEN RETURN true; END IF;
    IF p_type<>'resource' OR p_permission NOT IN('resource.read','resource.edit','resource.review','resource.publish','technical.diagnostics') THEN CONTINUE; END IF;
    IF r.founder_only AND g.role_code<>'founder_owner' THEN CONTINUE; END IF;
    IF g.role_code IN('founder_owner','organization_admin') THEN RETURN true; END IF;
    IF p_permission='resource.publish' THEN CONTINUE; END IF;
    IF g.role_code='hr_admin' AND r.kind IN('education_handoff','progress')
      AND (p_permission='resource.read' OR (r.kind='education_handoff' AND p_permission IN('resource.edit','resource.review'))) THEN RETURN true; END IF;
    IF g.role_code='technical_maintainer' AND r.kind='technical_diagnostic' AND p_permission IN('resource.read','resource.edit','technical.diagnostics') THEN RETURN true; END IF;
    IF g.role_code='program_coordinator' AND r.kind IN('curriculum','progress','team') AND p_permission IN('resource.read','resource.review') THEN RETURN true; END IF;
    IF g.role_code='program_coordinator' AND r.kind IN('curriculum','team') AND p_permission='resource.edit' THEN RETURN true; END IF;
    IF g.role_code='content_editor' AND r.kind IN('content','curriculum') AND p_permission IN('resource.read','resource.edit','resource.review') THEN RETURN true; END IF;
    IF g.role_code='sales_staff' AND r.kind='commercial' AND p_permission IN('resource.read','resource.edit','resource.review') THEN RETURN true; END IF;
    IF g.role_code='global_outreach' AND r.kind='outreach' AND p_permission IN('resource.read','resource.edit','resource.review') THEN RETURN true; END IF;
    IF g.role_code='restricted_viewer' AND g.scope_type='resource' AND p_permission='resource.read' THEN RETURN true; END IF;
    IF g.role_code='intern_team_lead' AND g.scope_type='group' AND r.kind IN('team','progress') AND p_permission IN('resource.read','resource.review') THEN RETURN true; END IF;
    IF g.role_code IN('participant','intern_team_lead') THEN
      IF p_permission='resource.read' AND r.kind IN('learning','assignment','portfolio','feedback','progress','team')
        AND (subject=p_actor OR (subject IS NULL AND r.kind IN('learning','team') AND r.status='published')) THEN RETURN true; END IF;
      IF p_permission='resource.edit' AND subject=p_actor AND r.kind IN('assignment','portfolio') THEN RETURN true; END IF;
    END IF;
  END LOOP;
  RETURN false;
END;
$permission$;

CREATE OR REPLACE FUNCTION portal_access.snapshot(p_actor integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $snapshot$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',a.id::text,'role_code',a.role_code,'revision',a.revision::text||':'||s.id::text||':'||s.revision::text,
   'scope_type',s.scope_type,'scope_id',s.scope_id,'organization_id',s.organization_id) ORDER BY a.role_code,s.id),'[]'::jsonb)
 FROM portal_security.role_assignments a JOIN portal_access.scopes s ON s.assignment_id=a.id
 JOIN portal_security.account_states st ON st.user_id=a.user_id AND st.active
 JOIN epdg.companies c ON c.id=s.organization_id AND c.is_approved AND c.deleted_at IS NULL
 WHERE a.user_id=p_actor AND a.status='active' AND s.active
   AND EXISTS(SELECT 1 FROM portal_security.memberships m WHERE m.user_id=p_actor AND m.company_id=s.organization_id AND m.active)
   AND (s.scope_type<>'group' OR EXISTS(SELECT 1 FROM portal_access.group_memberships gm WHERE gm.group_id::text=s.scope_id AND gm.user_id=p_actor AND gm.active))
$snapshot$;

-- Display labels come only from the actor's currently approved scopes.
CREATE OR REPLACE FUNCTION portal_access.visible_organizations(p_actor integer) RETURNS jsonb
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $organizations$
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.company_name) ORDER BY c.id),'[]'::jsonb)
 FROM epdg.companies c WHERE c.is_approved AND c.deleted_at IS NULL
 AND EXISTS(SELECT 1 FROM jsonb_array_elements(portal_access.snapshot(p_actor)) a WHERE (a->>'organization_id')::integer=c.id)
$organizations$;

CREATE OR REPLACE FUNCTION portal_access.grant_role(p_approver integer,p_target integer,p_role text,p_type text,p_id text,p_reference text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $grant$
DECLARE org integer; assignment uuid; prior portal_access.scopes%ROWTYPE;
BEGIN
 IF p_approver IS NULL OR p_target IS NULL OR p_approver=p_target OR p_reference IS NULL
   OR length(btrim(p_reference)) NOT BETWEEN 8 AND 200 OR p_reference~'[\r\n]'
   OR p_role IS NULL OR p_role NOT IN('founder_owner','organization_admin','hr_admin','technical_maintainer','program_coordinator','intern_team_lead','content_editor','sales_staff','global_outreach','restricted_viewer','participant') THEN
   RAISE EXCEPTION 'Approved role assignment required' USING ERRCODE='42501'; END IF;
 IF p_type='organization' AND p_role IN('founder_owner','organization_admin','hr_admin') THEN SELECT id INTO org FROM epdg.companies WHERE id::text=p_id AND is_approved AND deleted_at IS NULL;
 ELSIF p_type='group' AND p_role IN('hr_admin','technical_maintainer','program_coordinator','intern_team_lead','content_editor','sales_staff','global_outreach','participant') THEN SELECT organization_id INTO org FROM portal_access.groups WHERE id::text=p_id;
 ELSIF p_type='resource' AND p_role NOT IN('founder_owner','organization_admin') THEN SELECT organization_id INTO org FROM portal_access.resources WHERE id::text=p_id;
 ELSIF p_type='self' AND p_role IN('participant','intern_team_lead') AND p_id=p_target::text THEN
   SELECT min(company_id) INTO org FROM portal_security.memberships WHERE user_id=p_target AND company_id IS NOT NULL AND active HAVING count(*)=1;
 END IF;
 IF org IS NULL OR NOT portal_access.has_permission(p_approver,'role.grant','organization',org::text) THEN
   RAISE EXCEPTION 'Founder approval required for this scope' USING ERRCODE='42501'; END IF;
 -- The authenticated transaction already holds the actor SHARE lock. Do not
 -- upgrade it behind a second request waiting on that same session row.
 PERFORM 1 FROM portal_security.account_states WHERE user_id=p_approver FOR SHARE;
 PERFORM 1 FROM portal_security.account_states WHERE user_id=p_target FOR UPDATE;
 IF NOT portal_access.has_permission(p_approver,'role.grant','organization',org::text)
   OR NOT EXISTS(SELECT 1 FROM portal_security.memberships WHERE user_id=p_target AND company_id=org AND active) THEN
   RAISE EXCEPTION 'Current founder authority and approved organization membership required' USING ERRCODE='42501'; END IF;
 IF NOT EXISTS(SELECT 1 FROM portal_security.account_states st JOIN core.users c ON c.id=st.user_id JOIN epdg.users e ON e.id=c.id
   WHERE st.user_id=p_target AND c.email=e.email AND c.deleted_at IS NULL AND e.deleted_at IS NULL) THEN
   RAISE EXCEPTION 'Existing reconciled identity required' USING ERRCODE='42501'; END IF;
 SELECT id INTO assignment FROM portal_security.role_assignments WHERE user_id=p_target AND role_code=p_role AND status IN('pending','active') FOR UPDATE;
 IF assignment IS NULL THEN INSERT INTO portal_security.role_assignments(user_id,role_code,status,assigned_by_user_id)
   VALUES(p_target,p_role,'active',p_approver) RETURNING id INTO assignment; END IF;
 SELECT * INTO prior FROM portal_access.scopes WHERE assignment_id=assignment AND scope_type=p_type AND scope_id=p_id FOR UPDATE;
 IF prior.id IS NOT NULL THEN
   IF prior.active AND prior.approved_by_user_id=p_approver THEN RETURN assignment; END IF;
   RAISE EXCEPTION 'Existing scope requires explicit revocation review' USING ERRCODE='23505'; END IF;
 UPDATE portal_security.role_assignments SET status='active',assigned_by_user_id=p_approver WHERE id=assignment AND status<>'active';
 INSERT INTO portal_access.scopes(assignment_id,organization_id,scope_type,scope_id,approved_by_user_id,approval_reference)
   VALUES(assignment,org,p_type,p_id,p_approver,p_reference) RETURNING * INTO prior;
 IF p_type='group' THEN
   INSERT INTO portal_access.group_memberships(group_id,user_id,active) VALUES(p_id::uuid,p_target,true)
     ON CONFLICT(group_id,user_id) DO UPDATE SET active=true;
 END IF;
 UPDATE portal_security.account_states SET revision=revision+1 WHERE user_id=p_target;
 UPDATE portal_security.sessions SET revoked_at=clock_timestamp(),revoked_reason='account_changed' WHERE user_id=p_target AND revoked_at IS NULL;
 INSERT INTO portal_access.events(actor_user_id,target_user_id,event,scope_id,approval_reference) VALUES(p_approver,p_target,'role_granted',prior.id,p_reference);
 RETURN assignment;
END;
$grant$;

CREATE OR REPLACE FUNCTION portal_access.revoke_scope(p_actor integer,p_scope uuid,p_reference text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $revoke$
DECLARE target integer; org integer;
BEGIN
 SELECT a.user_id,s.organization_id INTO target,org FROM portal_access.scopes s JOIN portal_security.role_assignments a ON a.id=s.assignment_id WHERE s.id=p_scope;
 IF target IS NULL OR p_actor=target OR p_reference IS NULL OR length(btrim(p_reference)) NOT BETWEEN 8 AND 200
   OR p_reference~'[\r\n]' OR NOT portal_access.has_permission(p_actor,'role.grant','organization',org::text) THEN
   RAISE EXCEPTION 'Founder approval required' USING ERRCODE='42501'; END IF;
 PERFORM 1 FROM portal_security.account_states WHERE user_id=p_actor FOR SHARE;
 PERFORM 1 FROM portal_security.account_states WHERE user_id=target FOR UPDATE;
 IF NOT portal_access.has_permission(p_actor,'role.grant','organization',org::text) THEN
   RAISE EXCEPTION 'Current founder approval required' USING ERRCODE='42501'; END IF;
 UPDATE portal_access.scopes SET active=false WHERE id=p_scope AND active;
 IF NOT FOUND THEN RETURN false; END IF;
 UPDATE portal_security.account_states SET revision=revision+1 WHERE user_id=target;
 UPDATE portal_security.sessions SET revoked_at=clock_timestamp(),revoked_reason='account_changed' WHERE user_id=target AND revoked_at IS NULL;
 INSERT INTO portal_access.events(actor_user_id,target_user_id,event,scope_id,approval_reference) VALUES(p_actor,target,'scope_revoked',p_scope,p_reference);
 RETURN true;
END;
$revoke$;

CREATE OR REPLACE FUNCTION portal_access.read_resources(p_actor integer,p_id uuid DEFAULT NULL) RETURNS SETOF portal_access.resources
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $read$
 SELECT r.* FROM portal_access.resources r WHERE (p_id IS NULL OR r.id=p_id)
   AND portal_access.has_permission(p_actor,'resource.read','resource',r.id::text) ORDER BY r.updated_at DESC,r.id LIMIT 100
$read$;
CREATE OR REPLACE FUNCTION portal_access.write_resource(p_actor integer,p_id uuid,p_revision bigint,p_body text) RETURNS bigint
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $write$
DECLARE r portal_access.resources%ROWTYPE;
BEGIN
 PERFORM 1 FROM portal_security.account_states WHERE user_id=p_actor FOR SHARE;
 SELECT * INTO r FROM portal_access.resources WHERE id=p_id FOR UPDATE;
 IF p_body IS NULL OR octet_length(p_body)>16384 OR r.id IS NULL OR r.status<>'draft' OR p_revision IS DISTINCT FROM r.revision
   OR NOT portal_access.has_permission(p_actor,'resource.edit','resource',p_id::text) THEN RAISE EXCEPTION 'Resource change unavailable' USING ERRCODE='42501'; END IF;
 UPDATE portal_access.resources SET body=p_body,revision=revision+1,updated_at=clock_timestamp() WHERE id=p_id RETURNING revision INTO r.revision;
 INSERT INTO portal_access.events(actor_user_id,event,resource_id) VALUES(p_actor,'resource_updated',p_id);RETURN r.revision;
END;
$write$;
CREATE OR REPLACE FUNCTION portal_access.review_resource(p_actor integer,p_id uuid,p_body text) RETURNS uuid
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $review$
DECLARE result uuid;
BEGIN
 PERFORM 1 FROM portal_security.account_states WHERE user_id=p_actor FOR SHARE;
 IF p_body IS NULL OR length(btrim(p_body)) NOT BETWEEN 1 AND 4000
   OR NOT portal_access.has_permission(p_actor,'resource.review','resource',p_id::text) THEN RAISE EXCEPTION 'Review unavailable' USING ERRCODE='42501'; END IF;
 INSERT INTO portal_access.reviews(resource_id,actor_user_id,body) VALUES(p_id,p_actor,p_body) RETURNING id INTO result;
 INSERT INTO portal_access.events(actor_user_id,event,resource_id) VALUES(p_actor,'resource_reviewed',p_id);RETURN result;
END;
$review$;
CREATE OR REPLACE FUNCTION portal_access.publish_resource(p_actor integer,p_id uuid,p_revision bigint) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $publish$
DECLARE r portal_access.resources%ROWTYPE;
BEGIN
 PERFORM 1 FROM portal_security.account_states WHERE user_id=p_actor FOR SHARE;
 SELECT * INTO r FROM portal_access.resources WHERE id=p_id FOR UPDATE;
 IF r.id IS NULL OR r.status<>'draft' OR p_revision IS DISTINCT FROM r.revision
   OR NOT portal_access.has_permission(p_actor,'resource.publish','resource',p_id::text) THEN RAISE EXCEPTION 'Publication unavailable' USING ERRCODE='42501'; END IF;
 UPDATE portal_access.resources SET status='published',revision=revision+1,updated_at=clock_timestamp() WHERE id=p_id;
 INSERT INTO portal_access.events(actor_user_id,event,resource_id) VALUES(p_actor,'resource_published',p_id);RETURN true;
END;
$publish$;

-- No browser or runtime table DML in the new schema; all writes use bounded functions.
DO $grants$
DECLARE runtime_name text:=current_setting('epdg.access_runtime_role'); t text; relation record; column_names text;
BEGIN
 FOREACH t IN ARRAY ARRAY['schema_migrations','groups','group_memberships','resources','scopes','events','reviews'] LOOP
   EXECUTE format('ALTER TABLE portal_access.%I ENABLE ROW LEVEL SECURITY',t);
 END LOOP;
 REVOKE ALL ON ALL TABLES IN SCHEMA portal_access FROM PUBLIC;
 REVOKE ALL ON ALL FUNCTIONS IN SCHEMA portal_access FROM PUBLIC;
 EXECUTE format('REVOKE ALL ON ALL TABLES IN SCHEMA portal_access FROM %I',runtime_name);
 EXECUTE format('GRANT USAGE ON SCHEMA portal_access TO %I',runtime_name);
 EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA portal_access TO %I',runtime_name);
 EXECUTE format('GRANT SELECT ON portal_access.schema_migrations TO %I',runtime_name);
 DROP POLICY IF EXISTS access_runtime_ledger_select ON portal_access.schema_migrations;
 EXECUTE format('CREATE POLICY access_runtime_ledger_select ON portal_access.schema_migrations FOR SELECT TO %I USING(true)',runtime_name);
 EXECUTE format('GRANT USAGE ON SCHEMA core,epdg,portal_security TO %I',runtime_name);
 -- Replace historical broad server grants, including any column-specific DML.
 -- The preserved custom password/session service needs only the grants below.
 FOR relation IN SELECT n.nspname,c.relname,c.oid FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE n.nspname IN('core','epdg','portal_security') AND c.relkind IN('r','p') LOOP
   EXECUTE format('REVOKE ALL ON %I.%I FROM %I',relation.nspname,relation.relname,runtime_name);
   SELECT string_agg(quote_ident(attname),',') INTO column_names FROM pg_attribute WHERE attrelid=relation.oid AND attnum>0 AND NOT attisdropped;
   IF column_names IS NOT NULL THEN EXECUTE format('REVOKE ALL(%s) ON %I.%I FROM %I',column_names,relation.nspname,relation.relname,runtime_name); END IF;
 END LOOP;
 EXECUTE format('GRANT SELECT ON core.users,core.user_branch_roles,core.branches,epdg.users,epdg.intern_profiles,epdg.schools,epdg.companies,epdg.admins TO %I',runtime_name);
 EXECUTE format('GRANT UPDATE(password) ON core.users,epdg.users TO %I',runtime_name);
 -- Existing hosted EPDG identity/profile tables already enable RLS. Grants
 -- alone do not permit custom-server authentication under NOBYPASSRLS.
 FOR relation IN SELECT n.nspname,c.relname FROM pg_class c JOIN pg_namespace n ON n.oid=c.relnamespace
   WHERE (n.nspname='core' AND c.relname IN('users','user_branch_roles','branches'))
      OR (n.nspname='epdg' AND c.relname IN('users','intern_profiles','schools','companies','admins')) LOOP
   EXECUTE format('DROP POLICY IF EXISTS access_runtime_identity_select ON %I.%I',relation.nspname,relation.relname);
   EXECUTE format('CREATE POLICY access_runtime_identity_select ON %I.%I FOR SELECT TO %I USING(true)',relation.nspname,relation.relname,runtime_name);
   IF relation.relname='users' THEN
     EXECUTE format('DROP POLICY IF EXISTS access_runtime_password_update ON %I.%I',relation.nspname,relation.relname);
     EXECUTE format('CREATE POLICY access_runtime_password_update ON %I.%I FOR UPDATE TO %I USING(true) WITH CHECK(true)',relation.nspname,relation.relname,runtime_name);
   END IF;
 END LOOP;
 FOREACH t IN ARRAY ARRAY['account_states','memberships','sessions','recovery_tokens','audit_events','schema_migrations','role_assignments','admin_events'] LOOP
   EXECUTE format('REVOKE ALL ON portal_security.%I FROM %I',t,runtime_name);
   EXECUTE format('GRANT SELECT ON portal_security.%I TO %I',t,runtime_name);
   EXECUTE format('DROP POLICY IF EXISTS access_runtime_select ON portal_security.%I',t);
   EXECUTE format('CREATE POLICY access_runtime_select ON portal_security.%I FOR SELECT TO %I USING(true)',t,runtime_name);
 END LOOP;
 EXECUTE format('GRANT UPDATE(revision) ON portal_security.account_states TO %I',runtime_name);
 DROP POLICY IF EXISTS access_runtime_revision ON portal_security.account_states;
 EXECUTE format('CREATE POLICY access_runtime_revision ON portal_security.account_states FOR UPDATE TO %I USING(true) WITH CHECK(true)',runtime_name);
 FOREACH t IN ARRAY ARRAY['sessions','recovery_tokens'] LOOP
   EXECUTE format('GRANT INSERT,UPDATE ON portal_security.%I TO %I',t,runtime_name);
   EXECUTE format('DROP POLICY IF EXISTS access_runtime_insert ON portal_security.%I',t);
   EXECUTE format('CREATE POLICY access_runtime_insert ON portal_security.%I FOR INSERT TO %I WITH CHECK(true)',t,runtime_name);
   EXECUTE format('DROP POLICY IF EXISTS access_runtime_update ON portal_security.%I',t);
   EXECUTE format('CREATE POLICY access_runtime_update ON portal_security.%I FOR UPDATE TO %I USING(true) WITH CHECK(true)',t,runtime_name);
 END LOOP;
 EXECUTE format('GRANT INSERT ON portal_security.audit_events TO %I',runtime_name);
 DROP POLICY IF EXISTS access_runtime_audit_insert ON portal_security.audit_events;
 EXECUTE format('CREATE POLICY access_runtime_audit_insert ON portal_security.audit_events FOR INSERT TO %I WITH CHECK(true)',runtime_name);
END;
$grants$;
