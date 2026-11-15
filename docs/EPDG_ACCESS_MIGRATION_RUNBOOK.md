# EPDG scoped access migration and recovery runbook

This is a reviewable release procedure. No production SQL has been executed. Keep production locked and privileged controls closed until the founder separately approves the exact application revisions, migration files, target, bootstrap grant and invitation population. The user authorized implementation and synthetic verification, not any of those live actions.

## Verified target and unresolved operator prerequisite

Read-only November 14 provider inspection identifies the normal EPDG Railway production backend's configured database as Supabase project `gqlyofoazfkumirhbnmc`, session pooler `aws-0-eu-west-1.pooler.supabase.com:5432`, database `postgres`, runtime username `epdg_portal_runtime.gqlyofoazfkumirhbnmc` (PostgreSQL role `epdg_portal_runtime`). Configured portal origin is `https://epdg.netlify.app`. The deployed normal backend was `b1ce7b415d9d77eef42219d8976115868d5fb8aa`. Configuration/health evidence is not evidence that the phase-two candidate is deployed.

Do not apply this to synthetic Supabase `ymitqvcxttcbesijzbfy`, the separate Neon administrator staging database, an old Railway environment, or a database inferred from a project display name. The actual production migration login/role has not been approved by this code change. An authorized operator must supply the exact migrator role and verify current database identity with strict TLS before execution. Never place the connection URL or password in Git, terminal transcripts, a PR or a frontend build.

Required migrator capabilities: ownership or explicit alter authority over the reviewed `portal_security.role_assignments` constraint and auth policies/grants; CREATE in the target database for the private schema; REFERENCES/SELECT and bounded update authority for the preserved core/EPDG/security objects; ownership of the new private tables/functions. The migrator must be separate from the runtime, and must not be granted to the runtime. A non-superuser migrator with database ownership succeeds in the disposable verification. A live operator should use only the privileges actually required, not turn the runtime into an owner.

## Order and preflight

1. Record current target identity, deployment revisions and existing security/admin checksums. Reconcile the current schema with `security-migrations/001-portal-security.sql` and `admin-migrations/001-admin-role-assignments.sql`; do not replay unrelated legacy migrations or seed identities. The existing integer core/EPDG mirrors, account states, memberships and sessions are prerequisites.
2. Inspect `access-migrations/001-scoped-access.sql` and `src/security/access-schema-manifest.json`. Verify the byte checksum and retain the reviewed manifest. The phase-two runner must take a migration advisory lock, verify its ledger entry before execution, and reject a mismatched existing checksum. Application startup never runs SQL or rewrites the ledger.
3. In one explicit transaction set `epdg.access_migrator_role` to the authenticated migrator and `epdg.access_runtime_role` to the approved restricted runtime. The migration rejects a mismatch, runtime equal to migrator, or a runtime with superuser/BYPASSRLS/role/database creation privileges.
4. Execute only the reviewed access migration, then record its version/checksum in `portal_access.schema_migrations` in that same transaction. Commit only after the grants/schema checks pass. On an exception, rollback; do not mark the migration applied.
5. Apply the separately reviewed portable account/provisioning migration, then the portable learning migration. These depend on the access roles/scopes. Preserve their own checksum ledgers. The local-only `portal_invitation_review` migration is not the production invitation migration and must not be used as one.
6. Bootstrap only the separately founder-approved first `founder_owner` assignment/scope against an exactly reconciled existing identity and explicit approved company membership. Record the operator and approval evidence privately. No migration seeds this grant. Subsequent roles are granted only through persisted founder-approved provisioning plans. Import no real roster until separately approved.
7. Deploy the exact tested backend/frontend only after all gates and CI pass. The default feature flag stays closed until database readiness, HTTPS origin/cookie/CSRF, authenticated entry routing, sender and protected admin access are verified. A Netlify protection change is separate from this SQL and requires explicit review.

Illustrative transaction shape (placeholders deliberately cannot be run as a valid production target):

```sql
BEGIN;
SELECT pg_advisory_xact_lock(hashtext('epdg-phase-two-migrations-v1'));
SELECT set_config('epdg.access_migrator_role', '<reviewed authenticated migrator>', true);
SELECT set_config('epdg.access_runtime_role', '<reviewed restricted runtime>', true);
-- Run the exact checked access SQL; verify or insert the exact ledger checksum.
-- Verify grants and schema before COMMIT. ROLLBACK on any mismatch.
```

## Expected impact and least privilege

The migration adds `portal_access` tables for scopes, groups, reviewed resources, audit/review records and its ledger. It expands the existing role-code CHECK constraint to retain the historical two values and admit the eleven canonical roles. It replaces only that named constraint and the explicitly named runtime policies; it drops no table/schema, deletes no identity, rewrites no password, and grants no role. These targeted constraint/policy replacements are reviewed separately from the repository's historical migration validator, whose blanket DROP-token prohibition intentionally does not cover this new portable runner.

Historical broad runtime grants on core/EPDG/security tables, including column grants, are revoked and replaced with the custom authentication service's minimum privileges. This deliberately disables legacy direct user/profile/branch-role mutation paths. Only reviewed phase-two bounded provisioning functions may perform the new identity/account operations. Therefore migration and application release ordering must be coordinated; it is not safe to apply the grant change while leaving an unrelated legacy write route as the intended production workflow.

The runtime may select the identity/profile fields required by the existing authentication service; update password mirrors and account revision; maintain session/recovery records; append authentication audit; read the reviewed migration ledger; and execute private bounded access functions. Existing identity/profile tables with RLS receive explicit runtime SELECT policies; the core/EPDG user mirrors receive runtime UPDATE policies whose SQL privileges remain restricted to the password column. It cannot activate accounts, insert roles, edit approvals/audit history, select resource tables directly, or create private schema objects. All new functions revoke PUBLIC execution and pin an empty search path. Anonymous/authenticated browser database roles receive no new privileges.

Run `checkAccessSchema` using the runtime connection after migration. It verifies the exact manifest, restricted PostgreSQL role flags, no private schema creation, no account activation update, no direct identity/role modification, and no direct resource-table access. Existing server auth table RLS policies are role-specific service policies; resource functions and learning session policies provide user-specific filtering. Check inherited role memberships and existing PUBLIC/default privileges as part of the concrete target approval, rather than assuming a role flag alone proves isolation.

## Verification and compensating actions

The standalone native matrix applies the SQL twice, verifies all eleven roles and scope denials with a NOBYPASSRLS runtime, repeats it after data exists, and rolls back an application transaction without loss of identities. It proves that old broad/column grants are removed. The combined phase-two suite must additionally prove the actual bcrypt session path, token/cookie/CSRF handling, provisioning/invitation lifecycle, HR eligibility, learning records and API errors against the same migration set.

If the migration transaction fails, rollback and preserve the previous ledger. If post-release verification fails, close the feature flag and participant entry and stop new sends. Preserve the new tables/ledger/history. An approved founder may revoke an incorrect scope through the bounded function, which advances target account revision and revokes sessions; the separate account-disable procedure also revokes invitations/recovery tokens. Repeating scope revocation is harmless. Do not delete identities, restore old password snapshots, enable BYPASSRLS, or regrant historical broad writes as a shortcut.

A mistaken group or company membership can be disabled by the authorized operator procedure; active membership is required by every applicable role decision, and its removal changes session scope snapshots. Re-enabling or replacing a revoked approval requires a new explicit reviewed plan/operator action; silently overwriting the old approval reference is prohibited. Any code rollback must remain compatible with the new minimum database grants; otherwise keep the feature closed and prepare a reviewed forward correction.

Production success is recorded separately: approved account exists, invitation prepared, transport accepted or failed, email possession confirmed, invitation accepted/account activated, and an actual subsequent successful sign-in. Native synthetic results, a manifest entry or a deployment health response do not prove those outcomes for real people.

After the access/account/portable-learning migrations, curriculum publication and learner/mentor mapping follow `EPDG_EDUCATION_PUBLICATION_RUNBOOK.md`. It requires exact reviewed curriculum content and a persisted founder review, stable IDs, the exact verified HR plan and explicit mentor enrollment mappings. No course content, enrollment or real learner is seeded by migration, and runtime curriculum/mapping write grants remain closed.
