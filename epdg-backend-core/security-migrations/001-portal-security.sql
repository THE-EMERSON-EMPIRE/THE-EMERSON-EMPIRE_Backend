-- Additive security foundation. Apply only through a reviewed operator workflow.
-- No identities, memberships, privileges, owners, or application data are backfilled.
CREATE SCHEMA IF NOT EXISTS portal_security;
REVOKE ALL ON SCHEMA portal_security FROM PUBLIC;

CREATE TABLE IF NOT EXISTS portal_security.schema_migrations (
  version text PRIMARY KEY,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS portal_security.account_states (
  user_id integer PRIMARY KEY REFERENCES core.users(id),
  active boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);

CREATE TABLE IF NOT EXISTS portal_security.memberships (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id integer NOT NULL REFERENCES portal_security.account_states(user_id),
  school_id integer REFERENCES epdg.schools(id),
  company_id integer REFERENCES epdg.companies(id),
  active boolean NOT NULL DEFAULT false,
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  CHECK (num_nonnulls(school_id, company_id) = 1)
);
CREATE UNIQUE INDEX IF NOT EXISTS portal_membership_school_unique
  ON portal_security.memberships(user_id, school_id) WHERE school_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS portal_membership_company_unique
  ON portal_security.memberships(user_id, company_id) WHERE company_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS portal_membership_active_user ON portal_security.memberships(user_id) WHERE active;

CREATE OR REPLACE FUNCTION portal_security.advance_revision() RETURNS trigger
LANGUAGE plpgsql SET search_path = '' AS $revision$
BEGIN
  NEW.revision := OLD.revision + 1;
  NEW.updated_at := clock_timestamp();
  RETURN NEW;
END;
$revision$;
DO $triggers$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='portal_security.account_states'::regclass AND tgname='portal_account_revision') THEN
    CREATE TRIGGER portal_account_revision BEFORE UPDATE ON portal_security.account_states
      FOR EACH ROW EXECUTE FUNCTION portal_security.advance_revision();
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='portal_security.memberships'::regclass AND tgname='portal_membership_revision') THEN
    CREATE TRIGGER portal_membership_revision BEFORE UPDATE ON portal_security.memberships
      FOR EACH ROW EXECUTE FUNCTION portal_security.advance_revision();
  END IF;
END;
$triggers$;

CREATE TABLE IF NOT EXISTS portal_security.sessions (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id integer NOT NULL REFERENCES portal_security.account_states(user_id),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  credential_version text NOT NULL CHECK (credential_version ~ '^[0-9a-f]{64}$'),
  account_revision bigint NOT NULL CHECK (account_revision > 0),
  membership_fingerprint text NOT NULL CHECK (membership_fingerprint ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  last_seen_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  revoked_at timestamptz,
  revoked_reason text CHECK (revoked_reason IN ('logout','rotated','password_changed','password_reset','account_changed','expired')),
  CHECK (expires_at > created_at),
  CHECK ((revoked_at IS NULL) = (revoked_reason IS NULL))
);
CREATE INDEX IF NOT EXISTS portal_session_active_user ON portal_security.sessions(user_id) WHERE revoked_at IS NULL;
CREATE INDEX IF NOT EXISTS portal_session_expiry ON portal_security.sessions(expires_at);

CREATE TABLE IF NOT EXISTS portal_security.recovery_tokens (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id integer NOT NULL REFERENCES portal_security.account_states(user_id),
  token_hash text NOT NULL UNIQUE CHECK (token_hash ~ '^[0-9a-f]{64}$'),
  credential_version text NOT NULL CHECK (credential_version ~ '^[0-9a-f]{64}$'),
  account_revision bigint NOT NULL CHECK (account_revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  revoked_at timestamptz,
  CHECK (expires_at > created_at)
);
CREATE INDEX IF NOT EXISTS portal_recovery_active_user ON portal_security.recovery_tokens(user_id)
  WHERE consumed_at IS NULL AND revoked_at IS NULL;

CREATE TABLE IF NOT EXISTS portal_security.audit_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id integer REFERENCES core.users(id),
  session_id uuid REFERENCES portal_security.sessions(id),
  event text NOT NULL CHECK (event IN ('login_succeeded','logout','session_invalidated','recovery_requested','password_reset','password_changed')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS portal_audit_user_created ON portal_security.audit_events(user_id,created_at);

ALTER TABLE portal_security.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_security.account_states ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_security.memberships ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_security.sessions ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_security.recovery_tokens ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_security.audit_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA portal_security FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA portal_security FROM PUBLIC;
