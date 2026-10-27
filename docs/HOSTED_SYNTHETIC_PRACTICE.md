# Hosted synthetic EPDG practice profile

This is a separate hosted synthetic runtime, not a flag that promotes the laptop
runner or the legacy backend. Owner/admin, registration, invitations, profile
editing and role management remain closed. Its reviewed source profile pins
verified cloud identities and HTTPS origins; runtime access still requires valid
configuration, strict TLS and the complete isolated schema. No real HR records are
part of its seed or API.

## Entry and identity

The only hosted entry is `epdg-backend-core/dist/hosted-practice/index.js`.
Legacy `dist/index.js` rejects both practice-mode flags. Startup checks configuration,
the signing key when enabled, TLS and database readiness before listening. It
never imports or runs migrations or seed scripts.

`src/hosted-practice/profile.json` is the source-controlled, non-secret allowlist.
It binds the Railway project, environment, app service and database service,
private database hostname/port/name/role, instance identity, baseline/isolation
hashes, canonical frontend origin, exact preview origins, backend audience and
CRM source origin. Environment variables must match these pins; they cannot
nominate a different project or database. The preferred login alias is pinned
separately and resolves only to the existing fictional learner B identity.
It does not create an administrator, change a database email or grant a role.

The runtime requires `EPDG_HOSTED_PRACTICE_MODE=1`, `NODE_ENV=production`, the
matching provider identity variables and these deployment settings:

- `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL=true`.
- `HOSTED_PRACTICE_DB_CA_CERT` and `HOSTED_PRACTICE_INSTANCE_ID`.
- `PORTAL_ORIGIN`, `FRONTEND_URL`, `CORS_ORIGINS`, `SESSION_CSRF_SECRET`.
- `EPDG_HOSTED_PRACTICE_LOGIN_ALIAS`.
- `MAIL_DELIVERY_MODE=database-capture` and the reserved synthetic sender.
- `EPDG_HOSTED_PRACTICE_HANDOFF_ENABLED` and the independent
  `EPDG_HOSTED_PRACTICE_HANDOFF_KEY` when enabled.

No value is documented or bundled. Operator/bootstrap passwords and markers,
fixture passwords, PostgreSQL administrator variables, general database URLs,
Supabase credentials, Resend keys and SMTP credentials are forbidden in the app.
Only the separate operator job may hold its bootstrap credentials.

## TLS, sessions and API routing

Database TLS requires a currently-valid CA certificate and
`rejectUnauthorized: true`. Normal Node/PostgreSQL hostname verification remains
enabled. There is no plaintext or certificate-verification fallback. The local
loopback TLS behavior and its validator remain unchanged.

Browsers use same-origin `/api` routing through the frontend host. The proxy
targets the exact reviewed backend HTTPS origin and must preserve cookie/CSRF
semantics without caching responses. Cookies remain Secure, HttpOnly,
SameSite=Strict, host-only `__Host-epdg_session` cookies. Unsafe requests require
an exact approved frontend Origin, `X-EPDG-Request: portal` and the session CSRF
token. Cross-site Fetch metadata and bearer authentication remain rejected.
The backend does not add CORS access. Hosted rate-limit buckets are fixed server
buckets rather than values derived from untrusted forwarding headers.

Hosted health and portal API JSON envelopes include `environment: synthetic-hosted`
and `privileged_controls_available: false`, including authentication responses.
Each portal API request rechecks current hosted configuration, fixture identity,
role and catalog isolation before login, session, recovery or learning work;
an unavailable check returns a sanitized 503 response without entering the portal
router. Successful readiness is not cached between requests.
The dedicated app mounts only health, the raw internal handoff receiver and the
protected portal router; it does not expose legacy feature or administration
routes.

## Service handoff contract

The hosted endpoint is `POST /internal/crm/onboarding-handoffs`, limited to 8 KiB
of exact raw JSON bytes. The local v1 protocol stays unchanged. Hosted requests
use `synthetic-hosted-v1` as key ID, `synthetic-hosted` as body environment and
the same minimal, fictional-ID-only source envelope.

`X-EPDG-Handoff-Audience` must equal the pinned backend origin and
`X-EPDG-Handoff-Source` the pinned CRM origin. HMAC-SHA256 uses the decoded
32-byte independent base64url key and this newline-joined text, without a final
newline:

```text
EPDG-CRM-HOSTED-PRACTICE-V1
POST
/internal/crm/onboarding-handoffs
{backendOrigin}
{crmOrigin}
{timestamp}
{nonce}
{sha256(exact raw body)}
```

The header timestamp, UUID nonce and lowercase hex signature retain their local
freshness/format requirements. Browser Origin, Cookie, Authorization and Fetch
metadata remain forbidden on this service route. The exact backend Host and
HTTPS forwarding metadata are checked, but forwarded IPs never establish
authority. The audience and source in the signature are server-pinned values.

Durable nonces, immutable event bytes/digests, monotonic decisions and shared
learner/mentor versus exclusive receiver locks retain their existing semantics.
An exact old event retry reports the current decision; it cannot reinstate an
older approval after withdrawal. A previously unreceived expired decision needs
new current CRM review rather than modified outbox bytes.

The internal service receipt has exactly seven fields: `success`, `environment`,
`event_id`, `result`, `received_at`, `current_status`, and `decision_version`.
Its environment is explicitly `synthetic-hosted`. Browser API metadata is never
added to this strict receipt. Exact duplicate retries retain the original event
ID and report the latest retained decision status/version.

## Database and mail capture

The reviewed baseline and security/learning migrations, including unchanged
learning 001–008, are applied only by the explicit operator job to a verified
empty dedicated database. `hosted-practice-migrations/001-hosted-practice.sql`
adds immutable hosted identity, private recovery-mail capture and server-role
RLS policies. Its exact hash is pinned in `src/hosted-practice/schema-manifest.json`.
The hosted isolation hash identifies this hosted policy, not an execution of
the local-only `isolation.sql`.

The app role is not an owner, superuser, database/role creator, replication role
or BYPASSRLS role. It has no role memberships. Column grants preserve existing
session, recovery, draft, receipt, file and feedback boundaries; no account,
membership, enrollment or mapping creation privilege is granted. A narrow
role-name UPDATE grant permits existing row-lock statements, while an enabled
immutable trigger rejects every actual app role update.

RLS policies isolate the trusted server role, not individual learners. Individual
scope is still checked by sessions, API predicates and invoker guards. There are
24 secured tables in the four protected practice/security schemas, plus eight
core/EPDG tables with explicit read grants and policies. These are the hosted
policy targets, not the global RLS-table count: the original 50-table baseline
already enabled RLS on 47 tables, and the hosted addon also enables its three
remaining core tables. The source-derived total is 74 RLS tables after the 24
protected additions; a live catalog check must verify the deployed total.
No browser policies/grants or security-definer functions are added.
Readiness checks identities, all reviewed ledgers, exact
policies/grants, active guards, role restrictions and the four known fictional
accounts with no administrator/company identities.

Recovery mail can only append a bounded, reserved-`.invalid` message to
`hosted_practice.mail_capture`. The app has no capture SELECT, UPDATE or DELETE
grant; there is no capture-reading HTTP route or external dispatcher. Captured
messages contain private reset links, so their contents must never enter logs,
browser bundles, ordinary evidence or shared reports. Operator access is private.

## Verification and release

The backend source checkpoint uses Node 22.23.1/npm 11.17.0. Build, full core/root
tests and lint results are recorded under workspace
`build-evidence/epdg-hosted-synthetic-2026-10-27/backend/verification.json` with
the tested source hashes. These tests include independent hosted policy, TLS,
origin/cookie, HMAC audience, receiver, private capture, alias and health-boundary
cases. Source tests do not establish that hosted resources, bootstrap, TLS peer,
proxy, authenticated CRM actor or browser acceptance have passed.

Release requires the exact hosted round trip and learner/mentor denial/recovery
checks, as well as current bundle and installed-worker verification. Keep the
bridge disabled until those checks pass. To contain this feature, disable the
handoff flag and redeploy the owned app, or stop its service, while retaining
identity, decisions, nonces, submissions and feedback. Database corrections are
reviewed forward changes; rewriting applied history or deleting learning evidence
is not a compensation procedure.
