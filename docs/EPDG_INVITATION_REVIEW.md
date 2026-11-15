# EPDG invitation review candidate

This candidate continues the existing TypeScript backend and cookie-session portal. It is a **local synthetic review**, not a production release or a production account-provisioning result. Production invitations and privileged owner controls remain closed. No real identities, email roster, credentials, or invitation tokens belong in this repository.

## Architecture and baseline

- Canonical backend: `THE-EMERSON-EMPIRE/THE-EMERSON-EMPIRE_Backend`; frontend: `webdev692/Empire-emerson_frontend`.
- The branch starts at backend PR #13 revision `841b81649954b3a51e40ad85a1ddd51fb8668d04`, which stacks hosted admin infrastructure on PR #12. Both are separate, unmerged review candidates. The root JavaScript foundation and `epdg-backend-core` remain distinct services.
- Authentication is the existing custom bcrypt / opaque cookie-session implementation in `PortalService`, backed by `core.users`, its `epdg.users` mirror, branch roles, account states, and scoped memberships. Supabase hosting of database objects does not make this Supabase Auth.
- Existing login, logout, password change, recovery, absolute/idle expiry, CSRF protection, session rotation/revocation, and privacy-safe error handling are preserved. Only stable numeric user identifiers are used; this implementation never inserts identities or profiles.
- Existing delivery uses Resend outside synthetic mode, Mailpit for local synthetic mail, and a separate database capture for hosted synthetic recovery. This candidate uses the existing Mailpit adapter. It creates no provider, paid service, team seats, or subscriptions.
- Netlify visitor restrictions are distinct from application authentication. Their removal is neither implemented nor required for this local proof. A production participant entry point remains a release-design task; no paid Netlify membership should be inferred as a participant requirement.

## Implemented behavior

The explicit `EPDG_INVITATION_REVIEW_MODE` and admin review mode must both be enabled, and the existing exact local synthetic environment must validate. Production, hosted practice, Neon admin staging, external database hosts, real mailboxes, and production email credentials fail closed.

An authenticated synthetic reviewer may list reviewed candidate identities and invitation status, issue an invitation, and explicitly resend it. Candidate approval is a separate operator-owned record. It requires verified fictional onboarding evidence, an approved existing intern profile, an existing approved membership, an inactive account, and no active privileged role assignment. A CRM stage label cannot supply this evidence.

Generation commits before SMTP delivery. Repeating or concurrently issuing the same operation reuses the current invitation and sends at most one message. A crash during delivery leaves `sending`, which is an uncertain delivery state requiring review; it is not reported as successful delivery. Provider failures are recorded. Resend is explicit, rate limited, has a cooldown, revokes the preceding token, and keeps the same user/profile identity.

Only hashes of invitation tokens are stored in invitation tables. The raw token appears only in the synthetic email and transient process memory; it is absent from API responses and logs. URLs carry tokens in the fragment. Acceptance checks expiry, one-time use, delivery status, current email, credential hash, account revision, current approval, and existing scope. A bounded database function atomically sets the password in both existing user mirrors, activates the account, confirms possession of the emailed token, records acceptance, and revokes old sessions/recovery tokens. Acceptance creates no session: a successful subsequent login provides the authentication evidence.

The administrative result shows actual delivery/acceptance timestamps and last successful login from the existing login audit, never an inferred sign-in. Requested role choices are a server-provided review catalog. Only the participant scope can be invited in this candidate; founder, organization administrator, HR, technical, coordinator, content, sales, outreach, and restricted-viewer scopes remain unavailable until their actual permissions and server-side grant procedure are reviewed. Existing mentor and leadership assignments are neither replaced nor enlarged.

## Database boundaries and migration

`epdg-backend-core/invitation-review-migrations/001-invitation-review.sql` is additive, idempotent, checksummed, local-only, and deliberately refuses a hosted database. It seeds no identities or permissions and never runs during application startup. Its `portal_invitation_review` schema is separate from the existing security schema so the existing readiness table count remains valid.

All five added tables enable RLS and revoke public access. The existing local backend runtime has `BYPASSRLS`; authorization therefore relies on the authenticated server plus restricted grants and the bounded activation function, not a claim that per-user RLS policies protect a direct browser database connection. Browser database roles receive no grants. The runtime cannot create candidate approvals, directly set account activation, or edit audit history. The security-definer functions use an empty search path and fully qualified objects.

Migration application is an explicit operator step inside the disposable local fixture only. Preserve the checksum ledger. Compensating action is to stop the local fixture and disable the review feature; no destructive reverse migration or rollback of identity history is needed. An authenticated local operator can run `node scripts/local-synthetic/invitation-review.cjs disable <stable-user-id>` to disable only an existing reviewed synthetic participant. The command verifies the exact local database/operator boundary, rejects privileged identities, disables candidate approval and account access, revokes pending invitations/sessions/recovery tokens, and records an operator audit in one transaction. It cannot enable accounts or grant roles. There is no new production disable/grant UI.

## Local verification

Use the repository's pinned Node 22.23.1 and npm 11.17.0. Install with `npm ci`, then in `epdg-backend-core` run `npm run build`, `npm test`, and `npm run lint`.

The native harness `scripts/local-synthetic/invitation-review.cjs` uses the existing PostgreSQL 17.11 and Mailpit binaries in the workspace tools directory. Optional binary locations are `EPDG_REVIEW_PG_BIN` and `EPDG_REVIEW_MAILPIT`. It refuses occupied fixture ports and never attaches to an existing database. Run `setup`, then `verify`, then `edges`, once in a fresh fixture. The setup creates a disposable local cluster, applies each migration twice, records exact checksums, and seeds only fictional `.invalid` accounts. It retains its private state under ignored `.local-synthetic/`; never commit or publish that directory.

The API binds loopback port 58000, PostgreSQL 55432, and Mailpit SMTP/UI 51025/58025. The synthetic frontend uses loopback 58080. `browser-review.json` inside the private fixture directory is the browser-review handoff; it contains only generated synthetic credentials and a synthetic invitation. The fixture remains running for review. To stop it, use its recorded API/Mailpit process IDs after verifying process identity, and `pg_ctl -D <recorded fixture directory>/pgdata -m fast -w stop`. Do not stop unrelated services or delete existing workspaces.

Observed validation on 2026-11-14:

- Foundation: 9/9 tests.
- Core: 194/194 tests, including four new invitation policy/migration/router regressions.
- Native PostgreSQL + Mailpit: 30 lifecycle checks and 20 additional concurrency/delivery/binding/disable checks.
- TypeScript build passed. Lint completed with no errors and 161 pre-existing warnings in legacy code.
- Native coverage includes real SMTP capture, idempotent parallel issuance, one successful concurrent acceptance, valid/invalid/expired/replayed tokens, current approval, email confirmation, stable identity preservation, login/logout, recovery/session revocation, role escalation denial, CSRF/origin denial, failed delivery followed by explicit token rotation, credential/revision invalidation, NULL rejection, and database grant checks.

Full evidence is retained privately in the workspace `build-evidence` directory. No evidence contains real account records or invitation credentials.

## Production acceptance remains blocked

This work does not establish that the requested real identities exist, are activated, or have signed in. Their private register is maintained separately from Git. Before a real release, the founder and authorized administrators must review the verified production target and current data, reconcile existing stable IDs and onboarding eligibility, approve role scopes, implement/review a production-safe provisioning/disable procedure and migration, verify existing sender configuration and delivery, test authenticated user-facing hosting without Netlify team seats, review the current dependency audit, review exact-head CI and private preview evidence, and approve the production migration/release and exact invitation batch. That remaining work is more than flipping this local feature flag: the candidate intentionally cannot send real invitations.

The original pinned core reported 19 advisories and the foundation reported three. Targeted reviewed remediation refreshed compatible `proxy-addr`, `body-parser`, `brace-expansion`, `ip-address` and `js-yaml` patches, added narrow Express `qs` and notifier `semver` overrides, upgraded Nodemailer to exact 10.1.4 with its bundled declarations, and removed unused Puppeteer after a full source/script search found no consumers. Pinned Node 22.23.1 satisfies Nodemailer 10's Node requirement. Root and core `npm ci`/`npm audit` both reported **zero vulnerabilities** after this change; build, full regression tests, and the real Mailpit SMTP invitation/recovery tests passed against the new lockfiles. No broad automatic audit fix or unrelated direct dependency upgrade was used.

Founder-led. Built by interns. Credit given wherever credit is due. This branch preserves contributor history and adds a focused continuation of the existing implementation.
