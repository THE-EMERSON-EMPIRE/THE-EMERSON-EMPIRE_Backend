-- Local admin-staging extension. It creates no identities and grants no roles.
-- Production application requires a separate reviewed migration and explicit approval.
CREATE TABLE IF NOT EXISTS portal_security.role_assignments (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id integer NOT NULL REFERENCES portal_security.account_states(user_id),
  role_code text NOT NULL CHECK (role_code IN ('founder_admin','webdev_technical')),
  status text NOT NULL DEFAULT 'pending' CHECK (status IN ('pending','active','revoked')),
  assigned_by_user_id integer REFERENCES core.users(id),
  revision bigint NOT NULL DEFAULT 1 CHECK (revision > 0),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  updated_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE UNIQUE INDEX IF NOT EXISTS portal_role_assignment_open_unique
  ON portal_security.role_assignments(user_id,role_code) WHERE status IN ('pending','active');
CREATE INDEX IF NOT EXISTS portal_role_assignment_user_status
  ON portal_security.role_assignments(user_id,status);
DO $triggers$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgrelid='portal_security.role_assignments'::regclass AND tgname='portal_role_assignment_revision') THEN
    CREATE TRIGGER portal_role_assignment_revision BEFORE UPDATE ON portal_security.role_assignments
      FOR EACH ROW EXECUTE FUNCTION portal_security.advance_revision();
  END IF;
END;
$triggers$;

CREATE TABLE IF NOT EXISTS portal_security.admin_events (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  event text NOT NULL CHECK (event IN ('role_assignment_requested')),
  actor_user_id integer NOT NULL REFERENCES core.users(id),
  target_user_id integer REFERENCES core.users(id),
  role_code text CHECK (role_code IN ('founder_admin','webdev_technical')),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX IF NOT EXISTS portal_admin_event_created ON portal_security.admin_events(created_at);
CREATE INDEX IF NOT EXISTS portal_admin_event_actor ON portal_security.admin_events(actor_user_id,created_at);

ALTER TABLE portal_security.role_assignments ENABLE ROW LEVEL SECURITY;
ALTER TABLE portal_security.admin_events ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON portal_security.role_assignments,portal_security.admin_events FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA portal_security FROM PUBLIC;
