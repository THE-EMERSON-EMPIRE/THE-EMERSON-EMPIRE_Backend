-- Additive portable account release candidate. No identities, grants, target
-- approvals or invitations are seeded. Apply only with the reviewed migrator.
DO $preflight$
BEGIN
 IF current_user IS DISTINCT FROM current_setting('epdg.access_migrator_role',true)
 OR to_regclass('portal_access.scopes') IS NULL THEN RAISE EXCEPTION 'Reviewed access migration is required'; END IF;
END;$preflight$;
CREATE SCHEMA IF NOT EXISTS portal_accounts;
REVOKE ALL ON SCHEMA portal_accounts FROM PUBLIC;
CREATE TABLE IF NOT EXISTS portal_accounts.schema_migrations(version text PRIMARY KEY,sha256 text NOT NULL CHECK(sha256~'^[0-9a-f]{64}$'),applied_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE IF NOT EXISTS portal_accounts.release_control(
 singleton boolean PRIMARY KEY DEFAULT true CHECK(singleton),target_id text NOT NULL,approval_ref text NOT NULL,
 enabled boolean NOT NULL DEFAULT false,mail_enabled boolean NOT NULL DEFAULT false,batch_approval_ref text,
 bound_database text NOT NULL,bound_runtime_role text NOT NULL,synthetic_only boolean NOT NULL DEFAULT true
);
CREATE TABLE IF NOT EXISTS portal_accounts.provisioning_plans(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id integer NOT NULL REFERENCES epdg.companies(id),
 email text NOT NULL CHECK(email=lower(btrim(email)) AND length(email)<=150),name text NOT NULL CHECK(length(name) BETWEEN 1 AND 100),
 roles jsonb NOT NULL CHECK(jsonb_typeof(roles)='array' AND jsonb_array_length(roles) BETWEEN 1 AND 16),
 payload_hash text NOT NULL,revision bigint NOT NULL DEFAULT 1,
 status text NOT NULL DEFAULT 'proposed' CHECK(status IN ('proposed','approved','provisioned','blocked')),
 onboarding_status text NOT NULL CHECK(onboarding_status IN ('required','verified','not_required')),
 onboarding_verified_by integer REFERENCES core.users(id),onboarding_evidence_ref text,
 created_by integer NOT NULL REFERENCES core.users(id),approved_by integer REFERENCES core.users(id),approved_revision bigint,approved_hash text,
 user_id integer REFERENCES core.users(id),identity_action text CHECK(identity_action IN ('created','reused')),
 conflict_code text,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),approved_at timestamptz,provisioned_at timestamptz,
 CHECK((approved_by IS NULL)=(approved_hash IS NULL)),CHECK((approved_by IS NULL)=(approved_revision IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS account_plan_open_email ON portal_accounts.provisioning_plans(email) WHERE status IN ('proposed','approved');
CREATE TABLE IF NOT EXISTS portal_accounts.invitations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),plan_id uuid NOT NULL REFERENCES portal_accounts.provisioning_plans(id),user_id integer NOT NULL REFERENCES core.users(id),
 email text NOT NULL,token_hash text UNIQUE CHECK(token_hash~'^[0-9a-f]{64}$'),credential_hash text,account_revision bigint,
 status text NOT NULL DEFAULT 'prepared' CHECK(status IN ('prepared','pending','accepted','revoked')),
 delivery_status text NOT NULL DEFAULT 'not_sent' CHECK(delivery_status IN ('not_sent','sending','provider_accepted','failed','unknown')),
 attempt_id uuid,provider_id text,expires_at timestamptz,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),sent_at timestamptz,
 accepted_at timestamptz,email_confirmed_at timestamptz,activated_at timestamptz,last_error_code text,
 CHECK((status='accepted')=(accepted_at IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS account_invitation_current_user ON portal_accounts.invitations(user_id) WHERE status IN ('prepared','pending','accepted');
CREATE TABLE IF NOT EXISTS portal_accounts.audit_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),organization_id integer NOT NULL REFERENCES epdg.companies(id),
 event text NOT NULL,actor_user_id integer REFERENCES core.users(id),target_user_id integer REFERENCES core.users(id),
 plan_id uuid REFERENCES portal_accounts.provisioning_plans(id),invitation_id uuid REFERENCES portal_accounts.invitations(id),
 created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE FUNCTION portal_accounts.release_allowed(p_target text,p_approval text,p_mail boolean,p_batch text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM portal_accounts.release_control c WHERE c.singleton AND c.enabled
 AND c.target_id=p_target AND c.approval_ref=p_approval AND c.bound_database=current_database()
 AND c.bound_runtime_role=session_user AND (NOT p_mail OR (c.mail_enabled AND c.batch_approval_ref=p_batch)));
$$;
CREATE OR REPLACE FUNCTION portal_accounts.ready() RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NOT EXISTS(SELECT 1 FROM portal_accounts.release_control c WHERE c.enabled AND c.bound_database=current_database() AND c.bound_runtime_role=session_user)
 THEN RAISE EXCEPTION 'Account release unavailable' USING ERRCODE='P0503'; END IF;
END;$$;
CREATE OR REPLACE FUNCTION portal_accounts.can_manage(p_actor integer,p_org integer,p_roles jsonb,p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT coalesce(jsonb_typeof(p_roles)='array' AND jsonb_array_length(p_roles)>0
 AND portal_access.has_permission(p_actor,p_permission,'organization',p_org::text)
 AND (NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_roles) r WHERE r->>'role_code' NOT IN ('participant','intern_team_lead'))
   OR portal_access.has_permission(p_actor,'admin.accounts.manage_staff','organization',p_org::text))
 AND (NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_roles) r WHERE r->>'role_code' IN ('founder_owner','organization_admin','hr_admin'))
   OR portal_access.has_permission(p_actor,'admin.accounts.approve','organization',p_org::text)),false);
$$;
-- Plans describe approved intent; never use their old role list to downgrade a
-- target's CURRENT protection when its roles later change.
CREATE OR REPLACE FUNCTION portal_accounts.can_manage_target(p_actor integer,p_target integer,p_org integer,p_roles jsonb,p_permission text) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT portal_accounts.can_manage(p_actor,p_org,p_roles,p_permission)
 AND (p_target IS NULL OR (
   (p_permission IN('admin.accounts.read','admin.audit.read') OR p_actor<>p_target)
   AND (NOT EXISTS(SELECT 1 FROM portal_security.role_assignments a WHERE a.user_id=p_target AND a.status='active'
       AND a.role_code IN('founder_owner','founder_admin','organization_admin','hr_admin'))
     OR portal_access.has_permission(p_actor,'admin.accounts.approve','organization',p_org::text))
   AND (NOT EXISTS(SELECT 1 FROM portal_security.role_assignments a WHERE a.user_id=p_target AND a.status='active'
       AND a.role_code NOT IN('participant','intern_team_lead'))
     OR portal_access.has_permission(p_actor,'admin.accounts.manage_staff','organization',p_org::text))
   AND (NOT EXISTS(SELECT 1 FROM core.user_branch_roles b WHERE b.user_id=p_target AND b.role_name::text='admin')
     OR portal_access.has_permission(p_actor,'admin.accounts.manage_staff','organization',p_org::text))
 ));
$$;
CREATE OR REPLACE FUNCTION portal_accounts.scopes_in_organization(p_org integer,p_roles jsonb) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p_roles) r WHERE NOT coalesce(CASE r->>'scope_type'
   WHEN 'organization' THEN r->>'scope_id'=p_org::text
   WHEN 'group' THEN EXISTS(SELECT 1 FROM portal_access.groups g WHERE g.id::text=r->>'scope_id' AND g.organization_id=p_org)
   WHEN 'resource' THEN EXISTS(SELECT 1 FROM portal_access.resources x WHERE x.id::text=r->>'scope_id' AND x.organization_id=p_org)
   WHEN 'self' THEN r->>'scope_id'='self' ELSE false END,false));
$$;
CREATE OR REPLACE FUNCTION portal_accounts.plan_current(p_id uuid) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM portal_accounts.provisioning_plans p
   WHERE p.id=p_id AND p.status='provisioned' AND p.user_id IS NOT NULL
   AND p.approved_hash=p.payload_hash AND p.approved_revision=p.revision
   AND portal_accounts.scopes_in_organization(p.organization_id,p.roles)
   AND portal_access.has_permission(p.approved_by,'admin.accounts.approve','organization',p.organization_id::text)
   AND (p.onboarding_status='not_required' AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.roles) r WHERE r->>'role_code' IN('participant','intern_team_lead'))
     OR p.onboarding_status='verified' AND p.onboarding_verified_by IS NOT NULL AND length(btrim(p.onboarding_evidence_ref))>=8)
   AND EXISTS(SELECT 1 FROM portal_security.memberships m WHERE m.user_id=p.user_id AND m.company_id=p.organization_id AND m.active)
   AND EXISTS(SELECT 1 FROM epdg.companies c WHERE c.id=p.organization_id AND c.is_approved AND c.deleted_at IS NULL)
   AND NOT EXISTS(SELECT 1 FROM jsonb_array_elements(p.roles) r WHERE NOT EXISTS(
     SELECT 1 FROM portal_security.role_assignments a JOIN portal_access.scopes s ON s.assignment_id=a.id
     WHERE a.user_id=p.user_id AND a.role_code=r->>'role_code' AND a.status='active' AND s.active AND s.organization_id=p.organization_id
       AND s.scope_type=r->>'scope_type' AND s.scope_id=CASE WHEN r->>'scope_type'='self' AND r->>'scope_id'='self' THEN p.user_id::text ELSE r->>'scope_id' END
       AND (s.scope_type<>'group' OR EXISTS(SELECT 1 FROM portal_access.group_memberships gm WHERE gm.group_id::text=s.scope_id AND gm.user_id=p.user_id AND gm.active))
   )));
$$;
CREATE OR REPLACE FUNCTION portal_accounts.identity_conflict(p_email text) RETURNS text
LANGUAGE plpgsql STABLE SECURITY DEFINER SET search_path='' AS $$
DECLARE core_ids integer[];mirror_ids integer[];target integer;
BEGIN
 SELECT array_agg(id ORDER BY id) INTO core_ids FROM core.users WHERE lower(btrim(email))=p_email;
 SELECT array_agg(id ORDER BY id) INTO mirror_ids FROM epdg.users WHERE lower(btrim(email))=p_email;
 IF coalesce(cardinality(core_ids),0)>1 OR coalesce(cardinality(mirror_ids),0)>1 THEN RETURN 'duplicate_email'; END IF;
 IF core_ids IS NULL AND mirror_ids IS NULL THEN RETURN NULL; END IF;
 IF core_ids IS DISTINCT FROM mirror_ids THEN RETURN 'identity_mirror_conflict'; END IF;
 target:=core_ids[1];
 IF EXISTS(SELECT 1 FROM core.users cu JOIN epdg.users eu ON eu.id=cu.id WHERE cu.id=target AND (cu.deleted_at IS NOT NULL OR eu.deleted_at IS NOT NULL OR eu.rejection_reason IS NOT NULL)) THEN RETURN 'inactive_or_rejected_identity'; END IF;
 IF EXISTS(SELECT 1 FROM core.user_branch_roles r JOIN core.branches b ON b.id=r.branch_id WHERE r.user_id=target AND b.code='epdg' AND r.rejection_reason IS NOT NULL) THEN RETURN 'rejected_branch'; END IF;
 RETURN NULL;
END;$$;
CREATE OR REPLACE FUNCTION portal_accounts.propose(p_actor integer,p_org integer,p_email text,p_name text,p_roles jsonb) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE result portal_accounts.provisioning_plans%ROWTYPE;entry jsonb;digest text;conflict text;needs_hr boolean;
BEGIN
 PERFORM portal_accounts.ready();
 IF p_email IS NULL OR p_email<>lower(trim(p_email)) OR p_email !~ '^[a-z0-9.!#$%&''*+/=?^_`{|}~-]+@[a-z0-9][a-z0-9.-]*\.[a-z]{2,}$'
 OR length(p_email)>150 OR p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 100
 OR jsonb_typeof(p_roles) IS DISTINCT FROM 'array' OR jsonb_array_length(p_roles) NOT BETWEEN 1 AND 16 THEN RAISE EXCEPTION 'Invalid account plan' USING ERRCODE='P0400'; END IF;
 IF (SELECT synthetic_only FROM portal_accounts.release_control WHERE singleton) AND (p_email !~ '@[a-z0-9.-]+\.invalid$' OR p_name NOT LIKE 'SYNTHETIC %') THEN RAISE EXCEPTION 'Synthetic identity required' USING ERRCODE='P0400'; END IF;
 FOR entry IN SELECT value FROM jsonb_array_elements(p_roles) LOOP
  IF jsonb_typeof(entry) IS DISTINCT FROM 'object' THEN RAISE EXCEPTION 'Invalid role scope' USING ERRCODE='P0400'; END IF;
  IF (SELECT count(*) FROM jsonb_object_keys(entry))<>3 OR NOT(entry ?& ARRAY['role_code','scope_type','scope_id'])
  OR jsonb_typeof(entry->'role_code') IS DISTINCT FROM 'string' OR jsonb_typeof(entry->'scope_type') IS DISTINCT FROM 'string' OR jsonb_typeof(entry->'scope_id') IS DISTINCT FROM 'string'
  OR entry->>'role_code' NOT IN ('founder_owner','organization_admin','hr_admin','technical_maintainer','program_coordinator','intern_team_lead','content_editor','sales_staff','global_outreach','restricted_viewer','participant')
  OR entry->>'scope_type' NOT IN ('organization','group','resource','self') OR length(entry->>'scope_id') NOT BETWEEN 1 AND 120
  OR (entry->>'scope_type'='organization' AND entry->>'scope_id'<>p_org::text)
  OR (entry->>'scope_type'='group' AND NOT EXISTS(SELECT 1 FROM portal_access.groups g WHERE g.id::text=entry->>'scope_id' AND g.organization_id=p_org))
  OR (entry->>'scope_type'='resource' AND NOT EXISTS(SELECT 1 FROM portal_access.resources r WHERE r.id::text=entry->>'scope_id' AND r.organization_id=p_org))
  OR (entry->>'scope_type'='self' AND entry->>'scope_id'<>'self')
  OR (entry->>'role_code' IN('founder_owner','organization_admin') AND entry->>'scope_type'<>'organization')
  OR (entry->>'role_code'='restricted_viewer' AND entry->>'scope_type'<>'resource')
  OR (entry->>'scope_type'='organization' AND entry->>'role_code' NOT IN('founder_owner','organization_admin','hr_admin'))
  OR (entry->>'scope_type'='self' AND entry->>'role_code' NOT IN('participant','intern_team_lead'))
  THEN RAISE EXCEPTION 'Invalid role scope' USING ERRCODE='P0400'; END IF;
 END LOOP;
 IF NOT portal_accounts.can_manage_target(p_actor,(SELECT id FROM core.users WHERE lower(btrim(email))=p_email ORDER BY id LIMIT 1),p_org,p_roles,'admin.accounts.prepare') OR EXISTS(SELECT 1 FROM core.users WHERE id=p_actor AND lower(btrim(email))=p_email)
 THEN RAISE EXCEPTION 'Account plan permission required' USING ERRCODE='P0403'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('epdg-plan:'||p_email,0));
 digest:=encode(sha256(convert_to(jsonb_build_object('organization_id',p_org,'email',p_email,'name',trim(p_name),'roles',p_roles)::text,'UTF8')),'hex');
 SELECT * INTO result FROM portal_accounts.provisioning_plans WHERE email=p_email ORDER BY created_at DESC LIMIT 1 FOR UPDATE;
 IF result.id IS NOT NULL AND result.payload_hash=digest THEN RETURN to_jsonb(result); END IF;
 IF result.id IS NOT NULL AND result.status IN ('proposed','approved') THEN RAISE EXCEPTION 'An existing plan requires reconciliation' USING ERRCODE='P0409'; END IF;
 conflict:=portal_accounts.identity_conflict(p_email);
 needs_hr:=EXISTS(SELECT 1 FROM jsonb_array_elements(p_roles) r WHERE r->>'role_code' IN ('participant','intern_team_lead'));
 INSERT INTO portal_accounts.provisioning_plans(organization_id,email,name,roles,payload_hash,created_by,onboarding_status,status,conflict_code)
 VALUES(p_org,p_email,trim(p_name),p_roles,digest,p_actor,CASE WHEN needs_hr THEN 'required' ELSE 'not_required' END,CASE WHEN conflict IS NULL THEN 'proposed' ELSE 'blocked' END,conflict) RETURNING * INTO result;
 INSERT INTO portal_accounts.audit_events(organization_id,event,actor_user_id,plan_id) VALUES(p_org,'plan_proposed',p_actor,result.id);
 RETURN to_jsonb(result);
END;$$;
CREATE OR REPLACE FUNCTION portal_accounts.review_plan(p_actor integer,p_id uuid,p_revision bigint,p_action text,p_evidence text DEFAULT NULL) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE plan portal_accounts.provisioning_plans%ROWTYPE;
BEGIN
 PERFORM portal_accounts.ready();SELECT * INTO plan FROM portal_accounts.provisioning_plans WHERE id=p_id FOR UPDATE;
 IF plan.id IS NULL OR plan.status<>'proposed' OR plan.revision IS DISTINCT FROM p_revision THEN RAISE EXCEPTION 'Plan changed or unavailable' USING ERRCODE='P0409'; END IF;
 IF NOT portal_accounts.scopes_in_organization(plan.organization_id,plan.roles) THEN RAISE EXCEPTION 'Plan scope requires reconciliation' USING ERRCODE='P0409'; END IF;
 IF NOT portal_accounts.can_manage_target(p_actor,(SELECT id FROM core.users WHERE lower(btrim(email))=plan.email ORDER BY id LIMIT 1),plan.organization_id,plan.roles,CASE WHEN p_action='verify_onboarding' THEN 'onboarding.verify' ELSE 'admin.accounts.approve' END)
 OR EXISTS(SELECT 1 FROM core.users WHERE id=p_actor AND lower(btrim(email))=plan.email) THEN RAISE EXCEPTION 'Plan approval permission required' USING ERRCODE='P0403'; END IF;
 IF p_action='verify_onboarding' THEN
  IF plan.onboarding_status='not_required' OR p_evidence IS NULL OR p_evidence !~ '^[A-Za-z0-9][A-Za-z0-9:_./-]{7,119}$' THEN RAISE EXCEPTION 'Verified CRM reference required' USING ERRCODE='P0400'; END IF;
  UPDATE portal_accounts.provisioning_plans SET onboarding_status='verified',onboarding_verified_by=p_actor,onboarding_evidence_ref=p_evidence,revision=revision+1 WHERE id=p_id RETURNING * INTO plan;
 ELSIF p_action='approve' THEN
  IF plan.onboarding_status='required' OR portal_accounts.identity_conflict(plan.email) IS NOT NULL THEN RAISE EXCEPTION 'Identity and onboarding review required' USING ERRCODE='P0409'; END IF;
  UPDATE portal_accounts.provisioning_plans SET status='approved',approved_by=p_actor,approved_revision=revision,approved_hash=payload_hash,approved_at=clock_timestamp() WHERE id=p_id RETURNING * INTO plan;
 ELSE RAISE EXCEPTION 'Invalid review action' USING ERRCODE='P0400'; END IF;
 INSERT INTO portal_accounts.audit_events(organization_id,event,actor_user_id,plan_id) VALUES(plan.organization_id,'plan_'||p_action,p_actor,p_id);
 RETURN to_jsonb(plan);
END;$$;
CREATE OR REPLACE FUNCTION portal_accounts.provision(p_actor integer,p_id uuid,p_revision bigint,p_unusable_password text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE plan portal_accounts.provisioning_plans%ROWTYPE;target integer;branch integer;role_entry jsonb;legacy text;scope_id text;action text;counter integer:=0;
BEGIN
 PERFORM portal_accounts.ready();SELECT * INTO plan FROM portal_accounts.provisioning_plans WHERE id=p_id FOR UPDATE;
 IF plan.id IS NULL OR NOT portal_accounts.can_manage_target(p_actor,coalesce(plan.user_id,(SELECT id FROM core.users WHERE lower(btrim(email))=plan.email ORDER BY id LIMIT 1)),plan.organization_id,plan.roles,'admin.accounts.provision') THEN RAISE EXCEPTION 'Provisioning permission required' USING ERRCODE='P0403'; END IF;
 IF plan.status='provisioned' THEN RETURN to_jsonb(plan); END IF;
 IF plan.status<>'approved' OR plan.revision IS DISTINCT FROM p_revision OR plan.approved_revision IS DISTINCT FROM plan.revision OR plan.approved_hash IS DISTINCT FROM plan.payload_hash OR plan.onboarding_status='required'
 OR NOT portal_accounts.scopes_in_organization(plan.organization_id,plan.roles)
 OR NOT portal_access.has_permission(plan.approved_by,'admin.accounts.approve','organization',plan.organization_id::text)
 THEN RAISE EXCEPTION 'A current founder-approved plan is required' USING ERRCODE='P0409'; END IF;
 IF EXISTS(SELECT 1 FROM core.users WHERE id=p_actor AND lower(btrim(email))=plan.email) THEN RAISE EXCEPTION 'Self provisioning unavailable' USING ERRCODE='P0403'; END IF;
 PERFORM pg_advisory_xact_lock(hashtextextended('epdg-plan:'||plan.email,0));
 IF portal_accounts.identity_conflict(plan.email) IS NOT NULL THEN RAISE EXCEPTION 'Identity reconciliation required' USING ERRCODE='P0409'; END IF;
 SELECT id INTO branch FROM core.branches WHERE code='epdg';IF branch IS NULL THEN RAISE EXCEPTION 'EPDG branch unavailable' USING ERRCODE='P0503'; END IF;
 SELECT id INTO target FROM core.users WHERE lower(btrim(email))=plan.email;
 legacy:=CASE WHEN EXISTS(SELECT 1 FROM jsonb_array_elements(plan.roles) r WHERE r->>'role_code' NOT IN ('participant','intern_team_lead')) THEN 'admin' ELSE 'intern' END;
 IF target IS NULL THEN
  IF p_unusable_password IS NULL OR p_unusable_password !~ '^\$2[aby]\$12\$[./A-Za-z0-9]{53}$' THEN RAISE EXCEPTION 'Unusable credential required' USING ERRCODE='P0400'; END IF;
  PERFORM pg_advisory_xact_lock(hashtextextended('epdg-stable-user-id',0));
  LOOP
   target:=nextval(pg_get_serial_sequence('core.users','id'));counter:=counter+1;
   EXIT WHEN NOT EXISTS(SELECT 1 FROM core.users WHERE id=target) AND NOT EXISTS(SELECT 1 FROM epdg.users WHERE id=target);
   IF counter>10000 THEN RAISE EXCEPTION 'Identity sequence requires operator reconciliation' USING ERRCODE='P0409'; END IF;
  END LOOP;
  INSERT INTO core.users(id,email,name,password,is_verified) VALUES(target,plan.email,plan.name,p_unusable_password,false);
  INSERT INTO epdg.users(id,email,name,password,is_verified,role) VALUES(target,plan.email,plan.name,p_unusable_password,false,legacy::epdg.user_role);
  INSERT INTO core.user_branch_roles(user_id,branch_id,role_name) VALUES(target,branch,legacy::core.user_role);
  action:='created';
 ELSE
  IF NOT EXISTS(SELECT 1 FROM core.user_branch_roles WHERE user_id=target AND branch_id=branch) THEN
   INSERT INTO core.user_branch_roles(user_id,branch_id,role_name) VALUES(target,branch,legacy::core.user_role);
  END IF;
  action:='reused';
 END IF;
 INSERT INTO portal_security.account_states(user_id) VALUES(target) ON CONFLICT(user_id) DO NOTHING;
 PERFORM 1 FROM portal_security.account_states WHERE user_id=target FOR UPDATE;
 IF NOT portal_accounts.can_manage_target(p_actor,target,plan.organization_id,plan.roles,'admin.accounts.provision') THEN RAISE EXCEPTION 'Target authority changed' USING ERRCODE='P0403'; END IF;
 IF NOT EXISTS(SELECT 1 FROM portal_security.memberships WHERE user_id=target AND company_id=plan.organization_id) THEN
  INSERT INTO portal_security.memberships(user_id,company_id,active) VALUES(target,plan.organization_id,true);
 ELSIF NOT EXISTS(SELECT 1 FROM portal_security.memberships WHERE user_id=target AND company_id=plan.organization_id AND active) THEN
  RAISE EXCEPTION 'Existing disabled membership requires review' USING ERRCODE='P0409';
 END IF;
 IF plan.onboarding_status='verified' AND NOT EXISTS(SELECT 1 FROM epdg.intern_profiles WHERE user_id=target) THEN
  INSERT INTO epdg.intern_profiles(user_id,is_approved) VALUES(target,true);
 END IF;
 FOR role_entry IN SELECT value FROM jsonb_array_elements(plan.roles) LOOP
  scope_id:=CASE WHEN role_entry->>'scope_type'='self' AND role_entry->>'scope_id'='self' THEN target::text ELSE role_entry->>'scope_id' END;
  PERFORM portal_access.grant_role(plan.approved_by,target,role_entry->>'role_code',role_entry->>'scope_type',scope_id,'account-plan/'||plan.id::text||'/'||plan.payload_hash);
 END LOOP;
 UPDATE portal_security.account_states SET revision=revision+1 WHERE user_id=target;
 UPDATE portal_security.sessions SET revoked_at=clock_timestamp(),revoked_reason='account_changed' WHERE user_id=target AND revoked_at IS NULL;
 UPDATE portal_accounts.provisioning_plans SET status='provisioned',user_id=target,identity_action=action,provisioned_at=clock_timestamp() WHERE id=p_id RETURNING * INTO plan;
 INSERT INTO portal_accounts.audit_events(organization_id,event,actor_user_id,target_user_id,plan_id) VALUES(plan.organization_id,'account_'||action,p_actor,target,p_id);
 RETURN to_jsonb(plan);
END;$$;
CREATE OR REPLACE FUNCTION portal_accounts.prepare_invitation(p_actor integer,p_target integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE plan portal_accounts.provisioning_plans%ROWTYPE;inv portal_accounts.invitations%ROWTYPE;
BEGIN
 PERFORM portal_accounts.ready();SELECT * INTO plan FROM portal_accounts.provisioning_plans WHERE user_id=p_target AND status='provisioned' ORDER BY provisioned_at DESC LIMIT 1;
 IF plan.id IS NULL OR p_actor IS NULL OR p_target IS NULL OR p_actor=p_target OR NOT portal_accounts.can_manage_target(p_actor,p_target,plan.organization_id,plan.roles,'admin.accounts.prepare') THEN RAISE EXCEPTION 'Invitation permission required' USING ERRCODE='P0403'; END IF;
 PERFORM 1 FROM portal_security.account_states WHERE user_id=p_target FOR UPDATE;
 IF NOT portal_accounts.can_manage_target(p_actor,p_target,plan.organization_id,plan.roles,'admin.accounts.prepare') THEN RAISE EXCEPTION 'Target authority changed' USING ERRCODE='P0403'; END IF;
 SELECT * INTO inv FROM portal_accounts.invitations WHERE user_id=p_target AND status IN ('prepared','pending','accepted') FOR UPDATE;
 IF inv.id IS NOT NULL THEN RETURN to_jsonb(inv)-'token_hash'-'credential_hash'; END IF;
 IF NOT portal_accounts.plan_current(plan.id) THEN RAISE EXCEPTION 'Current approved scopes required' USING ERRCODE='P0409'; END IF;
 IF EXISTS(SELECT 1 FROM portal_security.account_states WHERE user_id=p_target AND active) THEN RAISE EXCEPTION 'Existing active account does not need activation' USING ERRCODE='P0409'; END IF;
 INSERT INTO portal_accounts.invitations(plan_id,user_id,email) VALUES(plan.id,p_target,plan.email) RETURNING * INTO inv;
 INSERT INTO portal_accounts.audit_events(organization_id,event,actor_user_id,target_user_id,plan_id,invitation_id) VALUES(plan.organization_id,'invitation_prepared',p_actor,p_target,plan.id,inv.id);
 RETURN to_jsonb(inv)-'token_hash'-'credential_hash';
END;$$;
CREATE OR REPLACE FUNCTION portal_accounts.dispatch(p_actor integer,p_id uuid,p_hash text,p_resend boolean) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE inv portal_accounts.invitations%ROWTYPE;plan portal_accounts.provisioning_plans%ROWTYPE;state portal_security.account_states%ROWTYPE;password text;
BEGIN
 PERFORM portal_accounts.ready();
 IF p_resend IS NULL THEN RAISE EXCEPTION 'Explicit dispatch operation required' USING ERRCODE='P0400'; END IF;
 IF NOT EXISTS(SELECT 1 FROM portal_accounts.release_control WHERE mail_enabled) THEN RAISE EXCEPTION 'Mail release unavailable' USING ERRCODE='P0503'; END IF;
 SELECT * INTO inv FROM portal_accounts.invitations WHERE id=p_id;
 IF inv.id IS NULL THEN RAISE EXCEPTION 'Invitation unavailable' USING ERRCODE='P0404'; END IF;
 SELECT * INTO state FROM portal_security.account_states WHERE user_id=inv.user_id FOR UPDATE;
 SELECT * INTO inv FROM portal_accounts.invitations WHERE id=p_id FOR UPDATE;
 SELECT * INTO plan FROM portal_accounts.provisioning_plans WHERE id=inv.plan_id;
 IF p_actor IS NULL OR p_actor=inv.user_id OR NOT portal_accounts.can_manage_target(p_actor,inv.user_id,plan.organization_id,plan.roles,'admin.invitations.send') THEN RAISE EXCEPTION 'Invitation permission required' USING ERRCODE='P0403'; END IF;
 IF NOT p_resend AND inv.status<>'prepared' THEN RETURN jsonb_build_object('reused',true,'invitation',to_jsonb(inv)-'token_hash'-'credential_hash'); END IF;
 IF inv.status IN ('accepted','revoked') OR state.active OR NOT portal_accounts.plan_current(plan.id)
 OR NOT portal_access.has_permission(plan.approved_by,'admin.accounts.approve','organization',plan.organization_id::text)
 OR portal_accounts.identity_conflict(inv.email) IS NOT NULL THEN RAISE EXCEPTION 'Invitation no longer eligible' USING ERRCODE='P0409'; END IF;
 IF p_resend AND (inv.sent_at IS NULL OR inv.sent_at>clock_timestamp()-interval '60 seconds') THEN RAISE EXCEPTION 'Wait before resending' USING ERRCODE='P0429'; END IF;
 IF p_hash IS NULL OR p_hash !~ '^[0-9a-f]{64}$' THEN RAISE EXCEPTION 'Invalid invitation proof' USING ERRCODE='P0400'; END IF;
 SELECT cu.password INTO password FROM core.users cu WHERE cu.id=inv.user_id;
 UPDATE portal_accounts.invitations SET status='pending',token_hash=p_hash,credential_hash=encode(sha256(convert_to(password,'UTF8')),'hex'),account_revision=state.revision,
  attempt_id=gen_random_uuid(),provider_id=NULL,delivery_status='sending',sent_at=clock_timestamp(),expires_at=clock_timestamp()+interval '24 hours',last_error_code=NULL
 WHERE id=p_id RETURNING * INTO inv;
 INSERT INTO portal_accounts.audit_events(organization_id,event,actor_user_id,target_user_id,plan_id,invitation_id) VALUES(plan.organization_id,CASE WHEN p_resend THEN 'invitation_resent' ELSE 'invitation_dispatched' END,p_actor,inv.user_id,plan.id,inv.id);
 RETURN jsonb_build_object('reused',false,'invitation',to_jsonb(inv)-'token_hash'-'credential_hash');
END;$$;
CREATE OR REPLACE FUNCTION portal_accounts.finish_delivery(p_id uuid,p_attempt uuid,p_status text,p_provider text) RETURNS void
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE inv portal_accounts.invitations%ROWTYPE;org integer;
BEGIN
 IF p_status IS NULL OR p_status NOT IN ('provider_accepted','failed','unknown') OR length(p_provider)>255 THEN RAISE EXCEPTION 'Invalid delivery result' USING ERRCODE='P0400'; END IF;
 UPDATE portal_accounts.invitations SET delivery_status=p_status,provider_id=p_provider,last_error_code=CASE WHEN p_status='failed' THEN 'provider_rejected' WHEN p_status='unknown' THEN 'delivery_uncertain' ELSE NULL END
 WHERE id=p_id AND attempt_id=p_attempt AND delivery_status='sending' RETURNING * INTO inv;
 IF inv.id IS NOT NULL THEN
  SELECT organization_id INTO org FROM portal_accounts.provisioning_plans WHERE id=inv.plan_id;
  INSERT INTO portal_accounts.audit_events(organization_id,event,target_user_id,plan_id,invitation_id) VALUES(org,'invitation_'||p_status,inv.user_id,inv.plan_id,inv.id);
 END IF;
END;$$;
CREATE OR REPLACE FUNCTION portal_accounts.accept_invitation(p_proof text,p_password text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE inv portal_accounts.invitations%ROWTYPE;plan portal_accounts.provisioning_plans%ROWTYPE;state portal_security.account_states%ROWTYPE;identity core.users%ROWTYPE;
BEGIN
 PERFORM portal_accounts.ready();IF p_proof IS NULL OR p_password IS NULL OR p_proof !~ '^[0-9a-f]{64}$' OR p_password !~ '^\$2[aby]\$12\$[./A-Za-z0-9]{53}$' THEN RETURN false; END IF;
 SELECT * INTO inv FROM portal_accounts.invitations WHERE token_hash=p_proof;IF inv.id IS NULL THEN RETURN false; END IF;
 SELECT * INTO state FROM portal_security.account_states WHERE user_id=inv.user_id FOR UPDATE;
 SELECT * INTO identity FROM core.users WHERE id=inv.user_id FOR UPDATE;
 PERFORM 1 FROM epdg.users WHERE id=inv.user_id FOR UPDATE;
 SELECT * INTO inv FROM portal_accounts.invitations WHERE token_hash=p_proof FOR UPDATE;
 SELECT * INTO plan FROM portal_accounts.provisioning_plans WHERE id=inv.plan_id FOR SHARE;
 IF inv.id IS NULL OR inv.status<>'pending' OR inv.delivery_status='failed' OR inv.expires_at IS NULL OR inv.expires_at<=clock_timestamp()
 OR state.user_id IS NULL OR identity.id IS NULL OR state.active OR state.revision IS DISTINCT FROM inv.account_revision OR identity.deleted_at IS NOT NULL OR lower(btrim(identity.email)) IS DISTINCT FROM inv.email
 OR inv.credential_hash IS DISTINCT FROM encode(sha256(convert_to(identity.password,'UTF8')),'hex') OR portal_accounts.identity_conflict(inv.email) IS NOT NULL
 OR NOT portal_accounts.plan_current(plan.id)
 THEN RETURN false; END IF;
 UPDATE core.users SET password=p_password,is_verified=true WHERE id=inv.user_id;
 UPDATE epdg.users SET password=p_password,is_verified=true WHERE id=inv.user_id;
 UPDATE portal_security.account_states SET active=true WHERE user_id=inv.user_id;
 UPDATE portal_security.sessions SET revoked_at=clock_timestamp(),revoked_reason='account_changed' WHERE user_id=inv.user_id AND revoked_at IS NULL;
 UPDATE portal_security.recovery_tokens SET revoked_at=clock_timestamp() WHERE user_id=inv.user_id AND consumed_at IS NULL AND revoked_at IS NULL;
 UPDATE portal_accounts.invitations SET status='accepted',email_confirmed_at=clock_timestamp(),accepted_at=clock_timestamp(),activated_at=clock_timestamp() WHERE id=inv.id;
 INSERT INTO portal_accounts.audit_events(organization_id,event,target_user_id,plan_id,invitation_id) VALUES(plan.organization_id,'invitation_accepted_and_account_activated',inv.user_id,plan.id,inv.id);
 RETURN true;
END;$$;
CREATE OR REPLACE FUNCTION portal_accounts.disable(p_actor integer,p_target integer,p_reason text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE plan portal_accounts.provisioning_plans%ROWTYPE;
BEGIN
 PERFORM portal_accounts.ready();SELECT * INTO plan FROM portal_accounts.provisioning_plans WHERE user_id=p_target AND status='provisioned' ORDER BY provisioned_at DESC LIMIT 1;
 IF p_actor IS NULL OR p_target IS NULL OR p_actor=p_target OR plan.id IS NULL OR p_reason IS DISTINCT FROM 'access_review' OR NOT portal_accounts.can_manage_target(p_actor,p_target,plan.organization_id,plan.roles,'admin.accounts.disable') THEN RAISE EXCEPTION 'Disable permission required' USING ERRCODE='P0403'; END IF;
 PERFORM 1 FROM portal_security.account_states WHERE user_id=p_target FOR UPDATE;
 IF NOT portal_accounts.can_manage_target(p_actor,p_target,plan.organization_id,plan.roles,'admin.accounts.disable') THEN RAISE EXCEPTION 'Target authority changed' USING ERRCODE='P0403'; END IF;
 UPDATE portal_security.account_states SET active=false WHERE user_id=p_target;
 UPDATE portal_accounts.invitations SET status='revoked' WHERE user_id=p_target AND status IN ('prepared','pending');
 UPDATE portal_security.sessions SET revoked_at=clock_timestamp(),revoked_reason='account_changed' WHERE user_id=p_target AND revoked_at IS NULL;
 UPDATE portal_security.recovery_tokens SET revoked_at=clock_timestamp() WHERE user_id=p_target AND consumed_at IS NULL AND revoked_at IS NULL;
 INSERT INTO portal_accounts.audit_events(organization_id,event,actor_user_id,target_user_id,plan_id) VALUES(plan.organization_id,'account_disabled',p_actor,p_target,plan.id);
 RETURN true;
END;$$;
CREATE OR REPLACE FUNCTION portal_accounts.update_profile(p_actor integer,p_name text) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 PERFORM portal_accounts.ready();IF p_name IS NULL OR length(trim(p_name)) NOT BETWEEN 1 AND 100 OR NOT portal_access.has_permission(p_actor,'account.self.update','user',p_actor::text) THEN RAISE EXCEPTION 'Profile change unavailable' USING ERRCODE='P0403'; END IF;
 IF (SELECT synthetic_only FROM portal_accounts.release_control) AND p_name NOT LIKE 'SYNTHETIC %' THEN RAISE EXCEPTION 'Synthetic display name required' USING ERRCODE='P0400'; END IF;
 UPDATE core.users SET name=trim(p_name) WHERE id=p_actor;UPDATE epdg.users SET name=trim(p_name) WHERE id=p_actor;
 RETURN (SELECT jsonb_build_object('id',id,'name',name,'email',email) FROM core.users WHERE id=p_actor);
END;$$;
CREATE OR REPLACE FUNCTION portal_accounts.management_snapshot(p_actor integer) RETURNS jsonb
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE plans jsonb;accounts jsonb;invitations jsonb;events jsonb;organizations jsonb;
BEGIN
 PERFORM portal_accounts.ready();
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',c.id,'name',c.company_name)),'[]') INTO organizations FROM epdg.companies c WHERE portal_access.has_permission(p_actor,'admin.accounts.read','organization',c.id::text);
 IF jsonb_array_length(organizations)=0 THEN RAISE EXCEPTION 'Account management permission required' USING ERRCODE='P0403'; END IF;
 SELECT coalesce(jsonb_agg(to_jsonb(p)-'onboarding_evidence_ref'-'payload_hash'-'approved_hash'||jsonb_build_object('existing_user_id',(SELECT cu.id FROM core.users cu WHERE lower(btrim(cu.email))=p.email ORDER BY id LIMIT 1),
 'allowed_actions',to_jsonb(array_remove(ARRAY[
   CASE WHEN p.status='proposed' AND p.onboarding_status<>'not_required' AND portal_accounts.can_manage_target(p_actor,p.user_id,p.organization_id,p.roles,'onboarding.verify') THEN 'verify_onboarding' END,
   CASE WHEN p.status='proposed' AND p.onboarding_status<>'required' AND portal_accounts.can_manage_target(p_actor,p.user_id,p.organization_id,p.roles,'admin.accounts.approve') THEN 'approve' END,
   CASE WHEN p.status='approved' AND portal_accounts.can_manage_target(p_actor,p.user_id,p.organization_id,p.roles,'admin.accounts.provision') THEN 'provision' END
 ],NULL)))),'[]') INTO plans
 FROM (SELECT * FROM portal_accounts.provisioning_plans pp WHERE portal_accounts.can_manage_target(p_actor,coalesce(pp.user_id,(SELECT id FROM core.users WHERE lower(btrim(email))=pp.email ORDER BY id LIMIT 1)),pp.organization_id,pp.roles,'admin.accounts.read') ORDER BY created_at DESC LIMIT 100) p;
 SELECT coalesce(jsonb_agg(jsonb_build_object('id',cu.id,'name',cu.name,'email',cu.email,'active',st.active,'roles',p.roles,'onboarding_status',p.onboarding_status,
 'last_successful_sign_in',(SELECT max(created_at) FROM portal_security.audit_events a WHERE a.user_id=cu.id AND a.event='login_succeeded'),
 'allowed_actions',to_jsonb(array_remove(ARRAY[
   CASE WHEN NOT st.active AND portal_accounts.plan_current(p.id) AND portal_accounts.can_manage_target(p_actor,cu.id,p.organization_id,p.roles,'admin.accounts.prepare') THEN 'prepare_invitation' END,
   CASE WHEN portal_accounts.can_manage_target(p_actor,cu.id,p.organization_id,p.roles,'admin.accounts.disable') THEN 'disable' END
 ],NULL)))),'[]') INTO accounts
 FROM (SELECT DISTINCT ON(user_id) * FROM portal_accounts.provisioning_plans pp WHERE user_id IS NOT NULL AND portal_accounts.can_manage_target(p_actor,pp.user_id,pp.organization_id,pp.roles,'admin.accounts.read') ORDER BY user_id,provisioned_at DESC LIMIT 100) p JOIN core.users cu ON cu.id=p.user_id JOIN portal_security.account_states st ON st.user_id=cu.id;
 SELECT coalesce(jsonb_agg((to_jsonb(i)-'token_hash'-'credential_hash')||jsonb_build_object('name',p.name,'status',CASE WHEN i.status='pending' AND i.expires_at<=clock_timestamp() THEN 'expired' ELSE i.status END,
 'last_successful_sign_in',(SELECT max(created_at) FROM portal_security.audit_events a WHERE a.user_id=i.user_id AND a.event='login_succeeded'),
 'allowed_actions',CASE WHEN portal_accounts.plan_current(p.id) AND portal_accounts.can_manage_target(p_actor,i.user_id,p.organization_id,p.roles,'admin.invitations.send')
   AND EXISTS(SELECT 1 FROM portal_accounts.release_control WHERE mail_enabled) THEN
   CASE WHEN i.status='prepared' THEN jsonb_build_array('send') WHEN i.status='pending' AND i.sent_at<=clock_timestamp()-interval '60 seconds' THEN jsonb_build_array('resend') ELSE '[]'::jsonb END
   ELSE '[]'::jsonb END)),'[]') INTO invitations
 FROM portal_accounts.invitations i JOIN portal_accounts.provisioning_plans p ON p.id=i.plan_id WHERE portal_accounts.can_manage_target(p_actor,i.user_id,p.organization_id,p.roles,'admin.accounts.read');
 SELECT coalesce(jsonb_agg(to_jsonb(a)),'[]') INTO events FROM (SELECT e.* FROM portal_accounts.audit_events e JOIN portal_accounts.provisioning_plans p ON p.id=e.plan_id
   WHERE portal_accounts.can_manage_target(p_actor,coalesce(e.target_user_id,p.user_id,(SELECT id FROM core.users WHERE lower(btrim(email))=p.email ORDER BY id LIMIT 1)),e.organization_id,p.roles,'admin.audit.read') ORDER BY e.created_at DESC LIMIT 100) a;
 RETURN jsonb_build_object('plans',plans,'accounts',accounts,'invitations',invitations,'audit',events,'organizations',organizations);
END;$$;
DO $grants$
DECLARE runtime_name text:=current_setting('epdg.access_runtime_role');table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['schema_migrations','release_control','provisioning_plans','invitations','audit_events'] LOOP
  EXECUTE format('ALTER TABLE portal_accounts.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('REVOKE ALL ON portal_accounts.%I FROM PUBLIC,%I',table_name,runtime_name);
 END LOOP;
 REVOKE ALL ON ALL FUNCTIONS IN SCHEMA portal_accounts FROM PUBLIC;
 EXECUTE format('GRANT USAGE ON SCHEMA portal_accounts TO %I',runtime_name);
 EXECUTE format('GRANT SELECT ON portal_accounts.schema_migrations TO %I',runtime_name);
 IF NOT EXISTS(SELECT 1 FROM pg_policies WHERE schemaname='portal_accounts' AND tablename='schema_migrations' AND policyname='account_manifest_runtime') THEN
  EXECUTE format('CREATE POLICY account_manifest_runtime ON portal_accounts.schema_migrations FOR SELECT TO %I USING(true)',runtime_name);
 END IF;
 EXECUTE format('GRANT EXECUTE ON ALL FUNCTIONS IN SCHEMA portal_accounts TO %I',runtime_name);
END;$grants$;
