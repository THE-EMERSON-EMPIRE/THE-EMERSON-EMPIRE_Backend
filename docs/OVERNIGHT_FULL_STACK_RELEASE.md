# Overnight full-stack release journal

All timestamps use America/New_York. This journal records variable names only and contains no secret values or private records.

## 2026-07-11 20:58 - Backend audit and local stabilization

### Scope

- Repository: `webdev692/THE-EMERSON-EMPIRE_Backend`
- Branch: `codex/full-stack-release-2026-07-11`
- Starting commit: `c2ce386`
- Worktree: isolated backend release worktree

### Audit completed

- Inventoried every tracked file and both backend entrypoints.
- Reviewed startup, route mounts, authentication, role guards, approval state, database connection, CORS, environment handling, health responses, Railway configuration, tests, migrations, schema reference, and frontend network calls.
- Confirmed the root foundation and `epdg-backend-core` expose different route surfaces.
- Confirmed the authoritative Railway service and API origin cannot be selected from repository evidence alone.

### Local changes prepared

- Added permanent repository rules and pinned Node/npm declarations.
- Added deterministic lockfiles and cross-platform migration-copy build tooling.
- Added fail-closed environment validation and production CORS handling.
- Removed application-startup migration execution and migration-history deletion.
- Added database-aware, privacy-safe readiness responses and JSON 404 handling.
- Added a final 5xx response sanitizer for controllers that catch errors directly.
- Added live database authorization checks for role, approval, deletion, mentor flag, super-administrator rank, and forced password change.
- Replaced mentor assignment authorization by mutable display name with the existing mentor foreign key.
- Rejected public administrator registration.
- Protected and disabled the fake legacy user scaffold.
- Synchronized core/EPDG soft deletion, approval/rejection, and mentor password changes.
- Made every AuthService core/EPDG identity mirror write transactional, with row-count verification and rollback on mirror failure.
- Removed public passport email output and hardcoded mentor-name assignment pools.
- Restricted CV parsing to the configured Supabase storage origin with redirect, timeout, and size limits.
- Kept anonymous CV upload unavailable until a private ownership-verifiable storage flow exists.
- Kept token refresh unavailable until rotating revocation state exists; access tokens use an explicit purpose, HS256, and a one-hour lifetime.
- Kept legal agreement acceptance, legacy onboarding completion, private submission writes, intern session rating, and certificate issuance unavailable pending their controlling contracts.
- Kept `/api/signup` and `/api/portfolio/*` unmounted rather than inventing incompatible handlers.
- Disabled the root unauthenticated deliverable write route.
- Restricted public contribution reads to public career files attached to approved, active profiles.
- Removed the stale certificate frontend fallback and made certificate links use required configuration.
- Tightened the final 5xx response boundary so arbitrary controller fields cannot cross it.
- Corrected the placement query to use the schema's `accepted` application status and removed queries for a nonexistent intern-profile deletion column.
- Added exact route/frontend coverage documentation and release blockers.

### Commands and interim results

- `git branch --show-current`: `codex/full-stack-release-2026-07-11`.
- `git status --short`: clean before implementation.
- `git diff --check`: passed before implementation.
- Official Node `22.23.1` archive: SHA-256 verified before use.
- Official npm `11.17.0` package: registry integrity verified before use.
- Root `npm ci --ignore-scripts --no-audit --no-fund`: passed, 87 packages.
- EPDG core `npm ci --ignore-scripts --no-audit --no-fund`: passed, 445 packages.
- Root `npm test`: passed, 6 tests.
- EPDG core `npm run build`: passed.
- EPDG core `npm run lint`: exited successfully with zero errors and 166 existing warnings, primarily explicit `any` and console warnings.
- EPDG core `npm test`: passed, 17 tests.

Dependency installation reported upstream deprecation warnings for legacy ESLint/glob support packages. No install lifecycle scripts were run.

### Database and service actions

- Migrations prepared: none.
- Migrations applied: none.
- Supabase changes: none.
- Railway deployment: none.
- Environment-variable changes: none.
- Local commits prepared: `9c41b24` (`fix: harden backend runtime foundation`) and `cc605ca` (`fix: enforce backend auth and route contracts`).
- Git pushes: none.

### Blockers

- Authoritative Railway project/service, root directory, and API origin.
- Historical migrations `011` and `024` contain table drops and cannot be approved as production-safe.
- Tracked migration/schema drift for announcements, feedback, and resources.
- Reviewed RLS/grant matrix for `core` and `epdg`.
- Live row-level `core.users` / `epdg.users` ID, EPDG branch-role, and password-hash parity verification.
- Final company, school, mentor, administrator, and founder permission matrix.
- Mentor-session lifecycle, scheduling ownership, cancellation/confirmation, and rating/notes visibility rules.
- School type/location normalization between the frontend, service, and tracked schema.
- Missing company/school dashboard APIs, portfolio APIs, generic signup compatibility, and internship-application review transition.
- Backend-only opportunity routes have no active frontend consumer or current browser evidence.
- Private CV/submission delivery and storage policy.
- Production environment values and provider access.

### Rollback and compensating plan

No external state changed. The two local commits are unpublished and remain reviewable; any correction should be a focused follow-up commit rather than a reset or history rewrite. After any future code deployment, Railway rollback must select the last verified deployment for the same service and commit. Database changes require a separately reviewed forward compensating migration; destructive rollback is prohibited.

### Latest local verification

- Offline manifest/lock regeneration check: passed for both packages.
- Manifest/lock parity and exact direct-version check: passed for both packages.
- Root tests: 9 passed, 0 failed, 0 skipped, 0 canceled.
- EPDG build: passed.
- EPDG lint: exited `0` with 0 errors and 161 warnings; warnings remain a documented code-quality debt and were not suppressed.
- EPDG route/security tests: 38 passed, 0 failed, 0 skipped, 0 canceled.
- `git diff --check`: passed.
- High-confidence secret-pattern scan: passed.
- Names-only environment example scan: passed.
- Tracked generated/environment artifact scan: passed.
- Nested EPDG Git repository check: passed.

The verification above is local worktree evidence only. No backend deployment, Railway environment change, live database migration, external storage change, merge, or production verification occurred.

## 2026-07-12 - Branch publication and failed Railway integration deployment

### Git and review evidence

- Published `codex/full-stack-release-2026-07-11` with commits `9c41b24`, `cc605ca`, and `f7298b3`.
- Opened draft backend PR `webdev692/THE-EMERSON-EMPIRE_Backend#2` from the release branch into `main`.
- No merge, history rewrite, force push, or manual deployment command occurred.

### Railway evidence

- GitHub attached a Railway status to exact backend head `f7298b3` with context `epdg platform - tranquil-tenderness`.
- The status identifies Railway project `34659053-7658-4d6e-8d0e-469f91ec6058` and service `fccb017f-ec3a-472e-ab19-f72011bf84f7`, proving a repository-to-service integration for this commit.
- The Railway status for the then-current head was `failure`; it was not release
  verification and could not be converted to success without deployment logs
  and a current-commit health check.
- Railway CLI authentication remained unavailable after the browser OAuth flow timed out, so the failed deployment logs, configured root directory, environment names, and runtime database role could not be inspected.
- Read-only public probes found `https://tranquil-tenderness-productionepdg.up.railway.app/health` at `200` and `OPTIONS /api/auth/login` at `204`. That running host predated the failed then-current-head deployment and was not evidence that `f7298b3` was live.
- No production environment-variable value was read, printed, or changed.

### Updated release and rollback boundary

The provider's Git integration attempted and failed a deployment after the branch push. No successful backend release occurred. Preserve the last working Railway deployment while the failure is diagnosed; do not redeploy, promote, or change environment variables until authenticated provider logs prove the service root/build/start contract. If a later verified deployment fails, roll back through Railway to the last known-good deployment of this same service and repeat privacy-safe health, CORS, authentication, and route-guard probes. Database compensation remains forward-only.

## 2026-07-12 - Authenticated Railway diagnosis and explicit CORS preparation

### Provider mapping and failed-build diagnosis

- Authenticated Railway UI evidence maps project `epdg platform`, service `tranquil-tenderness`, repository `webdev692/THE-EMERSON-EMPIRE_Backend`, and service root `/epdg-backend-core`.
- Environment `production_epdg` owns the running public host `tranquil-tenderness-productionepdg.up.railway.app`.
- The failed PR deployment log showed the explicit `npm ci` in `railway.toml` ran after Railway had already installed dependencies and failed with `EBUSY` on the mounted `/app/node_modules/.cache` directory.
- `epdg-backend-core/railway.toml` now leaves deterministic installation to Railway/Nixpacks and retains only `npm run build` as the application build command. Local clean installation, build, lint, route/security tests, and configuration assertions passed before publication.

### CORS environment preparation

- Added the non-secret `CORS_ORIGINS` variable to `production_epdg` with only the canonical production frontend and PR #27 preview origins; no wildcard was used and no secret value was read or printed.
- Railway applied the variable change. The then-running older backend accepted
  the production origin (`204`) but rejected both the PR preview and an
  untrusted origin (`500`), proving that deployment did not consume the new
  environment-driven allowlist.
- Do not treat CORS as verified until the hardened backend commit is deployed and exact preflight checks return the requested origin for both production and PR preview while continuing to deny an untrusted origin.

No backend merge, successful backend code deployment, database migration, Edge Function deployment, or frontend merge occurred during this step. If the next deployment regresses health or route guards, roll back the Railway service to its last known-good deployment and retain the explicit origin allowlist for the corrected release.

## 2026-07-25 - Backend release-safety reconciliation

### Provider evidence at that time (superseded on 2026-07-26)

- The single Railway target is recorded in
  `docs/RAILWAY_DEPLOYMENT_MANIFEST.md`: project `epdg platform`, service
  `tranquil-tenderness`, repository
  `webdev692/THE-EMERSON-EMPIRE_Backend`, and root
  `/epdg-backend-core`.
- Backend PR #2 was draft at historical release head `f6f8670`.
- The Railway status for that historical head was failed. The build succeeded,
  but startup
  exits at the database stage with PostgreSQL code `28P01`; no credential value
  was read, logged, copied, or changed.
- Read-only probes found the mapped `production_epdg` host unavailable.
  Historical `backend-*`, `the-emerson-empirebackend-*`, and PR-preview hosts
  returned Railway `Application not found` or were unavailable. None is release
  evidence.

### Local safety changes prepared

- Added an exact, LF-normalized `001`-`033` source-only migration evidence
  baseline.
- Kept historical SQL and hashes unchanged. Migrations `011` and `024` are
  already applied in the live ledger and are never pending.
- Removed application-side migration execution and the
  `postgres-migrations` runtime dependency. The build rejects unexpected
  source filenames, clears stale copied artifacts, and excludes all historical
  SQL from `dist`.
- Added a credential-free-origin EPDG readiness smoke script and focused tests
  for baseline exclusion, fail-closed behavior, and the readiness contract.
- Reconciled deployment documentation around the one mapped target, historical
  origins, separate `DB_*` connection method, and safe names-only credential
  verification.

### Working-tree verification at that time

Using Node `22.23.1` and npm `11.17.0`:

- Root security tests: `9/9` passed.
- EPDG build: passed.
- EPDG route/release-safety tests: `47/47` passed.
- EPDG lint: exit `0`, `0` errors, `161` existing warnings.
- Missing `EPDG_API_ORIGIN` smoke invocation: rejected with the expected
  privacy-safe exit and error type only.

These results apply to the uncommitted working tree based on `f6f8670`. They
must be repeated after commit and do not prove a Railway deployment or live
database contract.

### Live migration-ledger verification

A metadata-only comparison on 2026-07-25 confirmed that the live
`public.migrations` ledger contains bootstrap ID `0` and the complete
repository baseline at IDs `1`-`33`. All 33 names and
`postgres-migrations` SHA-1 values match the repository files after normalizing
the Windows checkout to the LF line endings used by the deployment runtime.
The destructive historical migrations `011` and `024` are already represented
in that ledger and are therefore baseline-only, never pending. No migration or
application row was executed, repaired, or changed by this comparison.

### External state and release boundary at that time

No backend database migration, Railway deployment, provider environment
change, storage change, merge, commit, or push occurred during this step.
Railway database authentication, exact-head health/CORS/auth probes, live
schema parity beyond the proven migration ledger, and the reviewed RLS/grant
model remained release blockers at that time.

The release-candidate blockers in this July 25 section were superseded by the
verified July 26 PR-environment evidence below. The separate schema and
RLS/grant decisions were not changed by the runtime recovery.

## 2026-07-26 - Exact-head Railway recovery and authenticated release gate

### Superseding release-candidate evidence

- Prior verified runtime code head:
  `138608083efe273e7bd20ecd101a0efa5b6700f5`.
- Successful Railway PR deployment:
  `16c0c861-1d01-40fa-bed8-0330c1f88460`.
- PR environment origin:
  `https://tranquil-tenderness-the-emerson-empirebackend-pr-2.up.railway.app`.
- Builder/runtime: Nixpacks with Node `v22.14.0`.
- The application loaded and validated the protected Supabase CA certificate,
  retained `rejectUnauthorized: true`, completed strict-TLS database
  authentication, and completed a fresh `SELECT 1`.
- Production configuration validation and database readiness completed before
  the application listened on the Railway port.
- `GET /health` returned HTTP `200` with the intended healthy response.
- No `SELF_SIGNED_CERT_IN_CHAIN`, PostgreSQL `28P01`, or startup migration
  activity remained in the verified deployment evidence.

### CORS, authentication, and isolation evidence

- The configured approved production frontend and PR #27 preview origins were
  accepted with exact allow-origin headers.
- An untrusted origin was rejected with HTTP `403` and no allow-origin header.
- A clearly labeled synthetic pending-company identity signed in successfully,
  and the self-scoped `GET /api/auth/me` route returned `200`.
- The same least-privileged role received `403` from
  `GET /api/admin/stats` before controller or reporting execution.
- Missing, malformed, correctly signed expired, and previously valid
  post-cleanup tokens returned `401`.
- The identity had no profile or related application, assignment, certificate,
  directory, notification, marketing, or workflow records.
- The three synthetic identity rows were hard-deleted immediately after the
  probes. Independent cleanup verification found zero related synthetic rows,
  and no real user or business record was accessed or modified.
- Post-cleanup `GET /health` remained HTTP `200`.

### Verified application-code checks and artifact safety

Using Node `22.23.1` and npm `11.17.0` locally:

- Root foundation tests: `9/9` passed.
- EPDG production build: passed.
- EPDG tests: `55/55` passed.
- EPDG lint: exit `0`, zero errors, 161 existing warnings.
- The built artifact contained no SQL, no `dist/db/migrations`, no migration
  executor, and no `postgres-migrations` runtime dependency.
- Build, deployment, runtime, tracked-file, and built-artifact scans found no
  database URL, password, bearer token, compact JWT, API key, private key, or
  certificate material.
- No source credential, QA credential, token, or private identifier was
  committed or attached to release evidence.

This journal entry is part of a later documentation-only commit and therefore
does not self-assert that commit's SHA or Railway deployment. Attach the new
documentation SHA and its exact-deployment verification to PR #2 after both
exist.

### Release boundary and rollback

Backend PR #2 moved to ready for review but remained open and unmerged. No
Railway Production environment, frontend file, Netlify production deployment,
Supabase schema, migration, Edge Function, production record, or real-user
record changed.

For PR-environment application rollback, redeploy exact runtime code head
`138608083efe273e7bd20ecd101a0efa5b6700f5` using verified deployment
`16c0c861-1d01-40fa-bed8-0330c1f88460` as the known-good anchor, then repeat
strict TLS, `SELECT 1`, readiness, CORS, authentication, cleanup, and
privacy-safe log checks. No database rollback or migration compensation is
required for the documentation reconciliation.

## 2026-10-27 — Disabled hosted synthetic application source candidate

Prepared the hosted application and explicit operator bootstrap source atop the
sealed-listener commit `04da9f7ad5e8c70673e04a9125370457491529cb`. The candidate
carries the prior cookie-session, recovery, scoped learning, submissions, private
attachments, mentor feedback, revisions and CRM handoff dependencies as focused
new modules and forward migration files. Existing authorship/history and the
schema baseline are preserved. Owner/admin, registration, invitations and role
management remain closed; no real HR records or operational credentials belong
in this source or synthetic database.

The dedicated hosted entry requires strict CA and hostname verification,
NOBYPASSRLS readiness, exact reviewed provider/database/origin pins and private
runtime access. The source profile remains disabled, with the backend origin
unassigned. Verified frontend/CRM source pins are present, including the exact
hosted-practice preview. These pins do not activate the bridge. Normal startup
cannot run migrations; the separate bootstrap job requires its own credentials,
an empty recognized database and reviewed immutable source hashes.

At `2026-10-27T14:16:36.188Z`, the isolated checkout's pinned Node 22.23.1/npm
11.17.0 deterministic root/core installs, build, **139 core tests**, **nine root
tests** and lint passed. Lint had zero errors and 161 existing warnings. Tests
use synthetic fixtures, mocked database results and temporary loopback servers.
The original working checkout was not changed. Source-only verification receipts
are kept outside this public repository in workspace evidence; no private test
state, credential, key, capture content, compiled artifact or evidence file is
included in the candidate.

The checksum-frozen baseline remains SHA-256
`263b273cd4d636bab100f1fac61b00d8cb88c99753182cd4cce19d524ad6b30f`.
Its existing trailing blank line is retained as a cosmetic diff-check exception;
all other candidate whitespace checks pass. Explicit LF attributes preserve the
baseline and new migration checksums across platform checkouts. No migration
checksum was changed to accommodate formatting.

Commit, push, hosted bootstrap, deployed TLS, authenticated hosted CRM delivery,
same-origin proxy/browser acceptance and production publication remain separate
review/release steps. This source candidate performs none of them. Containment
keeps the profile/bridge off or stops the owned app service while preserving
identity, decisions, nonces, submissions and feedback. Any database correction
must be reviewed and forward-only; do not rewrite applied history or delete
learning evidence.

## 2026-10-27 — Pin authorized hosted synthetic HTTPS origins

Enabled the reviewed hosted synthetic source profile after explicit authorization
for its public HTTPS endpoint and private runtime credential destinations. The
backend audience is the provider-verified
`https://epdg-practice-api-synthetic-hosted.up.railway.app` origin. Recovery links
use `https://hosted-practice--epdg.netlify.app` for acceptance testing; the exact
production frontend remains an allowed origin but is not the current recovery
destination. The CRM origin remains `https://emerson-crm.netlify.app`.

All provider IDs, database identity/role, instance, baseline/isolation hashes and
operator bootstrap service pin are unchanged. The preferred login alias still
resolves only to the existing fictional learner B account; database identities
and recovery-mail recipients remain `.invalid`. Owner/admin, registration,
invitations and role-management controls remain closed.

At `2026-10-27T18:25:57.184Z`, the pinned Node 22.23.1/npm 11.17.0 toolchain
passed build, **139 core tests**, **nine root tests** and lint with zero errors
and 161 existing warnings in the isolated release checkout. The source change
contains no credentials, private key, real record or runtime state. The original
working source remains unchanged. Automation-assisted configuration and
verification used the connected repository account's verified commit identity.

This source change does not apply database schema, inject credentials or deploy
the API. Runtime access still requires exact configuration, strict CA/hostname
verification, the reviewed isolated schema and current readiness checks. Hosted
bootstrap, actual API deployment and end-to-end acceptance remain separately
verified operations. Production recovery-link promotion follows acceptance.
Containment disables the source profile/bridge or stops the owned service while
retaining decisions, nonces and immutable learning evidence; never reverse the
applied migration history or delete retained work.
