# EPDG administrator staging deployment manifest

**Status:** Prepared locally on 2026-11-10; Infrastructure as Code is not
applied. No Railway project, service, domain, secret, or deployment was created.

This manifest is for the isolated administrator review API only. It does not
change `epdg platform`, `epdg-synthetic-handoff`, Creative Studio, Netlify,
Supabase, or production. The existing `epdg-backend-core/railway.toml` starts
the legacy `npm start` entrypoint; do not reuse it for this admin-only service.

## Service settings

| Setting | Prepared value |
|---|---|
| Railway project / service | `epdg-admin-staging` / `epdg-admin-staging` |
| GitHub source | `THE-EMERSON-EMPIRE/THE-EMERSON-EMPIRE_Backend` |
| Candidate branch / API implementation commit | `codex/epdg-admin-api-staging-20261109` / `2b3f540ced47d0c167d51a24c7d0ada4b76b0a99` |
| Local IaC file | `.railway/railway.ts` |
| Root directory | `epdg-backend-core` |
| Builder | Railway default Railpack builder |
| Install | `npm ci` using the checked-in lockfile |
| Build | `npm run build` |
| Start | `npm run start:admin-staging` |
| Health check | `GET /health`, 60-second startup timeout |
| Listener | Railway-provided `PORT`; one replica |
| Restart | Railway default; not overridden in IaC. Confirm the desired retry policy in the cost-gated plan review. |
| Pre-deploy action | None. Migrations are not run by app startup or deployment. |
| Region | Choose the nearest supported U.S. East region after checking Railway's current options; none is selected yet. |

The service definition is prepared in `.railway/railway.ts` using Railway's
current TypeScript Infrastructure as Code API. The `railway.toml` inside
`epdg-backend-core` belongs to the legacy backend entrypoint and is not used by
this admin-only service. The IaC file is declarative only: do not run
`railway config apply`, connect a service, or deploy until repository access,
the current workspace plan/usage, and the incremental cost have been reviewed
and the user has approved that cost. See [Railway Infrastructure as
Code](https://docs.railway.com/infrastructure-as-code/reference) and [Railway
Config as Code status](https://docs.railway.com/config-as-code).

The connected GitHub App installation is limited to the `webdev692` user
account; the organization backend repository is absent from its installation
repository list. The candidate is local and unpushed. Repository metadata
reports push permission, but no organization installation or verified
authorized push route is available, so this does not authorize publishing the
branch or bypassing an access error. This manifest does not authorize creating
the project/service; Railway workspace plan, usage, and actual incremental cost
remain unverified.

## Runtime variables

Set service-scoped variables only after the isolated service has been approved.
Enter secret values through Railway's protected variable interface. Never put
them in this file, the repository, build arguments, or logs.

| Variable | Value or handling |
|---|---|
| `NODE_ENV` | `production` |
| `EPDG_NEON_ADMIN_STAGING_MODE` | `1` |
| `EPDG_SYNTHETIC_MODE` | `1` |
| `EPDG_ADMIN_STAGING_MODE` | `1` |
| `NEON_ADMIN_STAGING_PROJECT_ID` | `lively-hill-76068632` |
| `NEON_ADMIN_STAGING_BRANCH_ID` | `br-plain-unit-bc3s0lqy` |
| `DB_HOST` | Current tested direct host is `ep-late-breeze-bce2mem6.c-16.us-east-1.aws.neon.tech`; see pooling gate below. |
| `DB_PORT` | `5432` |
| `DB_NAME` | `emerson_epdg_portal_app` |
| `DB_USER` | `epdg_portal_runtime` |
| `DB_PASSWORD` | Secret for the scoped runtime role; set only in Railway's protected variables. Never use the migrator role here. |
| `DB_SSL` | `true` |
| `SESSION_CSRF_SECRET` | Independently generate at least 32 random characters; do not reuse a database, JWT, or certificate secret. |
| `PORTAL_ORIGIN` | One exact HTTPS origin for the separately reviewed admin UI. The origin is not yet available or verified; IaC uses `preserve()` and does not invent one. |
| `CORS_ORIGINS` | The exact same single origin as `PORTAL_ORIGIN`, with no path. Set through protected service variables after the UI origin is verified. |
| `PORT` | Supplied by Railway; do not hard-code it. |
| `DB_CONNECTION_TIMEOUT_MS` / `DB_STATEMENT_TIMEOUT_MS` | Optional; defaults are 5000 / 15000 ms. |

Do not set `NEON_ADMIN_STAGING_MIGRATOR_DATABASE_URL`, `DATABASE_URL`,
`DATABASE_PUBLIC_URL`, `PG*`, Supabase, SMTP, Resend, hosted-practice, founder
bootstrap, JWT, or certificate-signing variables. The admin staging profile
rejects these unrelated connection and privilege paths. The service runs only
as `epdg_portal_runtime`.

### Pooling gate

The source-pinned profile uses the direct Neon host. The application's actual
`pg.Pool` passed TLS readiness, a read-only transaction, and a bounded load of
24 concurrent `SELECT pg_sleep(0.25)` queries: the pool reached its default
maximum of 10 connections, queued 14 callers, and completed every query. After
the endpoint had been idle, the local API started in 6.2 seconds and `/health`
returned 200. Temporarily restricting connections on this synthetic endpoint
made `/health` return 503; restoring access made the same API process return
200 again. The endpoint was restored to `disabled=false`.

The Neon PgBouncer `-pooler` hostname was not exercised. Endpoint metadata
reports `pooler_enabled=false`, and the checked-in profile pins the direct
host. Keep `DB_HOST` direct; do not describe the Neon PgBouncer path as tested.
Migrations and exports use a direct connection. See Neon [Connection
pooling](https://neon.com/docs/connect/connection-pooling).

## Readiness, release, and rollback

- `/health` performs a TLS-verified database query and checks the portal
  security schema. It returns `200` only when the app and database are ready;
  it returns `503` when the database is unavailable. Railway's health check is
  a deployment readiness gate, not ongoing monitoring; add an independent
  monitor before any broader release. See [Railway healthchecks](https://docs.railway.com/deployments/healthchecks).
- Before first deployment, require the organization repository installation,
  verified Railway workspace plan and remaining included credit, explicit
  approval of the resulting incremental cost, exact admin UI origin, and
  protected runtime secrets. The local connection, outage, bounded-pressure,
  transaction, and restore checks are complete on synthetic staging. Deploy
  the reviewed exact commit and verify `/health`, login,
  session, CSRF, origin rejection, `.invalid` isolation, and privacy-safe logs.
- For code rollback, redeploy the last known-good deployment of this same new
  service. If the first deployment fails, leave the new service offline; do
  not route the existing portals to it. Preserve the synthetic Neon branch and
  audit evidence. Any database correction is a separately reviewed,
  forward-only change; do not reset migration history or delete review data.
- An independent encrypted logical export of all 16 application tables and 23
  synthetic rows is stored under
  `infrastructure/private-backups/epdg-staging/`. AES-256-GCM protects the
  artifact; its key is wrapped by Windows DPAPI for the current Windows user.
  The restore drill wrote the exported rows into
  `epdg_restore_drill_20261110` on Neon child branch
  `br-noisy-dust-bcljub0i`; all per-table row counts and SHA-256 checksums
  matched. The original staging branch was read-only during export and was not
  changed by restore. Schema DDL remains in the checked-in migrations and is
  not embedded in this row-export artifact.
