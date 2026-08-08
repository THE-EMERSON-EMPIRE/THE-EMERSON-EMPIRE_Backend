# Railway deployment manifest

Evidence status: July 26 release history reconciled on 2026-08-08
(America/New_York).

This is the single repository record for the Railway target. It separates the
July 26 PR-environment gate, the later July 26 merged Production release record,
and the August 8 read-only operational observation. Historical success must not
be represented as a current provider health check.

## Authoritative target

| Field | Current evidence |
|---|---|
| Railway project | `epdg platform` (`34659053-7658-4d6e-8d0e-469f91ec6058`) |
| Railway service | `tranquil-tenderness` (`fccb017f-ec3a-472e-ab19-f72011bf84f7`) |
| Connected repository | `webdev692/THE-EMERSON-EMPIRE_Backend` |
| Merged backend release | PR #2; `main` commit `7bfdb114363147ec2998d151dff22a786b2122ba` |
| July 26 Production deployment | `cbb535d2-bff0-43af-839b-26e53e5a97dc` |
| July 26 Production status | Recorded as successful and active in Europe West (Amsterdam) |
| Production API origin | `https://tranquil-tenderness-productionepdg.up.railway.app` |
| Service root | `/epdg-backend-core` |
| Builder/install | Nixpacks; Railway-managed deterministic install |
| July 26 recorded runtime | Node `v22.14.0`; provider npm version not recorded |
| Build | `npm run build` |
| Start | `npm start` |
| Readiness | `GET /health` |
| Railway environment | `production_epdg` in the July 26 release record; current mapping requires dashboard confirmation |
| Database connection method | Separate server-only PostgreSQL variables; not `DATABASE_URL` |

The Production origin above is the canonical origin recorded by the merged
release. The root JavaScript foundation is not the mapped Railway entrypoint.
This manifest does not authorize a provider change, redeploy, environment read,
or migration.

## Historical PR-environment gate (2026-07-26)

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

That verification occurred before merge and did not itself represent a
Production change. It remains useful exact-head PR-environment evidence, but
the merged release record below supersedes its statements about PR #2 being
open.

## Historical merged Production release record (2026-07-26)

The final release record attached to
[merged frontend PR #27](https://github.com/webdev692/Empire-emerson_frontend/pull/27)
records:

- backend PR #2 merged into `main` at
  `7bfdb114363147ec2998d151dff22a786b2122ba`;
- Railway Production deployment
  `cbb535d2-bff0-43af-839b-26e53e5a97dc` successful and active in Europe West
  (Amsterdam);
- canonical Production API
  `https://tranquil-tenderness-productionepdg.up.railway.app`;
- strict CA-verified PostgreSQL TLS and a fresh `SELECT 1` before listen;
- `GET /health` at HTTP `200`;
- approved-origin CORS and fail-closed rejected-origin behavior;
- authenticated and unauthorized route boundaries;
- least-privileged synthetic QA cleanup with no retained synthetic rows;
- application-startup migration-execution and artifact safety checks; and
- build, deployment, runtime, and credential-pattern scans with no secret
  values recorded.

This list is a dated transcription of July 26 release evidence. It is not a
fresh August 8 deployment inspection, and it does not reproduce environment
values, credentials, private rows, or log contents.

## Current operational observation (2026-08-08)

At approximately 12:07 EDT (response `Date` header
`2026-08-08 16:07:49 UTC`), three read-only requests to the canonical
Production `/health` endpoint returned HTTP `503` and the privacy-safe service
contract identifying `epdg-backend-core` with status `unavailable`. This proves
that the endpoint answered; it does not identify the active source SHA or
diagnose database, TLS, runtime, configuration, or application failure.

Before any provider action, use the authenticated Railway dashboard to verify:

- active deployment ID, source repository, branch, and commit;
- configured service root and current Production domain mapping;
- deployment state, region, health history, and restart/crash history;
- recent build and application logs using only privacy-safe stage/error-class
  evidence;
- database connection and strict-TLS startup outcome;
- effective Node and npm versions; and
- whether any source, builder, branch, root, or variable-presence setting
  drifted after July 26.

Do not copy environment values into an audit, change a provider setting, or
trigger a deployment while collecting this evidence.

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

Before any later Production change, use the authenticated dashboard to preserve
the then-current deployment as the rollback target. July 26 Production
deployment `cbb535d2-bff0-43af-839b-26e53e5a97dc` is the historical known-good
release anchor, but its present availability must be confirmed before it is
named in an operational rollback plan. PR-environment runtime code head
`138608083efe273e7bd20ecd101a0efa5b6700f5` and deployment
`16c0c861-1d01-40fa-bed8-0330c1f88460` remain pre-merge diagnostic evidence,
not an assumed Production rollback target.

After any separately authorized rollback, repeat readiness, strict TLS,
database, CORS, authentication, cleanup, and privacy-safe log checks against
the exact deployed commit.

A documentation-only reconciliation requires no database compensation.
Database rollback remains a separately reviewed forward compensating migration.
Never reset migration history, run historical table drops, or replace
production records.
