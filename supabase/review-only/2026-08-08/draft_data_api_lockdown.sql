-- ============================================================================
-- DRAFT / REVIEW ONLY / DO NOT APPLY
-- Static design date: 2026-08-08
-- This file is intentionally outside every automatic migration directory.
-- It has not been executed against any database.
-- ============================================================================
--
-- Proposed posture: preserve the current backend-mediated architecture while
-- direct Data API identity, schema exposure, grants, and runtime-role behavior
-- remain unverified. Grants and RLS are separate controls; this draft addresses
-- both without creating an allow policy.
--
-- Preconditions before an approved non-production trial:
--   1. export pg_class.relrowsecurity, pg_policies, object grants, schema grants,
--      default privileges, table owners, and roles with BYPASSRLS;
--   2. reconcile SCHEMA_REFERENCE.sql with the migration history and live DDL;
--   3. prove the backend connection role will remain compatible;
--   4. approve the identity/authorization decisions in the decision register;
--   5. capture compensating GRANT statements from the target before revocation.
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

-- Expected Data API result after an approved trial: fail closed. No direct
-- anonymous or authenticated table access is granted by this package.
