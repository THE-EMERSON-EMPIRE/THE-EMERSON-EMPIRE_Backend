-- Local synthetic review only. No identities, approval evidence, or roles are seeded.
DO $boundary$
BEGIN
  IF current_database()<>'epdg_synthetic' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet
    OR inet_server_port() IS DISTINCT FROM 55432 OR NOT EXISTS (SELECT 1 FROM pg_namespace WHERE nspname='synthetic_meta') THEN
    RAISE EXCEPTION 'Invitation review requires the isolated local database';
  END IF;
END;
$boundary$;
CREATE SCHEMA IF NOT EXISTS portal_invitation_review;
REVOKE ALL ON SCHEMA portal_invitation_review FROM PUBLIC;
CREATE TABLE IF NOT EXISTS portal_invitation_review.schema_migrations (
  version text PRIMARY KEY, sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$')
);
CREATE TABLE IF NOT EXISTS portal_invitation_review.candidates (
  user_id integer PRIMARY KEY REFERENCES portal_security.account_states(user_id),
  verified_onboarding boolean NOT NULL DEFAULT false,
  approval_reference text NOT NULL CHECK (approval_reference LIKE 'SYNTHETIC %'),
  enabled boolean NOT NULL DEFAULT false
);
CREATE TABLE IF NOT EXISTS portal_invitation_review.invitations (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id integer NOT NULL REFERENCES portal_invitation_review.candidates(user_id),
  email text NOT NULL CHECK (email ~ '^[a-z0-9._+-]+@epdg\.invalid$'),
  role_code text NOT NULL CHECK (role_code='participant'),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  credential_hash text NOT NULL CHECK (credential_hash ~ '^[0-9a-f]{64}$'),
  account_revision bigint NOT NULL,
  created_by_user_id integer NOT NULL REFERENCES core.users(id),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','accepted','revoked')),
  delivery_status text NOT NULL DEFAULT 'sending' CHECK (delivery_status IN ('sending','sent','failed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  email_confirmed_at timestamptz,
  accepted_at timestamptz,
  CHECK (expires_at>created_at),
  CHECK ((status='accepted')=(accepted_at IS NOT NULL)),
  CHECK ((accepted_at IS NULL)=(email_confirmed_at IS NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS invitation_review_one_open
  ON portal_invitation_review.invitations(user_id) WHERE status IN ('pending','accepted');
CREATE TABLE IF NOT EXISTS portal_invitation_review.events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  invitation_id uuid NOT NULL REFERENCES portal_invitation_review.invitations(id),
  actor_user_id integer REFERENCES core.users(id),
  event text NOT NULL CHECK (event IN ('generated','delivery_sent','delivery_failed','revoked_for_resend','accepted')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE IF NOT EXISTS portal_invitation_review.operator_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id integer NOT NULL REFERENCES core.users(id),
  event text NOT NULL CHECK (event='access_disabled'),
  operator_role text NOT NULL,
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE OR REPLACE FUNCTION portal_invitation_review.eligible(target integer) RETURNS boolean
LANGUAGE sql STABLE SECURITY DEFINER SET search_path='' AS $eligible$
  SELECT current_database()='epdg_synthetic' AND inet_server_addr()='127.0.0.1'::inet AND inet_server_port()=55432
    AND EXISTS (SELECT 1 FROM portal_invitation_review.candidates c
      JOIN core.users cu ON cu.id=c.user_id JOIN epdg.users eu ON eu.id=cu.id
      JOIN portal_security.account_states st ON st.user_id=cu.id
      JOIN core.user_branch_roles role ON role.user_id=cu.id
      JOIN core.branches branch ON branch.id=role.branch_id AND branch.code='epdg'
      JOIN epdg.intern_profiles profile ON profile.user_id=cu.id
      WHERE c.user_id=target AND c.enabled AND c.verified_onboarding AND NOT st.active
        AND cu.email ~ '^[a-z0-9._+-]+@epdg\.invalid$' AND cu.name LIKE 'SYNTHETIC %'
        AND cu.email=eu.email AND cu.is_verified AND eu.is_verified
        AND cu.deleted_at IS NULL AND eu.deleted_at IS NULL AND eu.rejection_reason IS NULL
        AND role.rejection_reason IS NULL AND role.role_name::text='intern'
        AND profile.is_approved AND profile.rejection_reason IS NULL
        AND NOT EXISTS (SELECT 1 FROM portal_security.role_assignments a WHERE a.user_id=target AND a.status='active')
        AND EXISTS (SELECT 1 FROM portal_security.memberships m
          WHERE m.user_id=target AND m.active AND
            ((m.school_id IS NOT NULL AND EXISTS(SELECT 1 FROM epdg.schools s WHERE s.id=m.school_id AND s.is_approved AND s.deleted_at IS NULL))
            OR (m.company_id IS NOT NULL AND EXISTS(SELECT 1 FROM epdg.companies co WHERE co.id=m.company_id AND co.is_approved AND co.deleted_at IS NULL)))))
$eligible$;

-- Runtime cannot activate an account directly. This bounded function consumes a
-- single current invitation and rechecks operator approval and identity bindings.
CREATE OR REPLACE FUNCTION portal_invitation_review.accept(proof text, password_hash text) RETURNS boolean
LANGUAGE plpgsql SECURITY DEFINER SET search_path='' AS $accept$
DECLARE target integer; invitation portal_invitation_review.invitations%ROWTYPE;
DECLARE current_email text; current_password text; revision bigint;
BEGIN
  IF current_database()<>'epdg_synthetic' OR inet_server_addr() IS DISTINCT FROM '127.0.0.1'::inet OR inet_server_port() IS DISTINCT FROM 55432
    OR proof IS NULL OR password_hash IS NULL OR proof !~ '^[0-9a-f]{64}$' OR password_hash !~ '^\$2[aby]\$12\$[./A-Za-z0-9]{53}$' THEN RETURN false; END IF;
  SELECT user_id INTO target FROM portal_invitation_review.invitations WHERE token_hash=proof;
  IF target IS NULL THEN RETURN false; END IF;
  -- Match issuance/account locks before locking the token to avoid deadlocks.
  SELECT st.revision,cu.email,cu.password INTO revision,current_email,current_password
    FROM portal_security.account_states st JOIN core.users cu ON cu.id=st.user_id
    JOIN epdg.users eu ON eu.id=cu.id WHERE st.user_id=target FOR UPDATE OF st,cu,eu;
  PERFORM 1 FROM portal_invitation_review.candidates WHERE user_id=target FOR SHARE;
  SELECT * INTO invitation FROM portal_invitation_review.invitations WHERE token_hash=proof FOR UPDATE;
  IF revision IS NULL OR current_email IS NULL OR current_password IS NULL OR invitation.id IS NULL
    OR invitation.status<>'pending' OR invitation.delivery_status='failed' OR invitation.expires_at<=clock_timestamp()
    OR invitation.email<>current_email OR invitation.account_revision<>revision
    OR invitation.credential_hash<>encode(sha256(convert_to(current_password,'UTF8')),'hex')
    OR NOT portal_invitation_review.eligible(target) THEN RETURN false; END IF;
  UPDATE core.users SET password=password_hash WHERE id=target;
  UPDATE epdg.users SET password=password_hash WHERE id=target;
  UPDATE portal_security.account_states SET active=true WHERE user_id=target;
  UPDATE portal_security.sessions SET revoked_at=clock_timestamp(),revoked_reason='account_changed' WHERE user_id=target AND revoked_at IS NULL;
  UPDATE portal_security.recovery_tokens SET revoked_at=clock_timestamp() WHERE user_id=target AND consumed_at IS NULL AND revoked_at IS NULL;
  UPDATE portal_invitation_review.invitations SET status='accepted',email_confirmed_at=clock_timestamp(),accepted_at=clock_timestamp() WHERE id=invitation.id;
  INSERT INTO portal_invitation_review.events(invitation_id,event) VALUES(invitation.id,'accepted');
  RETURN true;
END;
$accept$;
ALTER TABLE portal_invitation_review.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_invitation_review.candidates ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_invitation_review.invitations ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_invitation_review.events ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_invitation_review.operator_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA portal_invitation_review FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA portal_invitation_review FROM PUBLIC;
GRANT USAGE ON SCHEMA portal_invitation_review TO epdg_synthetic_app;
GRANT SELECT ON ALL TABLES IN SCHEMA portal_invitation_review TO epdg_synthetic_app;
GRANT INSERT ON portal_invitation_review.invitations,portal_invitation_review.events TO epdg_synthetic_app;
GRANT UPDATE(status,delivery_status) ON portal_invitation_review.invitations TO epdg_synthetic_app;
GRANT EXECUTE ON FUNCTION portal_invitation_review.eligible(integer),portal_invitation_review.accept(text,text) TO epdg_synthetic_app;
