-- Additive, manual operator migration. Creates no identity, organization, scope,
-- approval, invitation or release control. Existing reviewed migration bytes stand.
DO $boundary$
BEGIN
 IF current_user IS DISTINCT FROM current_setting('epdg.access_migrator_role',true)
 OR current_user=current_setting('epdg.access_runtime_role',true)
 OR to_regclass('portal_accounts.release_control') IS NULL THEN
  RAISE EXCEPTION 'Reviewed account migration and separate operator required';
 END IF;
END;$boundary$;
CREATE SCHEMA portal_bootstrap;
REVOKE ALL ON SCHEMA portal_bootstrap FROM PUBLIC;
CREATE TABLE portal_bootstrap.schema_migrations(version text PRIMARY KEY,sha256 text NOT NULL CHECK(sha256~'^[0-9a-f]{64}$'),applied_at timestamptz NOT NULL DEFAULT clock_timestamp());
CREATE TABLE portal_bootstrap.approvals(
 id uuid PRIMARY KEY,organization_id integer NOT NULL UNIQUE REFERENCES epdg.companies(id),
 user_id integer NOT NULL UNIQUE REFERENCES portal_security.account_states(user_id),
 plan_hash text NOT NULL UNIQUE CHECK(plan_hash~'^[0-9a-f]{64}$'),
 plan_text text NOT NULL CHECK(octet_length(plan_text)<65536),
 approval_hash text NOT NULL CHECK(approval_hash~'^[0-9a-f]{64}$'),approval_text text NOT NULL,
 operator_role name NOT NULL,target_id text NOT NULL,release_reference text NOT NULL,runtime_role name NOT NULL,
 email text NOT NULL CHECK(email=lower(btrim(email))),identity_action text NOT NULL CHECK(identity_action IN('reuse_existing','create_missing')),
 organization_hash text NOT NULL,membership_hash text NOT NULL,branch_hash text NOT NULL,
 expires_at timestamptz NOT NULL,created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
 CHECK(plan_hash=encode(sha256(convert_to(plan_text,'UTF8')),'hex')),
 CHECK(approval_hash=encode(sha256(convert_to(approval_text,'UTF8')),'hex'))
);
CREATE TABLE portal_bootstrap.revocations(
 approval_id uuid PRIMARY KEY REFERENCES portal_bootstrap.approvals(id),operator_role name NOT NULL,
 reason text NOT NULL CHECK(reason='access_review'),created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE portal_bootstrap.invitations(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),approval_id uuid NOT NULL UNIQUE REFERENCES portal_bootstrap.approvals(id),
 token_hash text UNIQUE CHECK(token_hash~'^[0-9a-f]{64}$'),credential_hash text,account_revision bigint,
 status text NOT NULL DEFAULT 'prepared' CHECK(status IN('prepared','pending','accepted','revoked')),
 delivery_status text NOT NULL DEFAULT 'not_sent' CHECK(delivery_status IN('not_sent','sending','provider_accepted','failed','unknown')),
 attempt_id uuid,provider_id text,expires_at timestamptz,sent_at timestamptz,
 accepted_at timestamptz,email_confirmed_at timestamptz,activated_at timestamptz,
 CHECK((status='accepted')=(accepted_at IS NOT NULL))
);
CREATE TABLE portal_bootstrap.audit_events(
 id uuid PRIMARY KEY DEFAULT gen_random_uuid(),approval_id uuid NOT NULL REFERENCES portal_bootstrap.approvals(id),
 event text NOT NULL CHECK(event IN('prepared','send_started','provider_accepted','failed','unknown','accepted','revoked')),
 operator_role name,attempt_id uuid,created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE FUNCTION portal_bootstrap.immutable_record() RETURNS trigger LANGUAGE plpgsql SET search_path='' AS $$
BEGIN RAISE EXCEPTION 'Operator approval and audit records are immutable'; END;$$;
CREATE TRIGGER bootstrap_approval_immutable BEFORE UPDATE OR DELETE ON portal_bootstrap.approvals FOR EACH ROW EXECUTE FUNCTION portal_bootstrap.immutable_record();
CREATE TRIGGER bootstrap_revocation_immutable BEFORE UPDATE OR DELETE ON portal_bootstrap.revocations FOR EACH ROW EXECUTE FUNCTION portal_bootstrap.immutable_record();
CREATE TRIGGER bootstrap_audit_immutable BEFORE UPDATE OR DELETE ON portal_bootstrap.audit_events FOR EACH ROW EXECUTE FUNCTION portal_bootstrap.immutable_record();
ALTER TABLE portal_access.scopes ALTER COLUMN approved_by_user_id DROP NOT NULL;
ALTER TABLE portal_access.scopes ADD COLUMN operator_approval_id uuid REFERENCES portal_bootstrap.approvals(id);
ALTER TABLE portal_access.scopes ADD CONSTRAINT access_scope_approval_provenance CHECK(num_nonnulls(approved_by_user_id,operator_approval_id)=1);
CREATE FUNCTION portal_bootstrap.validate_scope() RETURNS trigger LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
BEGIN
 IF NEW.operator_approval_id IS NOT NULL AND NOT EXISTS(
  SELECT 1 FROM portal_bootstrap.approvals b JOIN portal_security.role_assignments a ON a.user_id=b.user_id
  WHERE b.id=NEW.operator_approval_id AND a.id=NEW.assignment_id AND a.role_code='founder_owner'
  AND NEW.organization_id=b.organization_id AND NEW.scope_type='organization' AND NEW.scope_id=b.organization_id::text
  AND NEW.approved_by_user_id IS NULL AND NEW.approval_reference=b.plan_hash
 ) THEN RAISE EXCEPTION 'Bootstrap scope does not match immutable operator approval'; END IF;
 RETURN NEW;
END;$$;
CREATE TRIGGER bootstrap_scope_provenance BEFORE INSERT OR UPDATE ON portal_access.scopes FOR EACH ROW EXECUTE FUNCTION portal_bootstrap.validate_scope();
CREATE FUNCTION portal_bootstrap.current_approval(p_id uuid) RETURNS boolean LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $$
 SELECT EXISTS(SELECT 1 FROM portal_bootstrap.approvals b
 JOIN portal_accounts.release_control r ON r.target_id=b.target_id AND r.approval_ref=b.release_reference
 JOIN epdg.companies c ON c.id=b.organization_id
 WHERE b.id=p_id AND b.expires_at>clock_timestamp() AND r.enabled AND r.bound_database=current_database()
 AND r.bound_runtime_role=b.runtime_role AND c.is_approved AND c.deleted_at IS NULL
 AND encode(sha256(convert_to(to_jsonb(c)::text,'UTF8')),'hex')=b.organization_hash
 AND portal_accounts.identity_conflict(b.email) IS NULL
 AND EXISTS(SELECT 1 FROM core.users u JOIN epdg.users e ON e.id=u.id WHERE u.id=b.user_id
   AND lower(btrim(u.email))=b.email AND lower(btrim(e.email))=b.email AND u.password=e.password)
 AND NOT EXISTS(SELECT 1 FROM portal_bootstrap.revocations v WHERE v.approval_id=b.id)
 AND EXISTS(SELECT 1 FROM portal_security.memberships m WHERE m.user_id=b.user_id AND m.company_id=b.organization_id AND m.active
  AND encode(sha256(convert_to(to_jsonb(m)::text,'UTF8')),'hex')=b.membership_hash)
 AND EXISTS(SELECT 1 FROM core.user_branch_roles br JOIN core.branches branch ON branch.id=br.branch_id
  WHERE br.user_id=b.user_id AND branch.code='epdg' AND br.rejection_reason IS NULL
  AND encode(sha256(convert_to(to_jsonb(br)::text,'UTF8')),'hex')=b.branch_hash)
 AND EXISTS(SELECT 1 FROM portal_access.scopes s JOIN portal_security.role_assignments a ON a.id=s.assignment_id
  WHERE s.operator_approval_id=b.id AND a.user_id=b.user_id AND a.role_code='founder_owner' AND a.status='pending'
  AND NOT s.active AND s.organization_id=b.organization_id AND s.scope_type='organization' AND s.scope_id=b.organization_id::text)
 AND NOT EXISTS(SELECT 1 FROM portal_access.scopes s JOIN portal_security.role_assignments a ON a.id=s.assignment_id
  WHERE s.organization_id=b.organization_id AND a.role_code='founder_owner' AND a.status='active' AND s.active));
$$;
CREATE FUNCTION portal_bootstrap.accept_invitation(p_proof text,p_password text) RETURNS boolean LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $$
DECLARE inv portal_bootstrap.invitations%ROWTYPE;b portal_bootstrap.approvals%ROWTYPE;st portal_security.account_states%ROWTYPE;u core.users%ROWTYPE;
BEGIN
 PERFORM portal_accounts.ready();
 IF p_proof IS NULL OR p_password IS NULL OR p_proof !~ '^[0-9a-f]{64}$' OR p_password !~ '^\$2[aby]\$12\$[./A-Za-z0-9]{53}$' THEN RETURN false; END IF;
 SELECT * INTO inv FROM portal_bootstrap.invitations WHERE token_hash=p_proof;IF inv.id IS NULL THEN RETURN false; END IF;
 SELECT * INTO b FROM portal_bootstrap.approvals WHERE id=inv.approval_id;
 PERFORM pg_advisory_xact_lock(hashtextextended('epdg-founder-bootstrap:'||b.organization_id::text,0));
 SELECT * INTO st FROM portal_security.account_states WHERE user_id=b.user_id FOR UPDATE;
 SELECT * INTO u FROM core.users WHERE id=b.user_id FOR UPDATE;PERFORM 1 FROM epdg.users WHERE id=b.user_id FOR UPDATE;
 PERFORM 1 FROM epdg.companies WHERE id=b.organization_id FOR SHARE;
 PERFORM 1 FROM portal_security.memberships WHERE user_id=b.user_id FOR SHARE;
 PERFORM 1 FROM core.user_branch_roles WHERE user_id=b.user_id FOR SHARE;
 PERFORM 1 FROM portal_security.role_assignments WHERE user_id=b.user_id FOR UPDATE;
 PERFORM 1 FROM portal_access.scopes WHERE operator_approval_id=b.id FOR UPDATE;
 SELECT * INTO inv FROM portal_bootstrap.invitations WHERE id=inv.id FOR UPDATE;
 IF inv.token_hash IS DISTINCT FROM p_proof OR st.user_id IS NULL OR st.active OR u.id IS NULL OR inv.status<>'pending' OR inv.delivery_status='failed'
 OR inv.expires_at IS NULL OR inv.expires_at<=clock_timestamp() OR st.revision IS DISTINCT FROM inv.account_revision
 OR inv.credential_hash IS DISTINCT FROM encode(sha256(convert_to(u.password,'UTF8')),'hex')
 OR NOT portal_bootstrap.current_approval(b.id) THEN RETURN false; END IF;
 UPDATE core.users SET password=p_password,is_verified=true WHERE id=b.user_id;
 UPDATE epdg.users SET password=p_password,is_verified=true WHERE id=b.user_id;
 UPDATE portal_security.role_assignments SET status='active' WHERE user_id=b.user_id AND role_code='founder_owner' AND status='pending';
 UPDATE portal_access.scopes SET active=true WHERE operator_approval_id=b.id;
 UPDATE portal_security.account_states SET active=true WHERE user_id=b.user_id;
 UPDATE portal_security.sessions SET revoked_at=clock_timestamp(),revoked_reason='account_changed' WHERE user_id=b.user_id AND revoked_at IS NULL;
 UPDATE portal_security.recovery_tokens SET revoked_at=clock_timestamp() WHERE user_id=b.user_id AND consumed_at IS NULL AND revoked_at IS NULL;
 UPDATE portal_bootstrap.invitations SET status='accepted',accepted_at=clock_timestamp(),email_confirmed_at=clock_timestamp(),activated_at=clock_timestamp() WHERE id=inv.id;
 INSERT INTO portal_bootstrap.audit_events(approval_id,event) VALUES(b.id,'accepted');
 RETURN true;
END;$$;
DO $grants$
DECLARE runtime_name text:=current_setting('epdg.access_runtime_role');table_name text;
BEGIN
 FOREACH table_name IN ARRAY ARRAY['schema_migrations','approvals','revocations','invitations','audit_events'] LOOP
  EXECUTE format('ALTER TABLE portal_bootstrap.%I ENABLE ROW LEVEL SECURITY',table_name);
  EXECUTE format('REVOKE ALL ON portal_bootstrap.%I FROM PUBLIC,%I',table_name,runtime_name);
 END LOOP;
 REVOKE ALL ON ALL FUNCTIONS IN SCHEMA portal_bootstrap FROM PUBLIC;
 EXECUTE format('GRANT USAGE ON SCHEMA portal_bootstrap TO %I',runtime_name);
 EXECUTE format('GRANT SELECT ON portal_bootstrap.schema_migrations TO %I',runtime_name);
 EXECUTE format('CREATE POLICY bootstrap_manifest_runtime ON portal_bootstrap.schema_migrations FOR SELECT TO %I USING(true)',runtime_name);
 EXECUTE format('GRANT EXECUTE ON FUNCTION portal_bootstrap.accept_invitation(text,text) TO %I',runtime_name);
END;$grants$;
