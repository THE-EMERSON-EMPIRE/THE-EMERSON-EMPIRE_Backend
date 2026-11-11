# EPDG hosted administrator staging integration review

**Status:** Draft plan (2026-11-11). No merge, site creation, deployment,
Railway resource, Neon write, or reviewer-account creation occurred.

## Review targets

- Backend [PR #12](https://github.com/THE-EMERSON-EMPIRE/THE-EMERSON-EMPIRE_Backend/pull/12), exact head `938b74c61c28c2aac3cb70c8bab23fbb9fa62728`, draft/mergeable; pinned CI run #14 passed all three foundation, core and native intake jobs.
- Frontend [PR #44](https://github.com/webdev692/Empire-emerson_frontend/pull/44), draft.
- Hosted frontend [PR #46](https://github.com/webdev692/Empire-emerson_frontend/pull/46), stacked on #44. An initial exact-head CI run caught a plugin typing issue; a focused fix was committed. Verify the latest commit's checks before acceptance.
- This backend change is a separate draft stacked on #12. Review the PRs together.

## API and permission contract

| Method/path | Behavior |
|---|---|
| `POST /api/auth/login` | Login for synthetic staging identities; creates server session cookie. |
| `GET /api/auth/session` | Restores session; `GET /api/auth/me` alias. |
| `POST /api/auth/logout` | Revokes session; CSRF-protected. |
| `GET /api/admin/overview` | Server-authorized admin overview. |
| `GET /api/admin/users` | Synthetic-only user listing. |
| `GET /api/admin/roles` | Role/capability context; server authorization is authoritative. |
| `POST /api/admin/role-requests` | Pending `webdev_technical` request only; grants no role/permission. |
| `GET /api/admin/education-readiness` | Read-only readiness summary. |

Backend unsafe routes require the exact configured Origin, reject cross-site
fetch metadata, require JSON and `X-EPDG-Request: portal`; logout and protected
writes require `X-CSRF-Token`. CORS credentials are restricted to the exact
allowlist. Frontend uses relative `/api`, cookie credentials, no-store,
in-memory CSRF state, and no browser token storage. The core admin staging app
is a distinct entrypoint from the root JS service; startup does not migrate.

## Hosted origins and security

Exact hosts are pending resource creation:

- UI intent: `https://<dedicated-admin-site>.netlify.app` on a new Netlify
  site with team SSO. Existing `epdg.netlify.app` and the old manual-upload
  review site are not targets.
- API intent: `https://<generated-admin-service>.up.railway.app` on a new
  isolated Railway service.

The proposed single forced rule is
`/api/* https://<generated-admin-service>.up.railway.app/api/:splat 200!`.
The browser calls same-origin `/api`; no other path is proxied. Backend
`PORTAL_ORIGIN` and `CORS_ORIGINS` must be the exact Netlify origin only.
The browser-visible, host-only `__Host-epdg_session` cookie must retain
`Secure; HttpOnly; SameSite=Strict; Path=/` with no `Domain`. Verify the
real Netlify proxy forwards `Origin`, `Sec-Fetch-Site`, `Cookie`,
`X-EPDG-Request`, `X-CSRF-Token`, and returns `Set-Cookie` unchanged.
This is not yet tested; stop if it fails and keep API protections intact.

All hops use HTTPS; Railway-to-Neon uses TLS with `DB_SSL=true` and
certificate verification. Hosted CSP uses `connect-src 'self'`, no external
fonts, no-store, HSTS, no framing and no indexing. Team SSO supplements API
authentication; it does not replace it.

## Neon isolation

Read-only checks pinned the separate Neon project
`lively-hill-76068632`, staging branch `br-plain-unit-bc3s0lqy`, database
`emerson_epdg_portal_app`, and runtime `epdg_portal_runtime`. Aggregate
results were synthetic `.invalid` identities only in checked user tables,
RLS on all 16 application tables, no PUBLIC policies, restricted runtime
grants, and three migration checksums matching PR #12. No row contents or
credential values were read into this review. The staging branch was not
protected; protect and recheck it before hosted use. No SQL, record, account,
role, or password changed. The existing fixture verifier rotates fixture
password hashes and sessions, so it is not a safe reviewer-account flow.

## Blockers and billing

1. New Netlify site and Railway service/domain do not exist; exact origins and
   real proxy pass-through behavior are unknown.
2. Railway connected tools do not expose plan/remaining credit. Check
   Workspace → Billing/Usage and confirm the eight-hour budget.
3. Confirm Railway GitHub installation can read the organization repository.
4. Pin the `railway` SDK used by `railway/iac` and update the lockfile with
   Node 22.23.1/npm 11.17.0 before a reproducible plan.
5. Protect the Neon staging branch.
6. No approved password-manager/credential creation connector is available;
   no reviewer login was created. Use a separate short-lived `.invalid`
   account through the approved secure flow.

Current Railway published rates imply about $0.12 for eight hours at 0.25
vCPU/0.5 GB and 0.1 GB egress, or $0.34 at 1 vCPU/1 GB with the same egress.
Free includes $1 monthly resource credit; Hobby is $5/month including $5
usage; Pro is $20/month including $20 usage. Actual plan/credits, any plan
change fee, and Neon/Netlify charges are unknown. Stop the service outside
the approved window. [Railway pricing](https://docs.railway.com/pricing/plans).

## Acceptance

Before enabling access: review PR #12/#44/#46 and this draft; require green
checks for exact heads; verify Netlify SSO and record exact origin; confirm
Railway repo access, billing and plan output; prove service root/config/start
command and absence of migrations; set secrets only in protected provider UI;
protect Neon branch and recheck RLS/grants/hashes; create a separate synthetic
reviewer only through the approved vault; test proxy header/cookie forwarding.

Browser/API checks: synthetic login, refresh/session restoration, logout and
network-failure retry; anonymous, wrong-origin, cross-site and unauthorized
requests denied; role requests stay pending; education readiness stays
read-only; no non-synthetic identity returned; privacy-safe logs; `/health`
ready on staging. In an approved staging-only window, verify DB connection
failure returns unavailable and recovers without changing a shared endpoint.

Rollback: no hosted state currently exists; leave drafts unmerged. Later,
stop only the new Railway service and restrict only its dedicated Netlify site.
Restore code only within that service; preserve Neon staging and migration
history. Never touch production, drop schema, reset migration history, or
delete records. Database compensation is forward-only.
