# EPDG hosted administrator staging integration review

**Status:** Review plan only. No hosted site, service, deployment, database write, reviewer account, or merge has occurred.

## Linked review stack

- Backend PR #12 contains the administrator API.
- Backend PR #13 contains Railway staging preparation and is stacked on #12.
- Frontend PR #44 contains the administrator interface.
- Frontend PR #46 contains the hosted build and is stacked on #44.

Require current exact-head checks for all four PRs before the hosted test. Any CI result from an earlier PR head is stale for the updated head.

## API contract

| Method/path | Expected behavior |
|---|---|
| POST /api/auth/login | Authenticate a synthetic staging identity and create a server session |
| GET /api/auth/session | Restore the current session; /api/auth/me is an alias |
| POST /api/auth/logout | Revoke the session and require CSRF protection |
| GET /api/admin/overview | Return an authorized administrator overview |
| GET /api/admin/users | Return synthetic-only users |
| GET /api/admin/roles | Return server-authoritative role/capability context |
| POST /api/admin/role-requests | Record a pending request only; do not grant permissions |
| GET /api/admin/education-readiness | Return a read-only readiness summary |

Unsafe requests require the exact configured Origin, reject cross-site Fetch Metadata, require JSON and X-EPDG-Request: portal; logout and protected writes require X-CSRF-Token. CORS credentials are limited to the exact allowlist. The frontend uses relative /api, cookie credentials, no-store, in-memory CSRF state, and no browser token storage. The backend core is a separate entrypoint from the root JavaScript service. Startup does not migrate.

## Secure Netlify/Railway sequence

1. Obtain founder approval for a bounded compute hard limit, soft/email alert, and test window. Do not create a resource before approval.
2. Confirm the Netlify plan supports strict Team/Organization SSO and private project visibility. If strict SSO is unavailable, stop; shared-password protection is not an approved substitute.
3. After approval, create an empty isolated Railway target and a dedicated Netlify site. Enable strict SSO/private access before attaching source, deploying, or provisioning a reviewer.
4. Enter database connection values and secrets only in protected provider settings. Record exact HTTPS origins privately; configure the backend to allow only the exact UI origin.
5. Review a non-destructive plan from the pinned Railway CLI. Confirm service root, source, build/start commands, health route, and absence of migrations. Require separate approval before attaching source or deploying.
6. Create a separate short-lived synthetic .invalid reviewer only through an approved password vault. Deliver credentials with one-use, expiring vault access. No reviewer account or approved vault handoff is available yet.
7. Exercise the application with synthetic identities only. Stop the service after the approved window.

Never place credential values or exact provider/database identifiers in Git, PRs, chat, public documents, or application logs.

## Proxy and session hard stop

The dedicated same-origin Netlify proxy should route only /api/* to the isolated backend. Verify unchanged forwarding for Origin, Sec-Fetch-Site, Cookie, X-EPDG-Request, and X-CSRF-Token. Verify backend Set-Cookie returns unchanged as the host-only __Host-epdg_session with Secure; HttpOnly; SameSite=Strict; Path=/ and no Domain. All browser, proxy, service, and database hops use HTTPS; the database connection verifies TLS certificates.

**Stop immediately** if any required header is missing or changed, or if the cookie is omitted or altered. Do not weaken origin, CORS, Fetch Metadata, CSRF, cookie, or TLS checks. Do not release reviewer access. Restrict the dedicated site and stop only the new service.

## Neon Free controls

Protected branches are not available on Neon Free. Do not retry branch protection or upgrade for fictional staging records. Keep the target branch synthetic-only; use a restricted runtime role, reviewed forward-only migrations, independent recovery procedures, and approval before branch reset, destructive migration, or record change. Verify permissions and migration history before the hosted test. Keep production and real identities unchanged.

Do not use the current fixture verifier for reviewer setup because it rotates existing fixture credentials and sessions.

## Acceptance checklist

Before any reviewer access, confirm:

- [ ] Current exact-head CI is green for backend #12/#13 and frontend #44/#46.
- [ ] The founder approved the bounded compute limit, alert, resource creation, and test window.
- [ ] The dedicated site is private and strict Team/Organization SSO is active.
- [ ] The isolated service configuration and reviewed plan have no migration step or unrelated resource change.
- [ ] Secrets and exact origins were set in protected provider settings.
- [ ] The synthetic database branch, restricted role, and migration history pass review.
- [ ] Proxy request headers and unchanged session-cookie behavior pass the hard-stop criteria above.
- [ ] A separate short-lived synthetic reviewer was created through an approved vault; no credential is exposed in logs or public content.
- [ ] Login, session restoration, logout, denied anonymous/wrong-origin access, pending-only role requests, read-only readiness, privacy-safe errors, and the staging health check behave as expected.

## Rollback

No hosted state exists yet. Until the gates pass, leave the PRs as drafts. If a later test fails, restrict only the dedicated Netlify site and stop only the dedicated Railway service. Preserve the synthetic database branch and migration history. Never retarget production, rewrite migration history, drop schema, or delete records. Database corrections must be reviewed and forward-only.
