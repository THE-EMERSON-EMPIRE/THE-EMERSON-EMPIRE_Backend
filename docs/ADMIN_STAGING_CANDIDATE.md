# EPDG administrator staging candidate

This candidate is an isolated implementation branch. It does not enable the
real founder identity, apply its migration to Supabase, change SSO, deploy a
site, or activate learners. Local and Neon staging tests use only synthetic
identities at `@epdg.invalid` and separate isolated databases.

## Implemented in this candidate

- Cookie-backed login, logout, and session restoration use the existing
  security foundation. Administrator permissions are resolved on the server.
- An explicit `founder_admin` role is separate from the legacy administrator
  label. A new account can use that role only through a reviewed bootstrap
  operation outside the portal.
- `webdev_technical` is a separate role with no effective permissions while its
  scope is unapproved. The staging UI can submit a pending review request; it
  cannot activate the request or grant access.
- The overview and user list read only verified, active synthetic EPDG accounts
  in the isolated local or exact Neon staging profile. They do not read CRM
  applicants or resumes.
- Program, cohort, and assignment screens report their integration state and
  remain read-only until an approved education schema and ownership map exist.
- Role requests create an audit event. Session fingerprints include active
  portal roles, so a reviewed role change invalidates existing sessions.
- A forward-only migration adds two private-schema tables, enables RLS, and
  grants no access to `PUBLIC`, Supabase `anon`, or Supabase `authenticated`.

## Readiness

| Feature | Candidate status | Production boundary |
| --- | --- | --- |
| Secure login, logout, session restore, CSRF | Implemented; local API, Neon integration, and browser checks passed | No real account verified; production remains locked |
| Server role and permission checks | Implemented; unit/API/browser checks passed | Founder bootstrap is deliberately unavailable in the UI |
| Overview and synthetic user list | Implemented against isolated API | Filters to `SYNTHETIC` `@epdg.invalid` rows |
| WebDev access request | UI/API checks passed; requests remain pending | Grants no permission; scope still needs approval |
| HR/applicant onboarding | Reserved for Emerson CRM | EPDG does not read or activate CRM applicants |
| Programs, cohorts, assignments | Readiness foundation tested; controls stay read-only | Education schema and mapping remain unverified |
| Real founder login | Blocked pending identity verification | No account creation, password reset, or role change performed |
| Production database migration/deployment | Not performed | Requires backup, reviewed runtime grants, rollback plan, and separate approval |

## Pre-reconciliation verification history

The results below were recorded on the original PR #11 branch before this
candidate was ported onto current `main` at `b1ce7b415d9d77eef42219d8976115868d5fb8aa`.
They are historical local and Neon integration evidence; the current-main port
has its own verification status recorded after this section.

## Verification results from the original PR #11 branch

All tests used the isolated local PostgreSQL cluster and fictional @epdg.invalid
accounts. The local stack was stopped after verification; its private synthetic
files remain in the ignored .local-synthetic directory.

- Backend foundation tests: **9/9 passed**.
- EPDG backend build and test suite: **151/151 passed**; lint exited 0 with
  161 existing warnings and no errors.
- EPDG frontend: **93/93 passed**; lint exited 0; isolated build produced one
  noindex HTML entry point and passed the artifact-boundary checks.
- API checks passed for login, cookie-backed session restoration, logout,
  CSRF enforcement, unauthenticated and non-admin denial, synthetic user
  isolation, audit writes, and pending-only WebDev requests.
- Browser checks passed for sign-in, overview data, Users/Roles/Programs
  navigation, recording a pending synthetic WebDev review request, session
  restoration after reload, and logout.
- Education management controls remain disabled. No production database,
  deployment, account, role, SSO, learner record, or public site was changed.

The administrator migration is 2026-11-09-portal-admin-staging-v1
(ea4ae65230ac022196500425ad61c6864c688afce3c6cf52f64d96d8a2578a5c). It is
applied to the separate local synthetic database and the dedicated Neon
`staging` child branch. It was not applied to Supabase or production.

## Historical 2026-11-10 Neon staging integration update

- Neon project `lively-hill-76068632`, branch `br-plain-unit-bc3s0lqy`, database
  `emerson_epdg_portal_app` is pinned in the backend candidate profile. The
  branch is isolated from the default branch and runs PostgreSQL 17 in
  `aws-us-east-1`.
- The three checksummed security, admin, and synthetic-foundation migrations are
  recorded on that child branch. Sixteen tables have RLS enabled; there are no
  `PUBLIC` policies. The separate `epdg_portal_runtime` role has no privileged
  membership, account activation, user deletion, identity-password, or schema
  creation permissions.
- Local API integration against Neon passed TLS readiness, synthetic login,
  cookie session restoration, admin overview/user reads, CSRF denial,
  pending-only WebDev request, absent learner/recovery routes, runtime
  privilege checks, and logout. The branch contains two `@epdg.invalid`
  synthetic identities and one pending synthetic WebDev request; it has no
  learner, school, company, or real HR records.
- Current backend repository root tests pass 9/9, the `epdg-backend-core` build
  and suite pass 157/157, and lint exits 0 with 161 existing warnings. Frontend
  tests pass 93/93, with lint and isolated build checks passing.
- This integration was exercised locally against the hosted Neon branch. No
  Railway service or URL exists yet. Deployment is blocked by the missing
  organization GitHub App installation and separate Railway billing approval.
  PR #44 remains draft; no production deployment, identity, role, SSO, or
  learner state changed.

## Migration and rollback notes

The migration is additive and does not backfill users or role assignments. For a
future production release, first confirm the deployment target and take a
restorable database backup. Apply the reviewed migration with the exact
least-privilege backend role grants; do not expose these tables through the
Supabase Data API. Validate the migration checksum, RLS state, role grants,
login denial for unassigned users, session revocation after role changes, and
audit writes before opening the portal. If validation fails, keep the portal
closed and disable the feature; do not delete audit data or rewrite migration
history. A schema rollback has not been authorized or prepared because it could
discard review records.
