# Railway deployment manifest

Evidence status: 2026-07-26 (America/New_York).

This is the single repository record for the Railway target. Runtime code head
`138608083efe273e7bd20ecd101a0efa5b6700f5` is a verified healthy
release candidate in the Railway PR environment. Backend PR #2 is open and
ready for review but remains unmerged. This evidence does not represent a
Railway Production deployment, production promotion, or frontend release.

## Authoritative target

| Field | Current evidence |
|---|---|
| Railway project | `epdg platform` (`34659053-7658-4d6e-8d0e-469f91ec6058`) |
| Railway service | `tranquil-tenderness` (`fccb017f-ec3a-472e-ab19-f72011bf84f7`) |
| Connected repository | `webdev692/THE-EMERSON-EMPIRE_Backend` |
| Release-candidate branch | `codex/full-stack-release-2026-07-11` |
| Verified runtime code head | PR #2 at `138608083efe273e7bd20ecd101a0efa5b6700f5` |
| Verified PR environment | `THE-EMERSON-EMPIRE_Backend-pr-2` (`aa770481-aa3a-483b-8542-0e8913488213`) |
| Verified PR deployment | `16c0c861-1d01-40fa-bed8-0330c1f88460` |
| Verified PR API origin | `https://tranquil-tenderness-the-emerson-empirebackend-pr-2.up.railway.app` |
| Service root | `/epdg-backend-core` |
| Builder/install | Nixpacks; Railway-managed deterministic install |
| Runtime | Node `v22.14.0` |
| Build | `npm run build` |
| Start | `npm start` |
| Readiness | `GET /health` |
| Authoritative Production candidate | `production_epdg` (not changed or deployed by this release-candidate verification) |
| Mapped Production host | `https://tranquil-tenderness-productionepdg.up.railway.app` (not verified by the PR deployment) |
| Database connection method | Separate server-only PostgreSQL variables; not `DATABASE_URL` |

The mapped Production host is the only candidate production API origin. It
must not be published as a working frontend origin until a separately
authorized exact-main deployment passes Production readiness, CORS, database,
and protected-route probes. The root JavaScript foundation is not the mapped
Railway entrypoint.

The branch above identifies the current PR #2 release candidate, not permission
to change Railway's Production source policy.

## Current verified PR release candidate

- Railway deployment `16c0c861-1d01-40fa-bed8-0330c1f88460` for runtime code
  head `138608083efe273e7bd20ecd101a0efa5b6700f5` is successful, active,
  and online in the PR environment.
- The active PostgreSQL pool loads the protected CA, validates it as a current
  CA certificate, and uses `rejectUnauthorized: true`.
- Strict TLS database authentication and a fresh `SELECT 1` passed before the
  application listened on the Railway port.
- `GET /health` returned HTTP `200` with the intended healthy response.
- The configured approved production frontend and PR #27 preview origins
  received exact allow-origin headers. An untrusted origin returned `403`
  without an allow-origin header.
- Synthetic pending-company sign-in and the self-scoped
  `GET /api/auth/me` route returned `200`. The same role received `403` from
  `GET /api/admin/stats` before controller execution. Missing, malformed,
  expired, and previously valid post-cleanup tokens returned `401`.
- The temporary non-production QA identity had no profile or related business
  records, was hard-deleted immediately, and an independent check found zero
  related synthetic rows.
- No `SELF_SIGNED_CERT_IN_CHAIN`, PostgreSQL `28P01`, startup migration, or
  sensitive value appeared in the exact-deployment evidence.

Current local verification at that runtime code head recorded root tests
`9/9`, EPDG build success, EPDG tests `55/55`, and lint with zero errors and
161 existing warnings. The artifact audit found no SQL in `dist`, no
`dist/db/migrations`, no migration executor, and no `postgres-migrations`
runtime dependency. Credential-pattern and deployment-log scans found no
secret values.

No backend merge, Railway Production change, frontend change, Netlify
production promotion, database migration, or production-data action occurred.

## Superseded failure history

On 2026-07-25 and earlier, historical PR deployments failed before binding. The
recorded sequence included stale database credentials (`28P01`) and later a
strict-TLS trust failure (`SELF_SIGNED_CERT_IN_CHAIN`). Protected shared
variable references corrected the credential pairing, and runtime code head
`138608083efe273e7bd20ecd101a0efa5b6700f5` added supported CA loading
without weakening certificate verification. Deployment
`16c0c861-1d01-40fa-bed8-0330c1f88460` supersedes those failed PR-environment
states. The failed deployments remain part of the release journal and PR
conversation; they were not erased or reclassified as successful.

The EPDG service reads these database variable names:

- `DB_HOST`
- `DB_PORT`
- `DB_NAME`
- `DB_USER`
- `DB_PASSWORD`
- `DB_SSL`
- `SUPABASE_DB_CA_CERT`
- `DB_CONNECTION_TIMEOUT_MS`
- `DB_STATEMENT_TIMEOUT_MS`

`DATABASE_URL` belongs to the separate root foundation and is not consumed by
the mapped EPDG service. Because EPDG passes `DB_PASSWORD` separately to the
PostgreSQL client, URL-encoding reserved password characters is not part of
this connection path.

Safe provider verification must compare variable **presence and pairing**, not
values:

1. Confirm the host, port, database, and user are one current Supabase direct
   or pooler tuple; do not mix fields from the two connection modes.
2. Confirm `DB_PASSWORD` is the current password for that tuple.
3. Confirm `DB_SSL` is not `false` in production.
4. Confirm `SUPABASE_DB_CA_CERT` is present in protected settings and parses as
   a currently valid PEM CA certificate; never print or copy its value into
   logs or release notes.
5. Compare the names and presence status independently in `production_epdg`
   and the PR #2 environment; do not assume Railway copies later changes.
6. Redeploy the exact reviewed head, then run the following without printing
   environment values:

   PowerShell: `$env:EPDG_API_ORIGIN='<origin>'; npm run smoke:health`

   POSIX: `EPDG_API_ORIGIN=<origin> npm run smoke:health`

## Historical origin classification (observed 2026-07-25; superseded)

These classifications are based on repository history, provider evidence, and
read-only probes on 2026-07-25.

| Origin | Classification | Evidence |
|---|---|---|
| `tranquil-tenderness-productionepdg.up.railway.app` | Mapped Production host; unavailable in the historical probe | Timed out during the July 25 probes. This is not evidence about a later Production deployment. |
| `tranquil-tenderness-the-emerson-empirebackend-pr-2.up.railway.app` | PR preview; invalid in the historical probe | Railway edge returned `404 Application not found` on July 25. Deployment `16c0c861-1d01-40fa-bed8-0330c1f88460` later superseded this result. |
| `tranquil-tenderness-production-6010.up.railway.app` | Historical; unavailable in the July 25 probe | Timed out during the July 25 probes and was not the mapped `production_epdg` host. |
| `the-emerson-empirebackend-production.up.railway.app` | Historical invalid host | Railway edge returned `404 Application not found` during the July 25 probe. |
| `backend-production-4b0a9.up.railway.app` | Historical invalid host | Railway edge returned `404 Application not found` during the July 25 probe. |
| `backend-productionepdg.up.railway.app` | Historical invalid host | Railway edge returned `404 Application not found` during the July 25 probe. |

Do not restore any historical host as a source-code fallback. Provider
environment settings must be checked separately before an authorized
Production change.

## Mandatory release gates

- Exact-head Railway deployment succeeds and `npm run smoke:health` passes.
- Database authentication succeeds without logging connection details.
- Required environment-variable presence is verified separately for production
  and PR contexts.
- Production and approved preview origins pass exact CORS preflights; an
  untrusted origin remains denied.
- Unauthenticated protected routes return `401` or `403`, not `404`.
- The reviewed migration baseline and live migration history reconcile. This
  gate passed in a metadata-only comparison on 2026-07-25: live
  `public.migrations` contains bootstrap ID `0` plus IDs `1`-`33`, and all 33
  names and `postgres-migrations` SHA-1 values match the repository files when
  evaluated with deployment (LF) line endings. Historical migrations `011`
  and `024` are recorded as applied and are not pending.
- Historical SQL is source-only audit evidence; the application build excludes
  it from `dist` and contains no migration execution path.
- A forward-only schema reconciliation and reviewed RLS/grant model are
  approved separately.
- Current root tests, EPDG build, EPDG tests, lint, diff check, and credential
  scan pass at the commit being deployed.

## Rollback

Before any later Production change, preserve its existing deployment as the
Production rollback target. For the PR environment, runtime code head
`138608083efe273e7bd20ecd101a0efa5b6700f5` and deployment
`16c0c861-1d01-40fa-bed8-0330c1f88460` are the last verified rollback
anchor. Redeploy that exact application artifact if a later documentation-only
or application head fails, then repeat readiness, strict TLS, database, CORS,
authentication, cleanup, and privacy-safe log checks.

A documentation-only reconciliation requires no database compensation.
Database rollback remains a separately reviewed forward compensating migration.
Never reset migration history, run historical table drops, or replace
production records.
