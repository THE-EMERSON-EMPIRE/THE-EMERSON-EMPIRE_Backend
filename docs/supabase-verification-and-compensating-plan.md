# Supabase review verification and compensating plan

> This is a future execution plan. The August 8 package is static and review-only: no database was contacted and there is nothing to roll back from this PR.

## Verification performed for this package

Allowed local checks:

1. Parse the tracked schema snapshot and prove the 40-table count.
2. Prove the policy map has exactly the 43 tracked table contracts (40 snapshot + three Agency proposal tables).
3. Prove the lockdown SQL covers those 43 plus the separately labeled runtime-only `public.migrations` object.
4. Recalculate leading-column FK index coverage from the snapshot and compare it exactly with the 24 candidate indexes.
5. Assert that review SQL contains no `CREATE POLICY`, permissive `true` predicate, deprecated role helper, user-editable metadata authorization, `SECURITY DEFINER`, privileged server role grant, destructive table/data DDL, or automatic migration-path file.
6. Validate the machine-readable ownership relationships against actual foreign keys in the snapshot.
7. Run existing root and core build/lint/route/security tests with locked dependency installs.
8. Scan the diff for credential-shaped content and unexpected files.

The static tests deliberately do not pretend to validate Postgres execution, runtime RLS behavior, query plans, or provider settings.

### Local result — August 8, 2026

| Command/check | Result |
|---|---|
| Root locked install | Pass; 87 packages installed from the committed lockfile with scripts/audit/funding disabled |
| Root `npm test` | Pass, 15/15; includes six Supabase design regressions |
| Core locked install | Pass; 443 packages installed from the committed lockfile with scripts/audit/funding disabled |
| Core `npm test` | Pass; TypeScript build succeeded and 57/57 route/security tests passed |
| Core `npm run lint` | Pass with 0 errors and 161 existing warnings in untouched source files |
| Credential-shaped value scan | Pass; no matching value found in changed files |
| Forbidden executable draft SQL scan | Pass; no executable allow policy, grant, destructive table/data statement, deprecated role helper, user-editable metadata authorization, or security-definer function found |
| Staged diff and unexpected-file check | Pass; `git diff --cached --check` was clean and the staged set contains exactly the ten expected additions |

These commands had no database/provider credentials and did not make a network request to Supabase.

## Preconditions for any database trial

Use a disposable Supabase branch or separate development project containing synthetic data only. Never use a real intern, applicant, client, mentor, or administrator record.

- Obtain founder/technical approval for the decisions in `docs/supabase-access-decision-register.md`.
- Confirm exact target project, non-production status, owner, retention window, and cleanup owner.
- Export schema-only definitions and these catalogs without row data:
  - tables, columns, constraints, owners, `relrowsecurity`, and `relforcerowsecurity`;
  - `pg_policies`;
  - schema/table/sequence/function grants and `pg_default_acl`;
  - role attributes including ownership and `BYPASSRLS`;
  - indexes including validity/readiness flags;
  - exposed Data API schemas and registered pre-request/RPC functions.
- Run Supabase Security Advisor and Performance Advisor; preserve findings as evidence without private rows.
- Inventory Edge Functions, RPC consumers, Realtime, and Storage policies that could depend on grants.
- Reconcile announcements, feedback, and resources schema drift.
- Prove how the backend connection role behaves with RLS before changing any table.
- Capture exact compensating SQL from the target's pre-change grants/RLS/index state. Do not use generic broad grants as rollback.

## Staged non-production trial

### Stage 1 — fail-closed access baseline

1. Clone schema into the disposable environment.
2. Create only synthetic fixtures with randomized, non-real names and addresses.
3. Confirm all app schemas are absent from the Data API exposed-schema list unless the test explicitly requires them.
4. If testing the lockdown draft, review the broad function revocation separately; exclude it until every RPC/Edge consumer is accounted for.
5. Run the transactional RLS/grant portion and inspect every notice/error before commit.
6. Test the backend with its actual non-production database role. Do not treat table-owner success as proof that RLS protects a client role.
7. Verify `anon` and `authenticated` cannot select, insert, update, or delete any raw application table.

Expected result for the current draft: direct Data API access fails closed. No user-facing role success is expected or claimed.

### Stage 2 — indexes, one at a time

1. Re-run Performance Advisor and inspect actual query plans/table sizes.
2. Reject candidates that are redundant, invalid for the canonical schema, or unsupported by workload evidence.
3. Apply an approved index with `CREATE INDEX CONCURRENTLY IF NOT EXISTS` outside a transaction.
4. Check `pg_index.indisvalid` and `indisready`; inspect locks, duration, storage, and write latency.
5. Re-run the relevant plan/workload measurement before moving to the next index.

### Stage 3 — future policies only after identity approval

Create no policy until the database can derive an immutable request user and role. Then test at least:

| Synthetic actor | Required allowed cases | Required denied cases |
|---|---|---|
| Anonymous | Only explicitly approved public projection | Raw career/certificate/contact/private tables; every mutation unless separately approved |
| Participant A | Own approved projection | Participant B's row and all cross-tenant rows |
| Intern A | Own profile/progress/application/submission/career descendants as approved | Intern B's rows; ownership reassignment; forbidden status/reviewer/mentor fields |
| Assigned mentor | Only rows for an active canonical assignment | Unassigned intern, expired assignment, founder-only fields |
| Team lead | Only after a real role/assignment exists | Any scope inferred from title/string alone |
| Administrator | Approved administrative operations | Founder/super-admin-only role, settings, and sensitive actions |
| Founder/super-admin | Explicitly approved guarded operations | Anything outside documented branch/scope; no implicit bypass test |
| Backend runtime role | Required API transactions | Unneeded schemas/tables/functions and unsafe owner bypass |

For each proposed `UPDATE` policy, tests must independently prove:

- a matching `SELECT` policy makes only the intended existing row visible;
- `USING` rejects updating another owner's row;
- `WITH CHECK` rejects changing ownership or assignment to escape the policy;
- permitted changes succeed without broadening column access;
- zero-row updates are detected and not counted as successful authorization.

Refresh/revoke synthetic sessions where relevant, delete all synthetic fixtures, and delete the disposable branch/project when evidence is captured.

## Compensating plan

### Current PR

No compensating action is required because no SQL, migration, provider change, or deployment occurred. Reverting the local commit removes only documentation, static tests, and review-only drafts.

### If a future lockdown trial is approved

- Before execution, generate exact `GRANT` statements for every privilege that the target currently has. Store the evidence securely outside public logs.
- If the RLS/grant transaction fails before commit, issue `ROLLBACK` and stop.
- After commit, restore only the captured grants needed by verified consumers.
- Disable RLS only on tables proven by the pre-change export to have had RLS disabled. Do not blanket-disable RLS.
- Because this draft creates no policies, there is no policy object to drop.
- Re-test backend, Data API denial, RPC/Edge consumers, and health after compensation.

### If a future concurrent index build fails or regresses workload

- Check whether the failed build left an invalid index.
- With DBA approval, remove only the exact newly created/invalid index using a concurrent drop where supported.
- Re-run the prior query plan and latency baseline.
- Do not remove pre-existing indexes and do not “roll back” by restoring an older schema dump.

## Stop conditions

Stop immediately and request review if any of these occurs:

- target identity or non-production status is ambiguous;
- a command would touch production or reveal private rows/secrets;
- backend role ownership/bypass behavior is unknown;
- catalog state differs from the documented table/column set;
- a checked Issue #18 box has no catalog evidence;
- a test requires a real person or real business record;
- an index build is blocked, invalid, or causes material write latency;
- compensation would require guessing previous grants or policies.
