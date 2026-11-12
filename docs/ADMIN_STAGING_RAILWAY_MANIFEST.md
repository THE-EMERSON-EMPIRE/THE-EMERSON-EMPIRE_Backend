# EPDG administrator staging preparation

**Status:** Configuration preparation only. No Railway project or service, hosted site, deployment, reviewer account, database write, or merge has been performed.

## Reproducible Railway configuration

The backend root manifest pins the railway package at exactly 3.16.0, the dependency used by .railway/railway.ts for railway/iac. Its lockfile was generated with the declared toolchain: Node.js 22.23.1 and npm 11.17.0. A clean install and local strict TypeScript/DSL validation passed. This confirms the dependency and configuration locally; it is not a provider plan.

The configuration targets the distinct epdg-backend-core entrypoint, builds with npm run build, starts with npm run start:admin-staging, uses /health, one replica, and has no migration or pre-deploy command. By default, its source is empty. Setting EPDG_RAILWAY_ATTACH_SOURCE=1 selects the backend API branch only after the review gates below pass.

No Railway project or service exists for this plan, so a provider plan was not run. Once an approved empty project exists, the pinned CLI plan command is:

    npm exec --yes --package=@railway/cli@5.70.0 -- railway config plan --json

Review the plan output and effective root/source before any separately approved apply. Do not apply this configuration as part of preparation.

## Runtime environment

Environment documentation identifies variable names and purposes only. Set values through the provider's protected variable interface after the isolated target is confirmed.

| Variable names | Purpose |
|---|---|
| NODE_ENV | Runtime mode |
| EPDG_NEON_ADMIN_STAGING_MODE, EPDG_SYNTHETIC_MODE, EPDG_ADMIN_STAGING_MODE | Enable guarded synthetic administrator staging |
| NEON_ADMIN_STAGING_PROJECT_ID, NEON_ADMIN_STAGING_BRANCH_ID | Select the isolated staging database target |
| DB_HOST, DB_PORT, DB_NAME, DB_USER | Database connection destination and role |
| DB_SSL | Require TLS with certificate verification |
| DB_CONNECTION_TIMEOUT_MS, DB_STATEMENT_TIMEOUT_MS | Bound database connection and statement time |
| DB_PASSWORD | Restricted runtime-role credential |
| SESSION_CSRF_SECRET | Independent session and CSRF secret |
| PORTAL_ORIGIN, CORS_ORIGINS | Exact approved hosted UI origin |
| PORT | Provider-assigned listener port |

Do not configure migration credentials or unrelated production, email, founder-bootstrap, token-signing, or hosted-practice credentials. Application startup must never apply migrations.

## Approval-gated hosting sequence

1. Before creating resources, the founder approves a bounded workspace compute hard limit, a soft/email alert, and the test window. Confirm those limits apply to the intended scope.
2. Verify that the Netlify account plan supports a dedicated private site with strict Team/Organization SSO. Enable that protection before source attachment, deployment, or reviewer access. Stop if strict SSO is unavailable; do not substitute a shared password.
3. After explicit approval, create an empty isolated Railway target and a dedicated Netlify site. Do not connect source or deploy yet.
4. Set all protected Railway variables through the provider UI. Do not put credentials or exact database identifiers in Git, PRs, chat, or public documents.
5. Record the exact HTTPS UI origin and service origin privately. Set PORTAL_ORIGIN and CORS_ORIGINS to the one exact UI origin.
6. Render and review the pinned CLI plan. Confirm the isolated service, expected source root and commands, no migration step, and no unrelated resources. A separate founder approval is required before source attachment or deployment.
7. Only after SSO is verified and the site is private may a short-lived synthetic .invalid reviewer account be created through an approved password vault. Deliver its credential through one-use, expiring vault access. No approved vault handoff is currently connected, so no account has been created.
8. Run the hosted acceptance checks below using synthetic identities only. End the approved window by stopping only the dedicated staging service.

## Authentication and proxy acceptance

The browser uses relative /api requests through the dedicated Netlify proxy. The backend keeps exact-origin checks, cross-site Fetch Metadata rejection, JSON and X-EPDG-Request: portal requirements, CSRF protection for logout and protected writes, and an exact CORS allowlist.

Before reviewer login, verify that the proxy forwards these request headers unchanged: Origin, Sec-Fetch-Site, Cookie, X-EPDG-Request, and X-CSRF-Token. Verify the response's Set-Cookie is unchanged and retains the host-only __Host-epdg_session attributes Secure; HttpOnly; SameSite=Strict; Path=/, with no Domain. All hops use HTTPS and database TLS must verify the certificate.

**Hard stop:** If any required request header is dropped or changed, or the session cookie is missing or altered, do not provision/release reviewer credentials, do not weaken backend protections, and do not continue hosted acceptance. Restrict the dedicated site and stop only the new staging service.

## Neon Free and synthetic-data controls

Neon Free does not support protected branches. Do not retry the setting or upgrade for this synthetic staging exercise. Use a dedicated synthetic-only branch, restricted runtime role, forward-only reviewed migrations, and independent recovery procedures. Branch resets, destructive migrations, and record changes require explicit review and approval. Recheck isolation, permissions, and migration history before hosted use. Never use real participant, learner, or customer data.

The existing fixture verifier changes fixture credentials and sessions; it is not an acceptable reviewer-account flow.

## Exact-head review and rollback gates

Keep backend PR #13 stacked on backend PR #12, and frontend PR #46 stacked on frontend PR #44. Require green checks on the exact current heads before the hosted test. This PR's new head must receive fresh CI; checks from the earlier head do not satisfy that gate.

Acceptance requires: verified strict SSO/private-site protection; approved spending limits and test window; exact origins; protected provider variables; reviewed pinned plan; verified proxy header and cookie pass-through; synthetic login, refresh/session restore, logout, anonymous and wrong-origin denial, pending-only role requests, read-only readiness behavior, privacy-safe logs, and a healthy staging health check.

If a gate fails, leave code unmerged, restrict the dedicated site, and stop only the dedicated service. Preserve the synthetic database branch and migration history. Do not change production or delete records.
