# Supabase static schema, access, and index inventories

> **Evidence boundary:** repository-only review. No Supabase connection, SQL execution, migration, advisor run, provider setting read, or data access occurred.

## Sources and precedence

1. `epdg-backend-core/SCHEMA_REFERENCE.sql` — catalog-derived snapshot generated July 2, 2026; 40 tables, 68 foreign keys, 61 explicit indexes, 18 unique constraints, and 40 primary keys.
2. `epdg-backend-core/src/db/migrations/001-033` — historical, baseline-only migration evidence. Two files are explicitly blocked as destructive history, and no forward migration is allowlisted.
3. `supabase/migrations/20260708_api_foundation_review.sql` — three proposed Agency tables; comments say review before production and application is not established.
4. Current routes, services, auth middleware, and prior audit notes — business-rule evidence only; they do not prove live database state.

Where these disagree, this package records drift rather than selecting a convenient version.

Current official guidance was checked on August 8, 2026. The [breaking-change changelog](https://supabase.com/changelog?types=breaking-change) contained no change that alters the PostgreSQL RLS syntax used by this review-only draft. Supabase's current guidance separates grants from policies and is moving new-project defaults toward opt-in/revoked privileges; an existing project's actual grants still must be exported rather than inferred. The April 2026 anonymous OpenAPI-schema change likewise does not prove any table privilege in this project.

## Grants and Data API exposure inventory

| Control | Tracked state | Consequence / required evidence |
|---|---|---|
| `GRANT` statements in tracked schema/migrations | **0** | Actual `anon`, `authenticated`, backend-role, and other role privileges are unknown. |
| `REVOKE` statements in tracked schema/migrations | **0** | Repository history cannot prove least privilege or provider defaults. |
| Default privileges | Not tracked | Export `pg_default_acl`; do not infer defaults from project age because Supabase defaults have changed. |
| Exposed Data API schemas | Not tracked | Record the dashboard setting or authenticated configuration export for `public`, `core`, `epdg`, and `agency`. |
| Schema `USAGE` grants | Not tracked | Export `information_schema.role_usage_grants`/catalog equivalents. |
| Table/sequence/function grants | Not tracked | Export object grants separately from RLS. |
| Direct application data path | Current docs/code use backend Postgres connections | Keep direct browser Data API access closed until identity and policy tests pass. |
| Supabase JS use | Server-side Storage operations only in this repository | This does not prove table Data API exposure. Storage bucket policies are a separate untracked review. |
| Review-only draft | Revokes all schema/table/sequence/function privileges from `anon` and `authenticated` in known app schemas | Deliberately broader than table grants. Capture compensating grants and review Edge Function/RPC compatibility before any non-production trial. |

Provable grant conflicts from versioned SQL: **zero**, because no current grant state is versioned. Unverified grant-to-intent comparisons: **all 43 tracked tables**. Any live `anon`/`authenticated` object grant on a row marked backend-only in `docs/rls-policy-map.md` is a candidate conflict, but it must be established by authenticated catalog evidence before reporting it as fact.

Supabase's current [Data API security guide](https://supabase.com/docs/guides/api/securing-your-api) treats grants as object reachability and RLS as row filtering. Neither layer substitutes for the other. The draft does not mention or grant a privileged server key/role and does not change the backend connection role.

## RLS and policy inventory

| Item | Static result |
|---|---|
| Tracked `CREATE POLICY` | **0** |
| Tracked `ALTER POLICY` / `DROP POLICY` | **0** |
| Exact per-table live policy count | Unknown; no authenticated `pg_policies` export is versioned |
| Explicitly reported RLS-disabled tables | `core.branches`, `core.users`, `core.user_branch_roles`, `epdg.career_files`, `epdg.career_experiences`, `epdg.career_projects`, `epdg.career_skills` |
| Other `core`/`epdg` table RLS state | Unknown table by table; prior audit only says “many” are enabled without policies |
| Agency review SQL | Proposes RLS enabled on all three Agency tables with no policies; application unknown |
| Proposed policies in this package | **0** — fail-closed by design until a trusted database request identity exists |

The application verifies custom HS256 JWTs in Express and reads a top-level integer `id`. The schema stores serial/integer user IDs. No tracked contract links those IDs to `auth.users.id` or proves that PostgREST accepts the application token. Consequently, an `auth.uid()` ownership policy would be type- and identity-incompatible, while trusting an invented JWT claim would be unsafe.

Any later update policy must have a select policy and must use both `USING` (existing row) and `WITH CHECK` (new row). The policy role belongs in `TO`; `auth.role()` is not an authorization predicate. User-editable metadata and `SECURITY DEFINER` shortcuts are prohibited.

## Function, trigger, and view inventory

| Object type | Tracked custom objects | Notes |
|---|---:|---|
| SQL functions | **0** | Migrations call built-ins such as `now`, `gen_random_uuid`, `setval`, `pg_get_serial_sequence`, `format`, and `to_regclass`; none is an application authorization function. |
| `SECURITY DEFINER` functions | **0** | Actual provider/database functions still require authenticated catalog export. |
| Triggers | **0** | No automatic ownership, timestamp, audit, or synchronization trigger is tracked. |
| Views/materialized views | **0** | Public projections are implemented in backend queries, not security-invoker views. |
| RPC grants | None tracked | Function exposure and Edge/RPC consumers are a dashboard/catalog decision. |

## Index inventory by tracked table

“Covered” means the snapshot has a primary, unique, or explicit B-tree index whose leading column(s) match the FK. It does not prove that the index is useful for the production workload. Agency rows describe proposal SQL, not applied objects.

| Table | Existing key/index evidence | FK coverage gap from static snapshot |
|---|---|---|
| `core.branches` | PK `id`; UQ `code` | None (no FK) |
| `core.user_branch_roles` | PK; UQ `(user_id, branch_id)`; indexes on `user_id`, `branch_id` | None |
| `core.users` | PK; partial UQ active `email` | None (no FK) |
| `epdg.admins` | PK; UQ index `user_id`; index `admin_type` | None |
| `epdg.announcements` | PK; index `audience` | **`created_by`** |
| `epdg.applications` | PK; UQ `(intern_id, slot_id)`; indexes `intern_id`, `slot_id`, `reviewed_by`, `status` | None |
| `epdg.audit_log` | PK; indexes `admin_id`, `created_at DESC` | None |
| `epdg.badge_awards` | PK only | **`awarded_by`, `badge_id`, `user_id`** |
| `epdg.badges` | PK; UQ `name` | None (no FK) |
| `epdg.career_experiences` | PK only | **`career_file_id`** |
| `epdg.career_files` | PK; UQ `intern_profile_id`; UQ `slug`; explicit indexes repeat both plus `readiness_tier` | None |
| `epdg.career_projects` | PK; index `career_file_id`; partial UQ `(career_file_id, source, source_ref_id)` | None |
| `epdg.career_skills` | PK; UQ `(career_file_id, skill_name)`; index `career_file_id` | **`endorsed_by`** |
| `epdg.certificate_templates` | PK | None (no FK) |
| `epdg.certificates` | PK; UQ `certificate_number` | **`intern_id`, `issued_by`, `template_id`** |
| `epdg.companies` | PK; indexes `user_id`, `approved_by` | None |
| `epdg.feedback` | PK; index `placement_id` | **`given_by`, `target_user_id`** |
| `epdg.intern_level_progress` | PK; UQ `(intern_id, track_id)`; index `intern_id` | **`track_id`** (not leading in the unique index) |
| `epdg.intern_profiles` | PK; indexes `user_id`, `school_id`, `is_approved` | **`approved_by`, `mentor_id`** |
| `epdg.intern_roadmap_progress` | PK; UQ `(intern_id, week_id)`; index `intern_id` | **`week_id`** (not leading in the unique index) |
| `epdg.intern_skills` | PK; UQ `(intern_id, skill_name)`; index `intern_id` | None |
| `epdg.internship_slots` | PK; indexes `company_id`, `status` | **`created_by`** |
| `epdg.mentor_sessions` | PK; indexes `intern_id`, `mentor_id`, `placement_id` | None |
| `epdg.milestones` | PK; indexes `completed_by`, `placement_id` | None |
| `epdg.module_completions` | PK; UQ `(intern_id, module_id)`; index `intern_id` | **`mentor_id`, `module_id`** |
| `epdg.onboarding_agreements` | PK; UQ `(intern_id, agreement_type)`; index `intern_id` | None |
| `epdg.opportunities` | PK; indexes `status`, `type` | **`company_id`, `posted_by`** |
| `epdg.opportunity_applications` | PK; UQ `(intern_id, opportunity_id)`; indexes `intern_id`, `opportunity_id` | **`reviewed_by`** |
| `epdg.placements` | PK; UQ `application_id`; indexes `intern_id`, `company_id`, `school_id`, `slot_id`, `mentor_id`, `status` | None |
| `epdg.platform_settings` | PK `key` | None (no FK) |
| `epdg.point_events` | PK only | **`awarded_by`, `user_id`** |
| `epdg.readiness_score_history` | PK; index `(career_file_id, snapshot_at)` | None |
| `epdg.resources` | PK; indexes `category`, `type` | **`uploaded_by`** |
| `epdg.roadmap_modules` | PK; UQ `(track_id, level, order_index)`; index `(track_id, level)` | None |
| `epdg.roadmap_weeks` | PK; UQ `week_number` | None (no FK) |
| `epdg.schools` | PK; indexes `user_id`, `approved_by` | None |
| `epdg.submissions` | PK; indexes `task_id`, `placement_id`, `intern_id`, `reviewed_by`, `status` | None |
| `epdg.tasks` | PK; indexes `placement_id`, `assigned_by`, `status` | None |
| `epdg.tracks` | PK; UQ `slug` | None (no FK) |
| `epdg.users` | PK; partial UQ active `email` | None (no FK) |
| `agency.clients` | Proposed PK; proposed email index | None (no FK) |
| `agency.booking_inquiries` | Proposed PK; proposed indexes `client_id`, `status` | None in proposal |
| `agency.compliance_acknowledgements` | Proposed PK; proposed index `client_id` | None in proposal |

### Proposed missing-FK index set (24)

The review-only file `supabase/review-only/2026-08-08/draft_foreign_key_indexes.sql` contains exactly these 24 candidates:

| # | Table | FK column | Referenced table | Draft index |
|---:|---|---|---|---|
| 1 | `epdg.announcements` | `created_by` | `epdg.users(id)` | `idx_announcements_created_by` |
| 2 | `epdg.badge_awards` | `awarded_by` | `epdg.users(id)` | `idx_badge_awards_awarded_by` |
| 3 | `epdg.badge_awards` | `badge_id` | `epdg.badges(id)` | `idx_badge_awards_badge_id` |
| 4 | `epdg.badge_awards` | `user_id` | `epdg.users(id)` | `idx_badge_awards_user_id` |
| 5 | `epdg.career_experiences` | `career_file_id` | `epdg.career_files(id)` | `idx_career_experiences_career_file_id` |
| 6 | `epdg.career_skills` | `endorsed_by` | `epdg.users(id)` | `idx_career_skills_endorsed_by` |
| 7 | `epdg.certificates` | `intern_id` | `epdg.users(id)` | `idx_certificates_intern_id` |
| 8 | `epdg.certificates` | `issued_by` | `epdg.users(id)` | `idx_certificates_issued_by` |
| 9 | `epdg.certificates` | `template_id` | `epdg.certificate_templates(id)` | `idx_certificates_template_id` |
| 10 | `epdg.feedback` | `given_by` | `epdg.users(id)` | `idx_feedback_given_by` |
| 11 | `epdg.feedback` | `target_user_id` | `epdg.users(id)` | `idx_feedback_target_user_id` |
| 12 | `epdg.intern_level_progress` | `track_id` | `epdg.tracks(id)` | `idx_intern_level_progress_track_id` |
| 13 | `epdg.intern_profiles` | `approved_by` | `epdg.users(id)` | `idx_intern_profiles_approved_by` |
| 14 | `epdg.intern_profiles` | `mentor_id` | `epdg.users(id)` | `idx_intern_profiles_mentor_id` |
| 15 | `epdg.intern_roadmap_progress` | `week_id` | `epdg.roadmap_weeks(id)` | `idx_intern_roadmap_progress_week_id` |
| 16 | `epdg.internship_slots` | `created_by` | `epdg.users(id)` | `idx_internship_slots_created_by` |
| 17 | `epdg.module_completions` | `mentor_id` | `epdg.users(id)` | `idx_module_completions_mentor_id` |
| 18 | `epdg.module_completions` | `module_id` | `epdg.roadmap_modules(id)` | `idx_module_completions_module_id` |
| 19 | `epdg.opportunities` | `company_id` | `epdg.companies(id)` | `idx_opportunities_company_id` |
| 20 | `epdg.opportunities` | `posted_by` | `epdg.users(id)` | `idx_opportunities_posted_by` |
| 21 | `epdg.opportunity_applications` | `reviewed_by` | `epdg.users(id)` | `idx_opportunity_applications_reviewed_by` |
| 22 | `epdg.point_events` | `awarded_by` | `epdg.users(id)` | `idx_point_events_awarded_by` |
| 23 | `epdg.point_events` | `user_id` | `epdg.users(id)` | `idx_point_events_user_id` |
| 24 | `epdg.resources` | `uploaded_by` | `epdg.users(id)` | `idx_resources_uploaded_by` |

This set is a static “unindexed FK” finding, not a performance claim. Validate table sizes, write rates, existing invalid/duplicate indexes, query plans, and Supabase Performance Advisor output in a safe environment before approval.

This follows Supabase's [Performance and Security Advisors guidance for unindexed foreign keys](https://supabase.com/docs/guides/database/database-advisors?lint=0017_foreign_table_in_api), while keeping advisor output and workload validation explicitly open.

## Material schema-drift findings

- `announcements`: migration 013 creates `title/body/audience`; migration 022 attempts a different `subject/message/target_audience` shape with `CREATE TABLE IF NOT EXISTS`. The snapshot has the first shape, while `AdminService` queries the second.
- `feedback`: the snapshot has `placement_id/given_by/type`; migration 022 and current services also expect `from_name/role/category/status/user_id`. These are not interchangeable policy columns.
- `resources`: the snapshot has `category/description/thumbnail_url/uploaded_by`; migration 022 and `AdminService` expect `owner/status/created_by`.
- `src/database/migration.sql` is a stale standalone script, not the reviewed baseline; it attempts to index a `reset_token` column that its own table definition does not create.
- Historical migrations 011 and 024 contain destructive DDL and are explicitly baseline-only/blocked by `migration-policy.json`.
- The Agency review SQL lives under a conventional migration directory despite its review-only comments. This package does not move or apply it; provider/migration tooling must prove whether that path is automatically consumed.
