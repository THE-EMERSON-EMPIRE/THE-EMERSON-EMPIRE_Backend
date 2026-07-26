# Deployment and rollback runbook

No deployment was performed as part of the 2026-07-11 backend audit.

## Selected target

Authenticated provider evidence selects project `epdg platform`, service
`tranquil-tenderness`, repository `webdev692/THE-EMERSON-EMPIRE_Backend`, and
service root `/epdg-backend-core`. The mapped production environment is
`production_epdg`. Exact IDs, the mapped host, current failure, historical
origin classifications, and safe database checks are maintained only in
[RAILWAY_DEPLOYMENT_MANIFEST.md](RAILWAY_DEPLOYMENT_MANIFEST.md).

The selection does not establish release health. The current exact-head status
is failed at the database-authentication stage, so the root JavaScript service
must not be substituted and no frontend origin should be changed yet.

## EPDG service commands

```text
Install: Railway/Nixpacks-managed
Build: npm run build
Start: npm start
Health: /health
Smoke (PowerShell): `$env:EPDG_API_ORIGIN='<reviewed credential-free origin>'; npm run smoke:health`
Smoke (POSIX): `EPDG_API_ORIGIN=<reviewed credential-free origin> npm run smoke:health`
```

The checked-in `epdg-backend-core/railway.toml` encodes those commands. Node and npm versions come from `package.json`.

## Pre-deployment gates

- Root tests, EPDG build/tests/lint, diff check, and credential scan pass at the
  exact commit. July 11-12 results are historical and must be rerun.
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

- PostgreSQL authentication failure `28P01`; the separate production and PR
  `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, and `DB_SSL`
  presence/pairing must be verified without recording values.
- No successful exact-head Railway deployment or healthy canonical API origin.
- The final company, school, intern, mentor, administrator, and founder role/permission matrix.
- The mentor-session state machine, scheduling ownership, update/cancellation permissions, and rating/notes visibility rules.
- Private CV, submission, portfolio, and certificate storage ownership, bucket policy, upload, and time-limited delivery contracts.
- Tracked-versus-live schema drift for announcements, feedback, resources, and identity mirrors.
- School registration field normalization: the database uses the lowercase school-type enum and stores location in `schools.county`; the current frontend values and displayed `country` field need an agreed mapping.
- Backend-only opportunity routes have no active frontend consumer or end-to-end verification.

## Environment changes

Record environment changes by variable name only. Never copy values into this
repository or release evidence. The service mapping is known, but frontend API
origin changes remain blocked until the mapped host is healthy at the exact
reviewed commit.

Do not change `VITE_API_URL`, database, email, storage, or signing variables
until the release gates pass. `CORS_ORIGINS` was updated by name on July 12;
verify its presence and behavior without recording its value.

## Rollback

For a code-only Railway release, select the last verified deployment for the same service and commit, redeploy it, and re-run `/health`, CORS, and unauthenticated protected-route checks. Do not roll back by rewriting Git history.

Database changes require their own reviewed compensating migration. Never drop, truncate, reset, or restore over production records as an application rollback shortcut.

Current release state: no successful backend code deployment, live migration,
external storage change, or merge. The July 12 names-only `CORS_ORIGINS`
provider change is recorded in the release journal.
