# Public release summary — EPDG backend

Updated 2026-11-12.

This page preserves the release history at a high level. Detailed operational journals and provider receipts are kept in a restricted engineering archive. Historical Git commits have not been rewritten.

## Milestones

### 2026-07-11–12 — Backend stabilization and release diagnosis

- Audited the foundation service and `epdg-backend-core` as separate entrypoints.
- Hardened environment validation, authentication and authorization boundaries, CORS, error responses, readiness reporting, and migration handling.
- Kept unapproved or contract-dependent routes disabled. Investigated a failed provider integration without treating it as a successful release.

### 2026-07-25–26 — Release safety and synthetic acceptance

- Reconciled the migration baseline without rewriting migration history or applying a production migration in this work.
- Verified an exact staging candidate's health, strict database TLS, approved-origin behavior, and authentication boundaries using an isolated synthetic identity.
- Removed synthetic records after the scoped checks. The results apply to that reviewed candidate and do not by themselves certify current production behavior.

### 2026-10-27–28 — Hosted application and data-boundary work

- Prepared isolated synthetic application and provider candidates with explicit origin, readiness, ownership, recovery, and authorization boundaries.
- Added focused runtime, CI, and privacy protections; kept sensitive or contract-dependent actions closed pending their required review.
- Recorded provider acceptance separately from source-only preparation. A source draft is not proof that every hosted workflow is operational.

### 2026-11-08 — Runtime safeguards

- Recorded focused service-reliability work and request-parsing protections.
- Kept privileged controls and real-user activation behind their existing release gates. Detailed deployment evidence and rollback steps remain in the restricted record.

### 2026-11-11–12 — Isolated administrator staging

- Prepared a separate backend candidate and private frontend staging site. Exact-head checks passed for the tested candidates, and the frontend loaded the administrator sign-in screen.
- The API health check and unauthenticated session restoration succeeded. Signed-out access to the frontend was blocked by the site's private-access control.
- No reviewer credential or session was created, no existing synthetic account was reused, and no database migration or production-data access occurred.
- Authenticated login, overview, user and role screens, readiness workflows, CSRF and mutation checks, and logout/revocation remain untested because safe staging credential provisioning was unavailable.
- The hosted test is not considered closed until the temporary backend service is stopped and that state is verified. Do not treat the current staging candidate as production-ready or merge it as part of this test.

## Public exposure and release boundary

The earlier publicly reachable version of this file contained one operator email address and detailed operational metadata, including provider and deployment identifiers and hostnames. The current version removes those details. No actual credential value was found by the targeted scan of the journal; this does not certify every historical commit or other repository path. Git history remains unchanged, so earlier values may still be visible there. No indiscriminate history rewrite or production credential rotation was performed.

This staging work changed no production service, production database, public website, real account, or learner record. Both staging code changes remain review candidates. Database changes, if needed later, require a separately reviewed forward-only migration and an explicit rollback or compensating plan.

## Closeout gate

Before a controlled reviewer session can be called accepted:

1. Provision a dedicated synthetic reviewer through an approved secure credential handoff.
2. Verify login, session restoration, authorized screens and actions, CSRF/origin enforcement, logout, and session revocation against the exact deployed commits.
3. Stop the isolated backend service, verify shutdown, and record observed usage and any billing-reporting delay.
4. Revoke or expire any temporary identity or session, then document the final SHAs, results, blockers, and service-scoped rollback instructions.

Preserve production data and existing services. Keep secrets, private records, and account credentials out of this public summary.
