# EPDG hosted administrator staging — public summary

Updated 2026-11-12.

**Status:** A separate backend candidate and private frontend staging site have been deployed for a bounded synthetic-only check. The test remains incomplete and is not production-ready.

## Review stack

- Backend administrator API: draft PR #13.
- Frontend administrator interface and hosted build: draft PR #46.

Both remain open and unmerged. The staging deployment does not authorize a production release.

## Verified

- Required exact-head checks passed for the source revisions used in the hosted test. Those results belong to those source revisions; review current checks before accepting any later branch commit.
- The isolated API health check returned success.
- The frontend's site-level private-access gate blocked signed-out access. In the signed-in owner browser, the expected administrator sign-in screen loaded.
- Unauthenticated session restoration returned to the sign-in screen without an origin/configuration error.
- The check used the existing Neon staging branch. No database write or migration was performed.

## Not tested and closeout

- No reviewer identity, password, or app session was created because safe credential provisioning was unavailable. Public registration remains disabled.
- Authenticated login, overview, user and role screens, readiness workflows, CSRF and origin mutation checks, cookie/proxy acceptance, logout, and session revocation remain untested.
- The Railway deployment showed serverless sleep, but a service-level zero-replica shutdown has not been verified. Keep closeout open until the isolated backend is stopped and shutdown is confirmed.
- Netlify access was protected at the site level; no organization-wide SSO or existing site policy was changed. The public summary does not claim strict SAML SSO.

## Data boundary

No production service, production database, real account, HR record, learner record, or existing synthetic account was changed. Do not weaken TLS, origin, cookie, CSRF, or server-side authorization controls to make a check pass. Keep private origins, provider identifiers, deployment receipts, and credentials in the restricted release archive.
