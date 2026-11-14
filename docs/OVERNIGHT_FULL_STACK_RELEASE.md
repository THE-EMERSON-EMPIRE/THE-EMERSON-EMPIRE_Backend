# Public release summary — EPDG backend

Updated 2026-11-14.

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

### 2026-11-14 — Local invitation lifecycle review

- Continued the existing backend on the PR #13 baseline, preserving the separate admin staging and learner applications. Added a local-only invitation review flow using existing stable identities, bcrypt sessions, and the existing Mailpit delivery adapter.
- Added checksummed additive review tables, private token hashes, explicit onboarding eligibility, idempotent issue/resend tracking, one-time email confirmation/password setup, account activation, and session revocation. Requested privileged roles remain proposals with no permissions granted. Production and hosted invitation release remain unavailable.
- Validation: foundation 9/9; core 194/194; native PostgreSQL and Mailpit 50 checks; TypeScript build passed; lint has zero errors and 161 legacy warnings. The native tests exercised concurrent issuance/acceptance, expiry/replay, delivery failure/resend, credential/account changes, and runtime grants. These are local fixture results, not production authentication evidence.
- A separate security review found and corrected a local route-composition regression so admin middleware cannot intercept learner multipart uploads. The targeted HTTP regression passes.
- Targeted reviewed dependency remediation removed all reported advisories: both root and core npm audits now report zero. Compatible transitive patches, narrow overrides, Nodemailer 10.1.4, and removal of an unused Puppeteer dependency were followed by deterministic installs, full tests, and real SMTP checks. The bounded operator disable CLI also passed native revocation/audit checks.
- No production migrations, real accounts, real emails, provider settings, Netlify restrictions, paid resources, or existing hosted services were changed. The private local fixture is retained for browser review; its credentials/tokens and the real-account register remain outside Git.
- See `docs/EPDG_INVITATION_REVIEW.md` for architecture, API behavior, migration boundaries, evidence, remaining release work, and the local shutdown/compensating procedure. Do not merge or publish this candidate as a production release.

## 2026-11-14 — Portable account and education release candidate

- Continued the existing PR 14 branch and custom bcrypt/cookie architecture. Added disabled-by-default portable account provisioning, frozen founder-approved plans, HR verification references, stable-ID reconciliation, eleven scoped roles, guarded existing-provider invitation transport, administration tracking and safe self-profile/resource routes. No parallel identity provider or login application was introduced.
- Added explicit operator-only access/account/education migration tooling with checksum ledgers, minimum runtime privileges, per-role server boundaries and session-bound education RLS. Startup only verifies schema/readiness. The local-only Phase One invitation schema remains distinct from the portable release candidate.
- Final synthetic evidence: fresh native master 356 checks; independent role/account SQL 227 checks; independent education SQL 32 checks. The master includes the 61-check lifecycle/concurrency helper, so these overlapping checks are not additive. All eleven roles completed real HTTP invitation/password setup/login/session/workspace/profile flows. Learning submissions, revisions and mentor feedback were exercised through the actual service routes.
- Root tests 9/9, core tests 203/203 and build pass. Lint reports zero errors and 161 pre-existing warnings. Both npm audits report zero advisories. CI and browser evidence are recorded against the committed candidate in the external readiness report.
- Native verification found and fixed missing service-role identity RLS policies, stale target-role authorization, nullable approval checks, invitation hash disclosure, historical email normalization, and resource-scoped self-profile denial. A legacy planner test double was updated to recognize the normalized identity query; its transaction/rollback assertions remain intact.
- Production migrations, founder bootstrap, account provisioning, real mail, hosting unlock, deploy/merge and spending remain unperformed. The reviewed target, real-account register, sender verification, exact role approvals and individual live sign-ins remain release gates. See the account/access/education runbooks and role matrix; private credentials, tokens and roster stay outside Git.

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
