# Deployment and rollback runbook

No deployment was performed as part of the 2026-07-11 backend audit. A later
July 26 release record documents merged backend `main` commit
`7bfdb114363147ec2998d151dff22a786b2122ba` and successful Railway Production
deployment `cbb535d2-bff0-43af-839b-26e53e5a97dc`. That is historical evidence,
not permission to deploy or proof of current health.

## Selected target

Authenticated provider evidence selects project `epdg platform`, service
`tranquil-tenderness`, repository `webdev692/THE-EMERSON-EMPIRE_Backend`, and
service root `/epdg-backend-core`. The July 26 record maps the Production
environment as `production_epdg`. Exact IDs, the mapped host, dated evidence,
historical origin classifications, and safe dashboard checks are maintained in
[RAILWAY_DEPLOYMENT_MANIFEST.md](RAILWAY_DEPLOYMENT_MANIFEST.md).

The selection does not establish current release health. At approximately
12:07 EDT on August 8, the canonical `/health` endpoint returned its
privacy-safe HTTP `503` unavailable contract on three read-only checks. The
cause and active source SHA remain unverified; the root JavaScript service must
not be substituted.

## EPDG service commands

```text
Install: Railway/Nixpacks-managed
Build: npm run build
Start: npm start
Health: /health
```

PowerShell readiness smoke with an explicit reviewed target:

```powershell
$env:EPDG_API_ORIGIN='https://reviewed-api-origin.example'
npm run smoke:health
```

POSIX readiness smoke with an explicit reviewed target:

```sh
EPDG_API_ORIGIN='https://reviewed-api-origin.example' npm run smoke:health
```

The checked-in `epdg-backend-core/railway.toml` encodes the builder, build,
start, readiness, and restart commands. The package manifests and `.nvmrc`
declare the repository baseline of Node `22.23.1` and npm `11.17.0`; they do not
prove the effective provider toolchain. July 26 release evidence recorded
Nixpacks Node `v22.14.0` and did not record npm. Confirm both effective versions
from the current authenticated Railway build evidence.

## Pre-deployment gates

- Root tests, EPDG build/tests/lint, diff check, and credential scan pass at the
  exact commit. All recorded July results are historical and must be rerun.
- Required environment variable names are present without logging their values.
- Production CORS is an explicit allowlist.
- The application contains no migration execution path, and the build excludes
  all historical SQL from the runtime artifact.
- The source-only `001`-`033` audit baseline matches live history; historical
  destructive migrations `011` and `024` are already applied and never pending.
- Every future database change uses a separately reviewed forward-only operator
  workflow with a compensating plan.
- A live schema-only comparison resolves announcement, feedback, and resource drift.
- `npm run smoke:health` passes against the exact deployed commit.
- Current-commit protected routes return `401` or `403`, not `404`; this must be verified against the same Railway deployment commit.
- Fail-closed routes remain fail-closed: `/api/auth/refresh`, `/api/upload/cv`, agreement acceptance, legacy onboarding completion, private submission writes, intern session rating, and certificate issuance.
- Unmounted compatibility paths remain documented as unavailable: `/api/signup`, `/api/portfolio/*`, company dashboard APIs, and school dashboard APIs.

## Unresolved release blockers

- The August 8 canonical readiness response is `503`; authenticated dashboard
  evidence is required for the active deployment/source SHA, service root,
  restart history, build/application logs, database/TLS startup, and effective
  Node/npm runtime. The response alone does not diagnose the cause.
- Repository Node `22.23.1` differs from the July 26 Nixpacks runtime record of
  Node `v22.14.0`; runtime pinning remains a reviewed dashboard decision.
- The final company, school, intern, mentor, administrator, and founder role/permission matrix.
- The mentor-session state machine, scheduling ownership, update/cancellation permissions, and rating/notes visibility rules.
- Private CV, submission, portfolio, and certificate storage ownership, bucket policy, upload, and time-limited delivery contracts.
- Tracked-versus-live schema drift for announcements, feedback, resources, and identity mirrors.
- School registration field normalization: the database uses the lowercase school-type enum and stores location in `schools.county`; the current frontend values and displayed `country` field need an agreed mapping.
- Backend-only opportunity routes have no active frontend consumer or end-to-end verification.

## Environment changes

Record environment changes by variable name only. Never copy values into this
repository or release evidence. The service mapping and canonical Production
origin are historically recorded, but any frontend or provider change remains
blocked until authenticated evidence establishes a healthy exact deployment.

Do not change `VITE_API_URL`, database, email, storage, or signing variables
until the release gates pass. `CORS_ORIGINS` was updated by name on July 12;
verify its presence and behavior without recording its value.

## Rollback

For a code-only Railway release, select the last verified deployment for the same service and commit, redeploy it, and re-run `/health`, CORS, and unauthenticated protected-route checks. Do not roll back by rewriting Git history.

Database changes require their own reviewed compensating migration. Never drop, truncate, reset, or restore over production records as an application rollback shortcut.

The July 26 successful Production deployment is the historical release anchor;
the dashboard must confirm whether it remains available before it is used as a
rollback target. This documentation/CI reconciliation performs no deployment,
provider change, live migration, external-storage action, or data write.
