# EPDG administrator staging deployment manifest

**Status:** Prepared locally on 2026-11-10; not applied. No Railway service,
domain, secret, or deployment was created.

This manifest is for the isolated administrator review API only. It does not
change `epdg platform`, `epdg-synthetic-handoff`, Creative Studio, Netlify,
Supabase, or production. The existing `epdg-backend-core/railway.toml` starts
the legacy `npm start` entrypoint; do not reuse it for this admin-only service.

## Service settings

| Setting | Prepared value |
|---|---|
| Railway project / service | `epdg-admin-staging` / `epdg-admin-staging` |
| GitHub source | `THE-EMERSON-EMPIRE/THE-EMERSON-EMPIRE_Backend` |
| Candidate branch / exact local commit | `codex/epdg-admin-api-staging-20261109` / `2b3f540ced47d0c167d51a24c7d0ada4b76b0a99` |
| Root directory | `/epdg-backend-core` |
| Builder | Railpack, after the organization GitHub installation is available |
| Install | `npm ci` using the checked-in lockfile |
| Build | `npm run build` |
| Start | `npm run start:admin-staging` |
| Health check | `GET /health`, 60-second startup timeout |
| Listener | Railway-provided `PORT`; one replica |
| Restart | On failure, at most three retries |
| Pre-deploy action | None. Migrations are not run by app startup or deployment. |
| Region | Choose the nearest supported U.S. East region after checking Railway's current options; none is selected yet. |

Railway's current documentation marks Config as Code deprecated and says new
services cannot opt into it. Use the Railway Infrastructure as Code workflow
or enter these settings for the new service after authorization; do not alter
the existing `railway.toml` for this purpose. See [Railway Infrastructure as
Code](https://docs.railway.com/infrastructure-as-code/reference) and [Railway
Config as Code status](https://docs.railway.com/config-as-code).

The GitHub App installation is currently limited to the `webdev692` user
account, so the organization source is not available to Railway. The candidate
is local and unpushed. This manifest does not authorize creating the project or
service; Railway plan and billing approval are also unresolved.

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
| `PORTAL_ORIGIN` | One exact HTTPS origin for the separately reviewed admin UI. The origin is not yet available or verified. |
| `CORS_ORIGINS` | The exact same single origin as `PORTAL_ORIGIN`, with no path. |
| `PORT` | Supplied by Railway; do not hard-code it. |
| `DB_CONNECTION_TIMEOUT_MS` / `DB_STATEMENT_TIMEOUT_MS` | Optional; defaults are 5000 / 15000 ms. |

Do not set `NEON_ADMIN_STAGING_MIGRATOR_DATABASE_URL`, `DATABASE_URL`,
`DATABASE_PUBLIC_URL`, `PG*`, Supabase, SMTP, Resend, hosted-practice, founder
bootstrap, JWT, or certificate-signing variables. The admin staging profile
rejects these unrelated connection and privilege paths. The service runs only
as `epdg_portal_runtime`.

### Pooling gate

The candidate profile currently pins the direct database host. The Neon
endpoint inspection reports `pooler_enabled=false` and exposes a separate
`-pooler` host. The application-level pooled connection test has not passed;
do not change `DB_HOST` to the pooled endpoint or describe this deployment as
pooler-verified until the pooler path is enabled and tested with the app's
actual `pg` pool, TLS, readiness, and transaction behavior. Migrations and
exports use a direct connection. Neon documents the pooled hostname convention
in [Connection pooling](https://neon.com/docs/connect/connection-pooling).

## Readiness, release, and rollback

- `/health` performs a TLS-verified database query and checks the portal
  security schema. It returns `200` only when the app and database are ready;
  it returns `503` when the database is unavailable. Railway's health check is
  a deployment readiness gate, not ongoing monitoring; add an independent
  monitor before any broader release. See [Railway healthchecks](https://docs.railway.com/deployments/healthchecks).
- Before first deployment, require the organization repository installation,
  explicit Railway cost approval, exact admin UI origin, protected runtime
  secrets, and completion of the open connection, limit, and backup/restore
  checks. Deploy the reviewed exact commit and verify `/health`, login,
  session, CSRF, origin rejection, `.invalid` isolation, and privacy-safe logs.
- For code rollback, redeploy the last known-good deployment of this same new
  service. If the first deployment fails, leave the new service offline; do
  not route the existing portals to it. Preserve the synthetic Neon branch and
  audit evidence. Any database correction is a separately reviewed,
  forward-only change; do not reset migration history or delete review data.
- No external encrypted export or restore drill exists yet. Complete and
  verify one before connecting real data. The synthetic branch is reproducible
  from the checked-in migrations and fixtures, but that is not an independent
  backup.
