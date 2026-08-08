# Supabase PR and issue comment drafts

> Paste-ready drafts for founder review. Do not post automatically and do not close Issues #18, #19, or #24.

## Draft pull request

### Title

`docs(security): add review-only Supabase access-control and FK-index design`

### Body

```markdown
## Summary

Adds a static, review-only Supabase security design package. No database was contacted, no SQL was applied, and nothing was deployed.

This PR:

- maps all 43 tracked table contracts across public, participant, intern-owner, assigned-mentor, administrator, founder/super-admin, and backend-only access categories;
- inventories grants/Data API exposure, RLS/policies, functions, triggers, views, and indexes;
- records exact evidence limits: seven tables are reported RLS-disabled, three Agency tables have unapplied RLS-enable review SQL, and all other table-level runtime states remain unknown;
- records 24 FK columns without leading-column index coverage in the July 2 schema snapshot;
- adds forward-only, idempotent SQL drafts outside automatic migration paths;
- proposes a backend-only design with zero allow policies because the repository has no reviewed mapping between its custom integer-ID JWT identity and Supabase Auth/PostgREST identity;
- adds static regression tests for table-map completeness, unsafe policy patterns, the 24-index set, and proven ownership FKs;
- adds a decision register, synthetic role-test plan, and compensating plan;
- prepares evidence comments for frontend Issues #18, #19, and #24 without closing them.

## Important evidence boundary

Issue #18 contains checked policy-group and priority-table boxes, but the repository has zero tracked `CREATE POLICY` statements and no authenticated catalog export. This PR treats those checks as historical issue state, not verified policy implementation.

The backend verifies a custom HS256 token containing an integer `id`. The tracked tables also use integer user IDs, but there is no `auth.users` UUID mapping or reviewed PostgREST claim contract. This PR does not invent one. Consequently, it creates no participant/mentor/admin policy and does not claim runtime compatibility for `ENABLE RLS`; the backend database role's owner/`BYPASSRLS` behavior is also untracked.

## Review-only SQL

- `supabase/review-only/2026-08-08/draft_data_api_lockdown.sql`
  - enables RLS only when a known table exists;
  - removes only schema/table/sequence/function ACL entries granted directly to `anon` and `authenticated`;
  - creates no policies and contains no `GRANT` statement;
  - is not in either automatic migration path.
- `supabase/review-only/2026-08-08/draft_foreign_key_indexes.sql`
  - contains 24 `CREATE INDEX CONCURRENTLY IF NOT EXISTS` candidates;
  - must be advisor/plan-validated one at a time in an approved disposable environment;
  - is not executable inside a transaction.

The direct function-ACL revocation is deliberately broader in object type than the table revocations and must not be trialed until existing RPC/Edge consumers and exact compensating grants are captured. Direct revocation does not establish effective denial: privileges can remain through `PUBLIC` (including default function `EXECUTE`), inherited role membership, ownership/`BYPASSRLS`, or callable routines, while default privileges can affect future objects. A disposable trial must export those catalogs and require negative `has_schema_privilege`, `has_table_privilege`, `has_sequence_privilege`, and `has_function_privilege` assertions plus actual Data API/RPC denial probes. No complete lockout is claimed before those pass.

## Verification

- PASS — root `npm ci --ignore-scripts --no-audit --no-fund`
- PASS — root `npm test`: 16/16, including all seven Supabase design regressions
- PASS — core `npm ci --ignore-scripts --no-audit --no-fund`
- PASS — core `npm test`: build succeeded and 57/57 route/security tests passed
- PASS with existing warnings — core `npm run lint`: 0 errors, 161 warnings in pre-existing source files
- PASS — exact 43-row map, seven reported-disabled labels, three Agency proposal labels, and separate 44-object direct-ACL/RLS draft coverage
- PASS — 24-index snapshot reconciliation and 29 proven ownership-FK checks
- PASS — credential-pattern and forbidden executable-SQL scans

No Supabase Security/Performance Advisor result is claimed; those require authenticated project access and an approved non-production workflow.

## Required follow-up decisions

The PR does not resolve Data API architecture, request identity, exposed schemas, actual grants, backend runtime role behavior, canonical mentor assignment, founder/team-lead semantics, schema drift, public projection strategy, Agency intake exposure, Storage policies, or the issue-only messaging/session tables. Each is recorded in `docs/supabase-access-decision-register.md`.

## Compensating plan

No runtime compensation is needed for this PR because no SQL is applied. A future trial must capture exact pre-change grants/RLS/index state, use synthetic data in a disposable environment, verify the backend role, and restore only captured privileges/state if needed.

## Non-actions confirmed

- no production or non-production database connection
- no SQL execution or migration
- no provider setting change
- no deployment
- no secret/key value printed or committed
- no real intern/client/application/mentor record used
- no issue closed
- no direct push to `main` and no merge
```

## Issue #18 — Supabase RLS

```markdown
Static design update only — **no policy or migration was applied**.

I prepared a review package that maps all 43 tracked table contracts and separates object grants/Data API exposure from row policies. The repository currently contains zero tracked `CREATE POLICY` statements and no authenticated catalog export, so the checked boxes already present in this issue are not treated as verified database evidence.

Current checked policy groups recorded here remain historical issue state: public-read; intern self-access for profile/progress/submissions/certificates/notifications/saved resources; admin/founder access; backend/service-only audit/role/sensitive actions; and deny-by-default private intern records. Likewise, the checked priority tables (`epdg.users`, `epdg.intern_profiles`, `epdg.admins`, `epdg.intern_roadmap_progress`, `epdg.module_completions`) are not proven to have live policies by the tracked SQL.

The static repository does prove a blocking identity gap: Express validates a custom HS256 token with an integer `id`, while there is no reviewed mapping to `auth.users.id` or trusted PostgREST claim contract. I therefore did not invent `auth.uid()` or custom-claim policies. The draft enables RLS on known existing tables, removes only ACL entries granted directly to `anon`/`authenticated`, and creates zero allow policies until identity, schema exposure, actual grants, and backend runtime-role behavior are verified. It does not claim effective denial: `PUBLIC`, inherited role membership, default privileges, ownership/`BYPASSRLS`, and callable routines still require catalog review, `has_*_privilege` assertions, and negative Data API/RPC probes in a disposable environment.

Artifacts prepared:

- exhaustive table/access map and exact evidence labels;
- grants, Data API, policy, function, trigger, and index inventories;
- ownership/role decision register;
- review-only direct-ACL/RLS SQL outside automatic migration paths;
- static tests for unsafe patterns and proven ownership FKs;
- synthetic non-production role-test and compensating plan.

The unchecked priority tables and every acceptance criterion remain open. In particular, this work does not prove own-record enforcement, admin access, public/private isolation, synthetic role results, documented live public tables, or frontend key boundaries. Please keep #18 open until authenticated catalog/advisor evidence and privacy-safe disposable-environment tests are attached.
```

## Issue #19 — foreign-key indexes

```markdown
Static index-design update only — **no index was created and Performance Advisor was not run**.

I re-derived FK coverage from the catalog-generated `epdg-backend-core/SCHEMA_REFERENCE.sql` snapshot (generated 2026-07-02). It contains 68 foreign keys. Twenty-four FK columns lack a primary, unique, or explicit index with that FK as the leading column in the snapshot:

`announcements.created_by`; `badge_awards.awarded_by`, `.badge_id`, `.user_id`; `career_experiences.career_file_id`; `career_skills.endorsed_by`; `certificates.intern_id`, `.issued_by`, `.template_id`; `feedback.given_by`, `.target_user_id`; `intern_level_progress.track_id`; `intern_profiles.approved_by`, `.mentor_id`; `intern_roadmap_progress.week_id`; `internship_slots.created_by`; `module_completions.mentor_id`, `.module_id`; `opportunities.company_id`, `.posted_by`; `opportunity_applications.reviewed_by`; `point_events.awarded_by`, `.user_id`; and `resources.uploaded_by`.

A review-only file outside automatic migration paths proposes exactly 24 `CREATE INDEX CONCURRENTLY IF NOT EXISTS` statements. This is a static “unindexed FK” finding, not a claim that every index is beneficial. The snapshot is not fresh August 8 state, and announcements/feedback/resources have tracked schema drift.

Before approval, re-export the catalog, run Supabase Performance Advisor, inspect table sizes/write rates/query plans/duplicate or invalid indexes, and trial candidates one at a time in an approved disposable environment. Do not mark the advisor, safe-environment validation, production application, or performance acceptance boxes complete from this comment. Please keep #19 open.
```

## Issue #24 — synthetic role testing

```markdown
Role-test design update only — **no live, staging, branch, or local database role test was executed**.

The repository is not ready for trustworthy Data API role tests because it does not define how its custom integer-ID HS256 JWT identity maps to Supabase Auth/PostgREST identity. It also leaves canonical mentor assignment, team-lead representation, founder/super-admin equivalence, exposed schemas, actual grants, backend database role ownership/`BYPASSRLS`, and several schema-shape conflicts unresolved.

I prepared a privacy-safe test matrix for a disposable non-production environment covering anonymous, participant A/B, intern A/B, assigned and unassigned mentor, team lead (only after a real role exists), administrator, founder/super-admin, and backend runtime role. Each future update policy must test the matching select rule plus both `USING` and `WITH CHECK`, including cross-user denial and ownership-reassignment denial. Synthetic sessions and rows must be removed when evidence is captured.

Issue #18's checked intern/admin policy boxes are not substituted for role-test evidence. No real intern, applicant, client, mentor, or administrator record was used. Keep all live role-test and acceptance items open, and please keep #24 open until RLS, environment identity, and grants are finalized and the synthetic matrix passes with captured evidence.
```
