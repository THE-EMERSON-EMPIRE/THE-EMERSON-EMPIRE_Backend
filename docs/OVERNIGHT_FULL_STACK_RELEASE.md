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

## 2026-10-28 — Close compressed JSON crash path and isolate API image build

Reachability triage of the exact hosted entry reproduced 19 vulnerable package
entries in the locked install. One request-path blocker was identified in
body-parser 1.20.5: compressed JSON was accepted before authentication on the
hosted API. Applied the maintainer's documented `inflate: false` workaround to
that JSON parser. The raw HMAC receiver's existing no-inflation guard is
unchanged. No dependency version, lockfile, schema, profile pin or privilege
policy changed. The inventory count remains unchanged; this is a call-path
mitigation, not a clean audit claim.

A disposable child-process regression rejects compressed frames and trailing
bytes with 415, confirms ordinary JSON still reaches its field validation, waits
for delayed decoder failures, checks health remains available and requires a
clean child exit. It installs no uncaught-exception handler. Readiness, shutdown
and forced cleanup are bounded. At `2026-10-28T14:02:25.117Z`, build, **140 core
tests**, **nine root tests** and lint passed with zero errors and 161 existing
warnings using Node 22.23.1/npm 11.17.0. The staged parser/test/image delta was
independently reviewed.

Added the named API-only multi-stage `Dockerfile.hosted-practice` and its
specific default-deny build-context ignore file. Both stages use the verified
official Node 22.23.1 bookworm-slim manifest and explicitly install/assert npm
11.17.0. The build uses normal deterministic install/compilation; runtime uses
the locked production dependencies, compiled assets, non-root `node` user and
dedicated hosted command. It includes no Chromium/snapd installation, build
credential arguments or private environment/key copies. Its build context must
be `epdg-backend-core`. The operator bootstrap remains a separate source job.

No Docker/Podman engine was available locally. Public official image/npm
metadata, source instructions and compiled asset requirements were checked;
no successful container build, provider rollout or runtime image acceptance is
claimed. The deployment owner must build/select this Dockerfile and verify the
exact image, toolchain and fixed API before production release. Existing
privileged controls remain closed. Containment stops the owned API or keeps its
bridge disabled while retaining all synthetic decisions and learning evidence.

## 2026-10-28 — Disabled Supabase synthetic provider candidate

Prepared a separate candidate atop the verified `e854401` Railway baseline for
the newly approved `epdg-portal-synthetic` project. The working Railway profile,
operator bootstrap and original security/learning/hosted SQL remain unchanged.
The new Supabase profile is disabled and selects the verified session pooler on
5432; unknown/mixed providers, unreviewed pooler endpoints, operator/API keys
and TLS downgrades fail closed. Login routing retains the base SQL principal
while using the exact project-suffixed login. The API
continues using opaque portal auth with owner/admin controls closed.

Eleven official-CLI-created, checksum-pinned migrations contain only the seven
new application schemas: 33 RLS tables, 52 policies and 22 triggers. No managed
schema, database ACL or global default privilege changes are included. The
fresh-only operator path creates a dedicated role and four `.invalid` fictional
fixtures; repeat verification preserves all rows and credentials. The runtime
audits exact grants, effective service/browser-role privileges, provider marker,
ledger, synthetic identities, ownership and strict TLS. Inherited PUBLIC TEMP
is explicitly documented and guarded with qualified relations and a pinned
catalog-first/temp-last search path. No service-role route or Supabase Auth is
introduced.

In the isolated candidate, deterministic installation, build, **146 core tests**
(140 existing plus six provider regressions), **nine root tests** and lint
passed with zero errors and 161 existing warnings using Node 22.23.1/npm
11.17.0. Independent source review identified and corrected three issues before
acceptance: managed-default snapshot scope, omitted Supabase role grant drift,
and incomplete source-marker binding. Actual PostgreSQL 17 rehearsal also
identified catalog evaluation-order hazards and an omitted unknown-namespace
boundary; guarded capability queries and exact namespace checks address those
findings. Independent PostgreSQL 17.11 rehearsal passed a clean fresh install,
two repeats preserving rows/passwords, 44 isolation/drift/TLS cases, eleven
preconnect rejections, changed-fixture-password refusal and explicit object
revocation under deliberately hostile global defaults. Managed catalog and
exact DDL bytes were preserved. The local session-route adapter is not a hosted
Supavisor emulator: actual login mapping, startup options, GUC forwarding,
network/credential and provider image acceptance remain pending. No database
switch or successful Supabase deployment is claimed by this source entry.
See `docs/SUPABASE_SYNTHETIC_PROVIDER.md` for operator scope and containment.

The dedicated root-context `Dockerfile.supabase-operator` uses the verified
official Node 22.23.1 image digest, asserts npm 11.17.0 in both stages and runs
as non-root `node`. Its default-deny context and explicit final copies include
only required compiled/source metadata, operator scripts, fictional fixtures
and the eleven reviewed SQL files. It installs no Chromium and copies no
runtime credentials. A provider image build remains required because no local
Docker engine is available.

Two final default parallel runs encountered the existing compression test's
five-second cold-child startup deadline while the other 145 tests passed. The
isolated compression test passed in 3.485 seconds; this was a harness scheduling
issue, with no runtime compression failure observed. The harness now waits up
to 20 seconds for the actual listening signal plus an initial successful
health request, with a separate bounded overall budget. Request limits,
compressed/trailing-payload assertions, child-crash detection and final cleanup
remain unchanged. The default npm test command and all tests remain enabled.
The final default command then passed all 146 tests with zero failures/skips;
the bounded-concurrency diagnostic also passed every test. No runtime behavior,
dependency, lockfile or CI command was changed by the harness correction.

## 2026-10-28 — Backend GitHub verification workflow

Added a separate credential-free CI workflow for pull requests, manual runs and
pushes to main or the Supabase candidate branch. It has read-only repository
permissions, disables checkout credential persistence and uses verified official
checkout v7.0.1/setup-node v7.1.0 commit pins. Both jobs install/assert Node
22.23.1/npm 11.17.0 and use deterministic npm ci. Foundation runs its nine
security tests; core runs the unchanged default npm test command (build plus
146 tests) and lint. No runtime secret, database service, migration or deploy
step is configured, and dependency/script policies remain unchanged.

Workflow YAML and the complete two-file change were reviewed before publishing.
The application/profile/SQL/Docker source remains identical to b682f18. Actual
GitHub job results must match the new workflow commit before being counted as
CI acceptance; this entry does not claim a provider build or deployment. Any
staged operator source pin must be updated deliberately to the chosen commit.

## 2026-10-28 — Complete the durable ownership readiness boundary

The new read-only GitHub workflow completed successfully at 951c6c8 in run
40722653368: nine foundation tests, 146 core tests/build and lint passed on the
pinned toolchain. That run covers the CI-only commit before this separate
runtime correction; a later source head requires its own workflow result.

Independent targeted QA then reproduced two readiness gaps: assigning the app
role ownership of a managed invoker function or enum was accepted. The Supabase
gate now uses PostgreSQL's shared ownership-dependency catalog to reject durable
ownership across object classes, including managed functions/types, default ACLs,
publications and shared/other-database objects. Only objects resolving to actual
PostgreSQL temporary namespaces are excepted; a schema-name prefix cannot bypass
the gate. No role, grant, schema, migration, profile, Docker or CI configuration
is changed by this correction.

The predicate passed six actual PG17 cases, including temporary table/type
preservation and durable function/enum/default-ACL/publication rejection. The
complete compiled-source rehearsal passed 46/46 isolation/drift/TLS cases with
valid no-drift controls, preserving managed catalog/DDL and app/password bytes.
Source closure: 7cb412e3b4e99d7b23ab4e23fb98d2272fdfbe899ec7d5623f7e549427bee244.
The current local default build/test command passed all 146 tests with no skips;
lint passed with zero errors and the same 161 existing warnings. The bounded
four-file diff was independently reviewed before its separate publication.
The provider profile remains disabled. Hosted credentials, Supavisor semantics,
operator image execution and deployment acceptance remain separate gates.

## 2026-10-28 — Private synthetic recovery acceptance operator

Added an explicit opt-in operator script for learner-a@epdg.invalid recovery.
The default bootstrap command, API code, source profile, SQL, role grants and
the preferred learner B alias are unchanged. The operator image copies only
the additional reviewed script and retains its default bootstrap entrypoint.

The helper validates the existing operator project/environment/service and
Supabase route, verifies strict database TLS, immutable instance/hash binding
and read-only startup mode, then proves a newly issued API session hash exists
in that selected database before requesting recovery. All operator queries are
SELECT-only and scoped capture/session/token reads use the fixed fictional
learner. An old Railway target or mismatched database fails before reset.

Normal HTTPS portal requests include the approved Origin, portal request header,
real opaque cookie and server-returned CSRF token for authenticated mutations.
The check requires a generic recovery response, exactly one new private capture,
an exact approved-origin reset link with the 20-minute notice and matching token
expiry, old-session revocation, one-use token rejection and temporary-password
login. It restores the fixture through normal change-password, verifies restored
sign-in and revocation, and logs out test sessions. Finally cleanup attempts the
same API restoration after an ambiguous or failed reset; incomplete restoration
is a failing result. Passwords, HTML, cookies, CSRF and recovery tokens stay in
process, with only fixed-stage/boolean results emitted. No SMTP or handoff key
is used, and no private recovery link is sent to a browser or chat.

Fourteen injected-IO regressions cover preconnect refusal, database-target
binding, capture/link/expiry scope, session/replay behavior, normal restoration,
ambiguous-reset cleanup, restoration failure and secret-free error summaries.
The current source has not executed this acceptance against a hosted API. The
operator must remain opt-in and run only after the API is retargeted and passes
strict readiness; hosted recovery, image and release acceptance are still pending.

## 2026-10-28 — Private operator failure diagnostics

The first hosted Supabase operator image fetched the reviewed 25de51e source
and built with the pinned toolchain, then stopped in the generic bootstrap
failure handler. The provider catalog check afterward showed no application
schemas or application role and the unchanged managed schema ACL fingerprint.
This establishes a safe failed attempt; it does not establish the cause or
imply that the privately entered credential was incorrect. The API remains
on the prior healthy Railway database release while this is investigated.

The operator now emits one privacy-safe JSON failure result with a source-defined
phase and a finite approved SQLSTATE, network or TLS code, or UNCLASSIFIED.
Environment failures may identify a known variable name or fixed check name;
they never include its value or credential length. No raw message, detail,
query, parameters, assertion actual/expected rows, stack or cause is logged.
Private idle pg-client error listeners also stop further work through the same
handler instead of allowing Node to print an unhandled error. Existing provider,
TLS, operator identity, role, SQL, preservation and runtime gates remain intact.
The source profile and migration bytes are unchanged. Retry requires review of
the new safe phase/code result; unchanged blind retries are not acceptance.

Injected-client and actual CLI regressions cover finite-code redaction, forged
metadata, environment refusal before connection, connect/transaction/identity
failure phases and idle error handling. This source preparation changes no
provider configuration, credentials or database objects and claims no successful
hosted bootstrap, recovery check or production publication.

The complete default core build/test command passed 168/168 with no skips;
root tests passed 9/9 and lint passed with zero errors and the existing 161
warnings. Initial sandbox-only root HTTP tests failed to fetch their ephemeral
loopback server, and that restricted core attempt was stopped. The unchanged
default commands passed with loopback networking permitted. The failure was an
execution restriction, not evidence of an application change or hosted fault.

## 2026-10-28 — Canonical synthetic website intake source

Added the independently reviewed website-intake handoff in a separate branch from canonical main `7bfdb114363147ec2998d151dff22a786b2122ba`. All eight delivered files match the frozen producer manifest by exact bytes and SHA-256. Canonical main had no Supabase config or Edge function directory, so the supplied new function stanza becomes the new config without replacing any legacy configuration or function. Its existing `20260708_api_foundation_review.sql` remains unchanged. The branch adds only `website-intake-synthetic`, the single `20261028153644_website_intake_synthetic_bridge.sql` migration, and this journal update. The separate EPDG eleven-migration bundle is absent.

Capture accepts only bounded fictional PILOT records with `.invalid` addresses from the configured preview origin. The fixed-project Edge adapter exposes no mail path. CRM pull/ack uses a distinct HMAC contract binding destination, audience, timestamp, nonce and body; SQL serializes capture/rate/idempotency and acknowledgment, preserves immutable receipt content, enables RLS on all three new tables and revokes browser access. No legacy table, grant or RPC is changed. Runtime variable documentation is limited to purposes: `WEBSITE_INTAKE_MODE` enables the isolated profile, `WEBSITE_INTAKE_PREVIEW_ORIGIN` pins the permitted preview, `WEBSITE_INTAKE_HMAC_KEY` authenticates CRM exchanges, and the Supabase runtime variables provide server-side storage access. No credentials are included.

Independent Deno `2.8.1` validation passed three native tests with network, environment, read, write and subprocess runtime permissions denied, plus lint, frozen type checks and formatting. Pinned Node `22.23.1`/npm `11.17.0` deterministic installs, nine root tests, 57 core tests including build, and core lint passed; both Node suites had zero skips. The producer's eight local SQL acceptance tests and CRM-side test totals are handoff evidence, not newly executed database checks here. Full source review found no blocking issue. Capture error responses omit browser CORS headers, so browsers cannot inspect their intended 409/429 status; success/preflight responses have the configured CORS headers.

This is a source-only draft handoff. No migration was applied, database statement executed, function deployed, runtime key configured, real record copied or email sent. Exact-target hosted intake acceptance remains with the CRM deployment owner. Any later migration operation must explicitly select this sole reviewed intake migration; never use an unfiltered database push or include the EPDG bundle. Compensation disables the new intake endpoint through its runtime feature control, preserves receipt records, and uses a reviewed forward correction if needed. Existing production configuration and owner/admin controls remain unchanged.

## 2026-10-28 — Correct synthetic capture error CORS

The coordinated two-file follow-up fixes the earlier capture-error visibility limitation. CORS is assigned only after the exact capture route and configured preview origin pass validation; its 400/409/429/503 errors retain that origin, `Vary: Origin` and `Cache-Control: no-store`. Foreign origins and private pull/ack errors receive no CORS headers, and error responses do not fabricate signatures. The applied backend patch SHA-256 is `5789d9f08bbb999e1979a1f2f8d614c2cda3ada60e9681adf18180c1365c5260`; the handler exactly matches reviewed producer hash `0bb662ce066934135ff8403c0020e06640fac2cc0821acc2b3708c31b56a84be`.

Native Deno `2.8.1` passed all four tests with network, environment, read, write and subprocess runtime permissions denied, plus lint, frozen checks and formatting. Earlier root/core checks remain historical evidence; the unchanged API entrypoints were not rerun for this focused handler/test correction. Only the handler, its regression test and this journal change. Protocol, runtime configuration, migration and CRM source remain unchanged; the existing foundation-review migration is preserved and the EPDG eleven-migration bundle is absent.

The correction updates the existing draft PR #6 branch. No deployment, database operation, runtime secret change, source merge, real record import or mail delivery occurred. Hosted acceptance remains separate. A focused forward correction or revert of this handler change can compensate without changing stored receipts or legacy workflows.

## 2026-10-28 — Canonical source integration and verified Supabase sessions

Merged canonical main `7a68f1acca420d82c7d1799cf0b5e9f37a343cc4` into
the portal branch through ordinary merge `893ae83920e40ce5bd5b91a084b814294598ef95`.
Both journal histories are retained. The eight intake files match canonical main
and every one of the eleven EPDG migration hashes is unchanged. Intake source
coexistence does not authorize applying its migration to the portal database;
the operator continues to select only its explicit eleven-file manifest. No
unfiltered Supabase push or migration discovery is part of this release.

The corrected private operator attempt created the fresh seven application
schemas, 33 RLS tables and four fictional accounts, preserving the exact managed
schema ACL pin and identity markers, then rejected runtime readiness. Read-only
provider evidence identified PUBLIC SELECT on two managed statistics views
whose schema grants the app no USAGE. The managed table/column/sequence/definer
checks now require schema USAGE and object privilege together. Raw browser ACL
checks, ownership, unknown namespaces, CASE type guards and catalog pins remain
strict. Fresh actual PG17 sessions passed 15 access regressions: hidden grants
remain inaccessible, adding USAGE makes readiness fail, and restored fresh
sessions pass. Revoking USAGE is not claimed to remediate previously resolved
statements in existing sessions.

An actual restricted-app TLS session showed that Supavisor ignored connection
startup options. Explicit session settings passed the unchanged identity and
full access contract. Runtime pool checkout now awaits fixed search-path,
read/write-mode and statement-timeout SETs plus strict readback before exposing
a client. Promise and callback checkout, including Pool.query, share the gate;
reused clients are checked again, and failed setup destroys the checkout with a
fixed privacy-safe 503. Bootstrap operator/runtime clients use the same setup;
the recovery operator explicitly selects read-only mode before its SELECT-only
data reads. No schema, role, ACL, fixture, credential or provider pin changes
are made by this session configuration.

The combined default core build/test command passed 176/176, root tests 9/9,
and lint zero errors with the same 161 warnings. The eight new session tests
cover startup-option loss, deferred promise/callback exposure, Pool.query,
reuse, destruction and redacted acquire/cleanup failures. Native Deno 2.8.1
passed all four intake tests with network/environment/filesystem/subprocess
permissions denied, frozen checks, lint and formatting. Windows checkout CRLF
caused the initial format-only failure; exact canonical Git blobs passed in an
isolated evidence directory without changing source bytes. The source profile
remains disabled. Hosted operator repeat, API retargeting, recovery, CRM
roundtrip and production publication remain separate acceptance gates.

## 2026-10-28 — Native intake checks in backend CI

Added a separate native Deno job to the existing read-only backend workflow.
Official denoland/setup-deno v2 is pinned to verified commit
`22d081ff2d3a40755e97629de92e3bcbfa7cf2ed`; the runtime is pinned to Deno
2.8.1 and checked explicitly. The job runs the four native tests with network,
environment, filesystem and subprocess permissions denied, frozen type checks,
lint and formatting. Checkout does not persist credentials. Existing root and
core jobs and toolchain policies are unchanged. The workflow adds no database,
service, runtime credential, migration or deployment step. Source, SQL, profile
and provider configuration are unchanged by this separate CI commit. Its actual
current-head result must pass before the next operator release is accepted.
