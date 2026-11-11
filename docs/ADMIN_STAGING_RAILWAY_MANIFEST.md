# EPDG administrator staging Railway manifest

**Status:** Source preparation only (2026-11-11). No Railway project, service,
domain, secret, or deployment has been created.

## Service candidate

| Setting | Value |
|---|---|
| Project / service | `epdg-admin-staging` / `epdg-admin-staging` |
| Repository | `THE-EMERSON-EMPIRE/THE-EMERSON-EMPIRE_Backend` |
| Source branch / reviewed API head | `codex/epdg-admin-api-staging-reconciled-20261111` / `938b74c61c28c2aac3cb70c8bab23fbb9fa62728` |
| Root | `epdg-backend-core` |
| Build / start | `npm run build` / `npm run start:admin-staging` |
| Health | `GET /health`, 60-second timeout |
| Replicas / pre-deploy | 1 / none |
| Region | Unselected; confirm current Railway options and cost first |

The root JavaScript app and `epdg-backend-core` are distinct entrypoints. The
admin service must use the core root and dedicated start command. Do not select
`epdg-backend-core/railway.toml`; it belongs to the legacy entrypoint. Verify
the effective config source/root in the actual Railway plan before deployment.

The IaC file imports `railway/iac`, but the reconciled backend root does not
pin the Railway SDK and its lockfile has not been updated. The current local
toolchain also lacks the repository-pinned Node.js 22.23.1/npm 11.17.0. Before
a reproducible Railway plan, add the reviewed exact SDK version and regenerate
the lockfile using the pinned toolchain. Do not use an unpinned `npx` package
or hand-edit the lockfile. No Railway plan/apply was run; connected Railway
tools did not return plan, usage, or remaining-credit information. Confirm
organization-repository access in Railway before creating resources.

## Origins and proxy

Exact origins do not exist yet:

- UI: a new dedicated SSO-protected Netlify site, intended origin
  `https://<dedicated-admin-site>.netlify.app`. Do not use existing
  `epdg.netlify.app` or the old manual-upload review site.
- API: generated domain for the new Railway service,
  `https://<generated-admin-service>.up.railway.app`.

The hosted artifact proposes one forced proxy route:
`/api/* https://<generated-admin-service>.up.railway.app/api/:splat 200!`.
The browser calls relative `/api`; other paths are not proxied. Live Netlify
forwarding is not verified. Before login, prove request forwarding for
`Origin`, `Sec-Fetch-Site`, `Cookie`, `X-EPDG-Request`, and
`X-CSRF-Token`, and verify backend `Set-Cookie` attributes are unchanged.
Stop if any header/cookie is altered; do not weaken backend checks.

## Runtime settings

| Variable | Intended value |
|---|---|
| `NODE_ENV` | `production` |
| `EPDG_NEON_ADMIN_STAGING_MODE`, `EPDG_SYNTHETIC_MODE`, `EPDG_ADMIN_STAGING_MODE` | `1` each |
| `NEON_ADMIN_STAGING_PROJECT_ID` | `lively-hill-76068632` |
| `NEON_ADMIN_STAGING_BRANCH_ID` | `br-plain-unit-bc3s0lqy` |
| `DB_HOST` | `ep-late-breeze-bce2mem6.c-16.us-east-1.aws.neon.tech` (direct) |
| `DB_PORT` / `DB_NAME` / `DB_USER` | `5432` / `emerson_epdg_portal_app` / `epdg_portal_runtime` |
| `DB_SSL` | `true`; retain certificate verification |
| `DB_CONNECTION_TIMEOUT_MS` / `DB_STATEMENT_TIMEOUT_MS` | `5000` / `15000` |
| `DB_PASSWORD` | Restricted runtime-role secret, protected Railway variable only |
| `SESSION_CSRF_SECRET` | Independent secret, at least 32 random characters |
| `PORTAL_ORIGIN` / `CORS_ORIGINS` | Same exact Netlify HTTPS origin; currently unknown |
| `PORT` | Railway-provided; never hard-code |

Use Railway protected variables for secrets. Do not set migrator URLs,
`DATABASE_URL`, `PG*`, Supabase, email, hosted-practice, founder-bootstrap,
JWT, or certificate-signing variables. Startup and deployment must not apply
migrations.

## Cost estimate for eight hours

Railway's published rates are Free $0 with $1/month resource credit, Hobby
$5/month including $5 usage, and Pro $20/month including $20 usage; resource
rates are $20/vCPU-month, $10/GB RAM-month, and $0.05/GB egress. Builds are
free. With a 730-hour month and 0.1 GB egress:

| Runtime | Estimated eight-hour resource charge |
|---|---:|
| 0.25 vCPU, 0.5 GB RAM | about $0.12 |
| 1 vCPU, 1 GB RAM | about $0.34 |

The estimate assumes the service is stopped after eight hours. It excludes
Neon/Netlify charges and usage outside the window. Actual workspace plan,
remaining credit, existing spend, and possible plan-change fee are unavailable
from connected tools. Check Railway Dashboard **Workspace → Billing/Usage**
and confirm the budget before resource creation. Existing subscription fees
remain applicable; included credit offsets resource use only while available.
[Railway plan pricing](https://docs.railway.com/pricing/plans).

## Neon and release gates

Read-only verification identified the separate project
`lively-hill-76068632`, ready staging branch `br-plain-unit-bc3s0lqy`,
database `emerson_epdg_portal_app`, and restricted runtime role. Aggregates
showed only synthetic `.invalid` identities in checked user tables; all 16
application tables had RLS, no PUBLIC policies were found, runtime grants were
restricted, and three migration hashes matched PR #12. No rows or credentials
were changed. The Neon branch was **not protected**; enable branch protection
and verify it before any hosted use.

Do not use `scripts/neon-admin-staging/verify.cjs` to create a reviewer login:
its fixture setup rotates both existing synthetic users' password hashes and
revokes their sessions. No approved credential-manager handoff is connected,
so no separate reviewer account was created. Create a short-lived `.invalid`
reviewer only through an approved isolated flow, delivering the password via
the approved password manager.

Before deployment require human review and green exact-head CI for PR #12,
#44, #46, and this draft; confirmed Railway billing and GitHub repo access;
dedicated Netlify SSO and exact origin; generated Railway API origin; protected
runtime secrets; pinned Railway SDK/lockfile; protected Neon branch; and live
proof of proxy header/cookie forwarding. Then verify browser login, session
restoration, logout/retry, anonymous and unauthorized API denial, pending-only
role requests, read-only education readiness, synthetic isolation, privacy-safe
errors/logs, and healthy `/health`. Test DB outage/recovery only in the
isolated staging window without disabling a shared Neon endpoint.

If a gate fails, stop only the new API service and restrict only the dedicated
site. Roll back code within that same service; preserve the Neon branch and
audit/migration history. Never retarget production, reset migration history,
drop schema, or delete records. Database fixes remain reviewed and forward-only.
