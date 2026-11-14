# Portable account release candidate

This candidate extends the existing bcrypt credentials, mirrored stable IDs and opaque cookie sessions. It is disabled by default. No production migration, identity, role, invitation, sender verification, hosting unlock or deployment is authorized by this document. The separate private reconciliation register contains the intended population; no roster or credentials belong in this repository.

## Operator prerequisites and migration

1. Obtain a recorded founder approval for the exact database, service, frontend origin, migration checksums, role bootstrap, curriculum configuration and release window. Confirm the current production topology from the private infrastructure evidence. The canonical application and administrative staging remain protected until a separately approved hosting change.
2. Verify a recoverable database backup and the existing `core`/`epdg` mirror relationships, `portal_security` security and administrator migration ledgers. Resolve conflicting emails, deleted/rejected identities, unapproved membership records and legacy privilege assignments first. Legacy `founder_admin` and `webdev_technical` records acquire no canonical authority automatically.
3. Use a dedicated non-super migrator with ownership/grant authority over the reviewed schemas and tables. The application runtime must be a distinct LOGIN role with NOSUPERUSER, NOBYPASSRLS, NOCREATEDB and NOCREATEROLE, no schema ownership and no ability to activate accounts, edit memberships/roles, or rewrite audit. The runtime credential is not a migration credential. See `EPDG_ACCESS_MIGRATION_RUNBOOK.md` for ownership prerequisites and the exact scope model.
4. Create a private target JSON with `target_id`, `approval_reference`, `host`, `port`, `database`, `migrator_role`, `runtime_role`, `ssl` and `synthetic_only`. A session pooler may require a separately reviewed `connection_user` distinct from the bare PostgreSQL `migrator_role`; the command still verifies actual `current_user` matches the latter. Use the independently verified target values; the example tests use only a disposable loopback target. Keep credentials out of this file and Git. Supply `EPDG_MIGRATOR_PASSWORD` privately. Production TLS validates the server certificate.
5. From `epdg-backend-core`, run `node scripts/account-release/migrate.cjs --plan <private-target.json>`. Review the printed versions/checksums. Applying additionally requires `--apply`, `EPDG_ACCOUNT_MIGRATIONS_APPROVED`, and matching `EPDG_ACCOUNT_TARGET_ID` / `EPDG_ACCOUNT_RELEASE_APPROVAL`. This command has **not** been run against production.
6. The migration command obtains a transaction advisory lock and applies, in order, scoped access, account management, then portable education. The entire batch is atomic. Matching recorded versions are verified and skipped; changed checksums, unknown versions or unrecorded namespaces stop the batch. The command never populates release controls, creates accounts, grants founder scopes or sends email. Application startup never runs migrations.
7. The migration preserves existing identities and learning history. It adds dedicated access/account/education tables and bounded functions, replaces the named role-code constraint to include canonical codes, and removes unsafe legacy runtime grants before restoring minimum authentication access. Review the permission reduction against any separately supported legacy consumers before release; it intentionally prevents unrestricted legacy administrative writes.

## Separate release controls

Environment variables are configuration, not founder approval. An operator-owned `portal_accounts.release_control` row must also bind the reviewed target/reference to the exact current database and runtime session role. New schemas contain **no** release-control record. Only an approved operator may create or change it.

| Setting | Purpose |
| --- | --- |
| `EPDG_ACCOUNT_MANAGEMENT_ENABLED` | Explicitly selects the portable candidate; absent/off keeps account operations closed. |
| `EPDG_ACCOUNT_PRODUCTION_APPROVED` | Additional explicit production-runtime gate; unavailable in ordinary development profiles. |
| `EPDG_ACCOUNT_TARGET_ID`, `EPDG_ACCOUNT_RELEASE_APPROVAL` | Bounded references matching the operator-owned target binding. |
| `DB_HOST`, `DB_PORT`, `DB_NAME`, `DB_USER`, `DB_PASSWORD`, `DB_SSL` | Existing verified runtime connection; production requires validated TLS. |
| `PORTAL_ORIGIN`, `SESSION_CSRF_SECRET` | Exact approved HTTPS application origin and private session-CSRF secret. |
| `EPDG_INVITATION_DELIVERY_ENABLED`, `EPDG_INVITATION_BATCH_APPROVAL` | Separate mail enablement and recorded population approval; must match DB mail control. Applies to portable recovery mail too. |
| `MAIL_DELIVERY_MODE`, `RESEND_API_KEY` | Existing Resend adapter; no new provider or paid subscription. |
| `SMTP_FROM`, `PORTAL_MAIL_REPLY_TO`, `PORTAL_SENDER_VERIFIED` | Reviewed sender/reply-to and explicit verification gate. A configured mailbox alone is not domain verification. |

The inspected live service had a configured sender and Resend key, but no reply-to configuration and no verified domain/provider readiness evidence. This remains a release gate. No key was revealed, changed or tested against live mail. The private infrastructure report records the actual service/database/origin; repository documentation intentionally contains configuration purposes only.

The local native runner exclusively selects the fixed synthetic profile: `.invalid` identities and mailboxes, reserved names, fresh loopback PostgreSQL, Mailpit, no production keys and no inherited application environment. It uses the same portable migrations, services and HTTP endpoints under least-privilege roles.

## Approved account workflow

An authenticated scoped administrator proposes an immutable normalized email/name/role-scope plan. Duplicate and mirror conflicts produce a blocked plan. A repeated identical proposal reuses the same plan; conflicting open plans require reconciliation. Participant and intern-lead plans require a recorded CRM onboarding verification reference. The portal holds an opaque evidence reference, not resumes or HR records.

A currently authorized founder approves the persisted plan revision/hash. Supplying a reference string in a browser request cannot substitute for approval. Organization administrators cannot approve privileges; HR can manage approved participant/lead targets only. Existing target roles and scopes are rechecked, including changes made after the plan. Self-provisioning and self-role grants remain forbidden. The initial canonical founder scope requires a separately reviewed offline operator action; no email-based bootstrap exists.

For that first-owner bootstrap, an authorized operator must privately resolve the exact stable identity and its existing mirrors, establish control of the founder identity, review the specific company membership, and obtain an explicit approval naming the stable ID and organization. The operator uses the separate migrator connection in a single reviewed transaction to record the canonical assignment and organization scope with the approval evidence, then verifies runtime permissions and audit before enabling entry. Do not assume that a departmental address, legacy admin label or inclusion in the 23-account register supplies that approval. If the stable identity or verified credential is missing, keep bootstrap held for a separately reviewed identity-establishment/recovery procedure; this candidate does not create an owner from an email or reuse a synthetic/shared password. Subsequent grants follow the persisted-plan workflow rather than this one-time operator exception.

Provisioning resolves existing mirrored IDs and preserves their names, profiles and history; otherwise it creates a new mirrored ID with an unknowable random credential. It applies only the persisted approved organization and role scopes. Existing disabled membership and rejected/deleted records require reconciliation instead of silent reactivation. Provisioning is idempotent and separate from activation.

The administrator prepares an invitation, explicitly sends it, and can explicitly resend after the cooldown. Concurrent sends reuse the same attempt. A resend rotates the one-time token and provider idempotency key. Tokens are stored as hashes, bound to the current credential/account revision and approved eligibility, expire after 24 hours, and never appear in administrative responses or logs. Links carry the secret in the URL fragment.

The recipient confirms email possession and sets a password through the invitation. Acceptance is atomic and single-use, checks current eligibility and approval, activates the account, and revokes earlier sessions/recovery tokens. It does not create a login session. A subsequent authenticated login audit event supplies the verified last-login time. Disabling through an authorized session revokes active sessions, pending invitations and recovery tokens and writes an audit event; it grants no replacement role or access.

The UI/API distinguish account existence, prepared invitation, provider acceptance, email confirmation, accepted invitation, activated account and successful sign-in. `provider_accepted` means Resend/Mailpit accepted the request; delivery remains unknown. There is no unverified webhook or fabricated delivered timestamp. Failure is recorded as `failed`; a timeout is `unknown`, because a remote provider may have accepted before the timeout. Operators review uncertain outcomes before an explicit resend.

## Education and recovery

The release runtime reads `portal_learning`; the previous synthetic learning storage remains available only in its original profile. Enrollment requires a specific persisted approved/verified onboarding plan, active reviewed company membership, cohort access and session-bound RLS. Operator-owned curriculum/enrollments/mentor mappings start empty. Review these records separately; a CRM label alone never activates learning. Learner submissions, revision receipts, attachments and mentor feedback retain their existing route contracts. Technical, commercial, outreach and content access are bounded to approved resource kinds/scopes.

Password recovery continues through the existing opaque single-use token flow. Portable recovery dispatch requires both mail controls and the reviewed reply-to. Reset/change revoke prior sessions. Public response wording does not disclose whether an email exists. Do not enable the public frontend before the portable schemas, target binding and origin/cookie routing have been checked together.

## Failure recovery and release verification

Any migration error rolls back the complete portable batch. Do not edit a recorded checksum or take over an unrecorded schema. Investigate the conflicting owner/object or restore the reviewed migration from source. After commit, use compensating actions: stop mail in both DB and environment, disable affected accounts through the authenticated administration workflow, revoke scoped access through the founder-approved function, and preserve immutable audit/history. Do not drop tables or restore an old application version that expects broad runtime grants without separately reviewing its compatibility.

Before live invitations, require exact-commit CI/build/lint/audit, the synthetic lifecycle and eleven-role tests, private 23-account reconciliation, founder-approved population/roles/scopes, HR evidence, sender/reply-to/domain verification, controlled deployment, approved public-login hosting change, HTTPS/cookie/CSRF/deep-link checks and an operational owner for uncertain/failed delivery. The backend currently trusts no forwarded IP header: verify the actual Netlify/backend proxy topology and rate-limit behavior before release, because shared ingress may aggregate users under one IP. Synthetic requests from separate loopback addresses do not prove production proxy behavior. Release a reviewed batch only after those approvals. Verify each account's actual login; a successful send API response is insufficient.

The test runner and native evidence are documented in `EPDG_ACCOUNT_RELEASE_VERIFICATION.md`. No production release gate was exercised by those synthetic tests.
