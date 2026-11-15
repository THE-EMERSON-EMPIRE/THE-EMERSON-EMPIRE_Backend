# Offline first-founder bootstrap

This operator command extends the existing mirrored identity and opaque-session model. It is never imported by startup or exposed through HTTP. Production actions require separate exact approval; no real identity is named in this repository.

## Migration and operator prerequisites

Use the pinned toolchain and a clean exact reviewed checkout. The authenticated PostgreSQL current_user and session_user must both equal the separately approved migrator role, which must differ from the restricted runtime. Ownership and grant authority over affected existing objects must be established by the database owner; a runtime login, a role name in JSON, or SET ROLE is insufficient. Do not grant an application access to the migration credential.

The existing security ledger must match its manifest. If the administrator ledger is absent, an explicit approve_missing_admin_baseline target flag allows its reviewed migration only when both role_assignments and admin_events are absent. Partial/unrecorded objects block. The migration batch then applies access, accounts, education and bootstrap atomically. Existing three portable SQL manifests remain unchanged. The new bootstrap manifest adds five RLS tables, bounded functions and an exact foreign-key-backed scope approval alternative. No identity, company, release binding or role is seeded.

The migration plan includes the conditional administrator prerequisite when requested. Production TLS validates certificates and can use a privately supplied ca_file. Both migration and bootstrap CLI failures omit private values.

## Private plan and approval

Prepare a private target JSON with the reviewed host, port, database, connection_user, migrator_role, runtime_role, ssl, optional ca_file, synthetic_only, target_id, approval_reference, backend_commit, portal_origin, sender, reply_to and batch_approval_reference. Credentials are supplied privately through EPDG_MIGRATOR_PASSWORD.

A request contains email, name, identity_action and organization. For reuse_existing specify the existing user_id and organization.id. A missing identity requires create_missing. A missing first organization additionally requires action create_missing, name and evidence_reference; this path is refused if any organization already exists. Company approval is explicit establishment evidence, not invented email verification.

Run from epdg-backend-core:

```text
node scripts/account-release/founder-bootstrap.cjs --plan <private-target.json> <private-request.json> <new-private-plan.json>
```

The read-only plan binds exact source, target, complete migration ledgers, release control, restricted runtime, normalized identity/credential snapshots, all organizations, memberships and branch. It freezes proposed stable IDs and expires after 24 hours. IDs are unreserved: any drift requires a fresh plan and approval. No secret password or token is printed.

The approval file names plan_sha256, approval_reference, operator_reference, expires_at and authorize_founder_bootstrap. Missing identity and organization each require their own true authorization field; organization_evidence_reference must match. Expiry cannot exceed the plan. The founder invitation additionally requires authorize_invitation_send and the exact batch_approval_reference. These are separate decisions within the immutable approval record. If an invitation is intended later, obtain its explicit authorization before freezing that record; changing its bytes after apply is rejected. Never silently broaden an applied approval.

Applying requires EPDG_FOUNDER_BOOTSTRAP_APPROVED=1 and EPDG_FOUNDER_APPROVED_PLAN_SHA256 equal to the approved digest:

```text
node scripts/account-release/founder-bootstrap.cjs --apply <private-target.json> <private-plan.json> <private-approval.json> <new-private-receipt.json>
```

Apply rechecks current state under locks. Existing identities/history and credentials remain intact; a separately approved missing identity receives an unknowable random credential. The account stays inactive, founder assignment pending, and scope inactive. Scope provenance references immutable external operator approval, never a fabricated founder self-approval. Exact retries reuse the immutable record.

## Dispatch, acceptance and disable

After sender verification and both database/environment mail gates and the exact recipient batch are approved:

```text
node scripts/account-release/founder-bootstrap.cjs --send <private-target.json> <private-plan.json> <private-approval.json> <new-private-send-receipt.json>
```

Resend uses --resend with cooldown and rotates the proof/idempotency key. Provider rejection is failed; timeout is unknown; acceptance is provider_accepted, not confirmed inbox delivery. Raw proofs go only into the approved message fragment. Locked eligibility is rechecked before send and acceptance. Token rotation during an acceptance lock wait is rejected.

The recipient sets their own password and confirms email possession. Atomic single-use acceptance activates only the approved scope, invalidates old sessions/recovery and creates no login session. A subsequent login and audit prove access. Real founder acceptance cannot be claimed from synthetic tests.

For a fresh exact emergency approval containing authorize_emergency_disable, matching plan digest, operator/reference and unexpired expiry:

```text
node scripts/account-release/founder-bootstrap.cjs --revoke <private-target.json> <private-plan.json> <private-emergency-approval.json> <new-private-disable-receipt.json>
```

This revokes the founder account/role/scope, sessions and outstanding recovery/invitation access, preserving records and immutable audit. Stop mail separately in both controls. Do not delete identities, drop schemas or reset history.

## Isolated verification

EPDG_REVIEW_PHASE=3 selects the separate phase-three fixture state. account-release-review.cjs setup/verify tests the real migration batch, missing baseline, founder establishment and eleven-role HTTP lifecycle. bootstrap-existing-checks.cjs verifies reuse/history, privilege denial, failed/unknown transport, lock-wait token rotation and emergency revocation. production-profile-review.cjs uses the real production cookie/configuration with explicit fixture CA and fixed-loopback injected mail. No trust store is changed and no real provider is contacted. Exact-head receipts, browser results and provider prerequisites live in the private workspace release evidence.
