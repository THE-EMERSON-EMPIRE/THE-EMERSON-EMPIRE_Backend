-- ============================================================================
-- DRAFT / REVIEW ONLY / DO NOT APPLY
-- Static design date: 2026-08-08
-- This file is intentionally outside every automatic migration directory.
-- It has not been executed against any database.
-- ============================================================================
--
-- Proposed operation: preserve the current backend-mediated architecture while
-- direct Data API identity, schema exposure, grants, and runtime-role behavior
-- remain unverified. Grants and RLS are separate controls. This draft enables
-- RLS and removes only ACL entries granted directly to `anon` and
-- `authenticated`; it creates no allow policy.
--
-- IMPORTANT: direct REVOKE does not prove effective denial. Privileges may still
-- arrive through PUBLIC or inherited role membership. Functions may retain
-- PostgreSQL's default EXECUTE privilege for PUBLIC; default privileges may
-- grant access to future objects, and an executable SECURITY DEFINER routine may
-- expose privileged operations. This draft deliberately does not revoke from
-- PUBLIC, alter role membership/default privileges, or rewrite/drop routines.
--
-- Preconditions before an approved non-production trial:
--   1. export pg_class.relrowsecurity, pg_policies, complete object/schema ACLs
--      including PUBLIC, pg_auth_members, pg_default_acl, table owners, roles
--      with BYPASSRLS, and pg_proc ACL/prosecdef state;
--   2. reconcile SCHEMA_REFERENCE.sql with the migration history and live DDL;
--   3. prove the backend connection role will remain compatible;
--   4. approve the identity/authorization decisions in the decision register;
--   5. capture compensating GRANT statements from the target before revocation;
--   6. prepare effective has_schema_privilege, has_table_privilege,
--      has_sequence_privilege, and has_function_privilege assertions for every
--      exposed application object and both API roles.
--
-- There are deliberately no CREATE POLICY statements in this draft. The app's
-- custom HS256 access token carries an integer `id`, while the repository has no
-- reviewed Supabase Auth mapping or trusted PostgREST claim contract. Inventing
-- that bridge here would create an authorization vulnerability.

begin;

do $draft$
declare
  target_schema text;
  target_table text;
begin
  for target_schema, target_table in
    select *
    from (values
      ('core', 'branches'),
      ('core', 'user_branch_roles'),
      ('core', 'users'),
      ('epdg', 'admins'),
      ('epdg', 'announcements'),
      ('epdg', 'applications'),
      ('epdg', 'audit_log'),
      ('epdg', 'badge_awards'),
      ('epdg', 'badges'),
      ('epdg', 'career_experiences'),
      ('epdg', 'career_files'),
      ('epdg', 'career_projects'),
      ('epdg', 'career_skills'),
      ('epdg', 'certificate_templates'),
      ('epdg', 'certificates'),
      ('epdg', 'companies'),
      ('epdg', 'feedback'),
      ('epdg', 'intern_level_progress'),
      ('epdg', 'intern_profiles'),
      ('epdg', 'intern_roadmap_progress'),
      ('epdg', 'intern_skills'),
      ('epdg', 'internship_slots'),
      ('epdg', 'mentor_sessions'),
      ('epdg', 'milestones'),
      ('epdg', 'module_completions'),
      ('epdg', 'onboarding_agreements'),
      ('epdg', 'opportunities'),
      ('epdg', 'opportunity_applications'),
      ('epdg', 'placements'),
      ('epdg', 'platform_settings'),
      ('epdg', 'point_events'),
      ('epdg', 'readiness_score_history'),
      ('epdg', 'resources'),
      ('epdg', 'roadmap_modules'),
      ('epdg', 'roadmap_weeks'),
      ('epdg', 'schools'),
      ('epdg', 'submissions'),
      ('epdg', 'tasks'),
      ('epdg', 'tracks'),
      ('epdg', 'users'),
      ('agency', 'clients'),
      ('agency', 'booking_inquiries'),
      ('agency', 'compliance_acknowledgements'),
      ('public', 'migrations')
    ) as known_tables(schema_name, table_name)
  loop
    if to_regclass(format('%I.%I', target_schema, target_table)) is not null then
      execute format(
        'alter table %I.%I enable row level security',
        target_schema,
        target_table
      );
    end if;
  end loop;
end
$draft$;

do $draft$
declare
  target_schema text;
  api_role text;
begin
  -- These statements remove only privileges granted directly to the named API
  -- roles. They do not remove grants to PUBLIC or inherited roles, and they do
  -- not change default privileges for objects created later.
  foreach target_schema in array array['core', 'epdg', 'agency']
  loop
    if exists (select 1 from pg_namespace where nspname = target_schema) then
      foreach api_role in array array['anon', 'authenticated']
      loop
        if exists (select 1 from pg_roles where rolname = api_role) then
          execute format('revoke all privileges on schema %I from %I', target_schema, api_role);
          execute format('revoke all privileges on all tables in schema %I from %I', target_schema, api_role);
          execute format('revoke all privileges on all sequences in schema %I from %I', target_schema, api_role);
          execute format('revoke all privileges on all functions in schema %I from %I', target_schema, api_role);
        end if;
      end loop;
    end if;
  end loop;

  -- `public.migrations` is runtime-mentioned but absent from the schema snapshot.
  -- Revoke it only when both the relation and target role exist.
  if to_regclass('public.migrations') is not null then
    foreach api_role in array array['anon', 'authenticated']
    loop
      if exists (select 1 from pg_roles where rolname = api_role) then
        execute format('revoke all privileges on table public.migrations from %I', api_role);
      end if;
    end loop;
  end if;
end
$draft$;

commit;

-- No complete Data API lockout is claimed by this draft. After an approved
-- disposable-environment trial, verify effective privileges for both roles on
-- every exposed object with has_schema_privilege (USAGE/CREATE),
-- has_table_privilege (all relevant table privileges), has_sequence_privilege
-- (USAGE/SELECT/UPDATE), and has_function_privilege (EXECUTE). Also inspect
-- PUBLIC ACLs, inherited role membership, pg_default_acl, routine EXECUTE ACLs,
-- and SECURITY DEFINER routines, then exercise actual Data API and RPC requests.
-- Treat any positive unapproved privilege or successful request as a failed
-- security assertion requiring separate review; do not broaden this draft.
