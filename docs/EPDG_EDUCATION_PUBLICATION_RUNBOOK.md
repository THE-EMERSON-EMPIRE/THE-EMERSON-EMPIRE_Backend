# Approved education publication and enrollment

This is a manual release procedure for the portable candidate. It has not been executed on production. Production remains locked. Applying migrations, publishing curriculum, enrolling a real learner, mapping a mentor and sending invitations are separate approved operations. Do not infer any of them from a functional mailbox, a CRM stage, an old team name or this document.

The CRM retains applicants, resumes, onboarding evidence and HR decisions. The education database stores only the verified handoff reference and the resulting learning records. Existing account, assignment, receipt and feedback identities remain intact. There is no course-authoring or automatic curriculum-publication UI in this candidate. A content editor/coordinator can prepare the scoped curriculum draft; publication into the learning tables is an approved operator action.

## Required reviewed inputs

Use the exact access, account and portable-learning checksums recorded by `epdg-backend-core/scripts/account-release/migrate.cjs`, in that order, after the existing security/admin prerequisites. The migrator verifies the ledger and skips an already applied matching checksum. A mismatch aborts; never edit the ledger to bless different production SQL. No application startup runs these migrations.

The operator uses a separate authenticated migration connection, never the runtime connection or a browser database role. The runtime intentionally has no INSERT/UPDATE grant on programs, items, resources, enrollments or mentor assignments. Keep those grants closed. Match the approved target/runtime to `EPDG_ACCESS_MIGRATION_RUNBOOK.md` and the release approval record before opening the transaction.

Retain a private publication record containing:

- Exact target, application revision, migration checksums, operator identity, approval reference and approved execution time.
- The published `portal_access.resources` curriculum draft ID/revision, organization ID, program/cohort group UUID, and SHA-256 of its UTF-8 body. Content must be reviewed at that exact revision. A generic resource being published does not itself insert a course into `portal_learning`.
- An authenticated founder review from `portal_access.reviews` for that resource, with the exact review text `approve education publication sha256:<64 lowercase hex characters>`. The review is submitted through the session-bound resource review route; a typed founder ID or a reference string is not approval. A current founder must separately approve live execution while production is locked.
- Stable preallocated program/item/resource/enrollment/mentor-assignment UUIDs. Use IDs from the approved record on retries, never regenerate them to work around conflicts. Group IDs are explicit `portal_access.groups` entries in the same approved organization; historical teams are not a mapping source.
- For every learner, the existing core user ID, active company membership UUID, exact provisioned and verified HR handoff plan UUID, and explicit participant/team-lead group scope. A staff training account without verified learner onboarding is ineligible.
- For every mentor, their existing user ID, active company membership UUID, exact enrollment UUID, and approved `learning.review` scope for this program group. A coordinator/lead role alone does not create a mentor assignment.

Store real names/emails and HR references only in the private operator register. Do not copy resumes or onboarding documents into curriculum/resource text, repository fixtures or logs. The approved payload must contain only education content and the minimal IDs/references above.

## Transaction and invariant checks

The SQL below is a parameterized operator template. Bind each `$n` through a PostgreSQL client; do not interpolate strings or place credentials in command history. Execute it on the approved target inside one transaction with a 15-second statement timeout. The client must assert the stated row counts/booleans and issue ROLLBACK on any mismatch. This document is not an unattended seeder.

```sql
BEGIN;
SET LOCAL statement_timeout = '15s';
SELECT pg_advisory_xact_lock(hashtextextended('epdg-education-publication:' || $1::text, 0));
-- $1 = approved program UUID. Acquire this lock before each operation below.
```

First validate the exact curriculum source and persisted founder review; require exactly one row. The group must belong to the source organization. Bind the approved source resource UUID, revision, body hash, founder review UUID and group UUID in order.

```sql
SELECT r.organization_id, r.body, g.id AS access_group_id
FROM portal_access.resources r
JOIN portal_access.groups g ON g.id=$5::uuid AND g.organization_id=r.organization_id
JOIN portal_access.reviews v ON v.id=$4::uuid AND v.resource_id=r.id
WHERE r.id=$1::uuid AND r.kind='curriculum' AND r.status='published'
  AND r.revision=$2::bigint
  AND encode(sha256(convert_to(r.body,'UTF8')),'hex')=$3
  AND v.body='approve education publication sha256:' || $3
  AND portal_access.has_permission(v.actor_user_id,'admin.accounts.approve',
                                  'organization',r.organization_id::text)
FOR SHARE OF r,g,v;
```

The client parses the returned, hash-bound body as the reviewed curriculum payload and uses those exact values below. Reject unrecognized fields, duplicate IDs/positions, invalid dates, links or content that were not included in the review. Do not substitute a later editable file. Require nonempty titles, a program end after its start and a bounded payload fitting the curriculum resource limit.

```sql
INSERT INTO portal_learning.programs
 (id,organization_id,access_group_id,title,summary,starts_at,ends_at)
VALUES($1::uuid,$2::integer,$3::uuid,$4,$5,$6::timestamptz,$7::timestamptz)
ON CONFLICT(id) DO NOTHING;
SELECT (organization_id,access_group_id,title,summary,starts_at,ends_at)
 IS NOT DISTINCT FROM ($2::integer,$3::uuid,$4::text,$5::text,$6::timestamptz,$7::timestamptz)
 AS matches FROM portal_learning.programs WHERE id=$1::uuid;

-- Repeat for each approved item, requiring exactly one matches=true result.
INSERT INTO portal_learning.items(id,program_id,position,title,kind,description,content,due_at)
VALUES($1::uuid,$2::uuid,$3::integer,$4,$5,$6,$7,$8::timestamptz)
ON CONFLICT(id) DO NOTHING;
SELECT (program_id,position,title,kind,description,content,due_at)
 IS NOT DISTINCT FROM ($2::uuid,$3::integer,$4::text,$5::text,$6::text,$7::text,$8::timestamptz)
 AS matches FROM portal_learning.items WHERE id=$1::uuid;

-- Optional approved learning resources use the same immutable retry check.
INSERT INTO portal_learning.resources(id,program_id,title,description,body)
VALUES($1::uuid,$2::uuid,$3,$4,$5) ON CONFLICT(id) DO NOTHING;
SELECT (program_id,title,description,body)
 IS NOT DISTINCT FROM ($2::uuid,$3::text,$4::text,$5::text)
 AS matches FROM portal_learning.resources WHERE id=$1::uuid;
```

These statements intentionally do not overwrite an existing course. A conflicting UUID, position or changed payload aborts the whole transaction. Subsequent curriculum revisions require a new reviewed publication plan; do not rewrite an item already referenced by submissions or feedback.

## Enrollment and explicit mentor mapping

For each approved learner, bind program UUID, learner user ID, membership UUID and exact HR plan UUID. Require one eligible row before inserting enrollment. Lock the account/membership/plan while inserting; revocation and the runtime policies continue to apply after commit.

```sql
SELECT p.organization_id, p.access_group_id
FROM portal_learning.programs p
JOIN portal_security.account_states st ON st.user_id=$2::integer AND st.active
JOIN portal_security.memberships m ON m.id=$3::uuid AND m.user_id=st.user_id
 AND m.company_id=p.organization_id AND m.active
JOIN portal_accounts.provisioning_plans hp ON hp.id=$4::uuid
 AND hp.user_id=st.user_id AND hp.organization_id=p.organization_id
WHERE p.id=$1::uuid AND hp.status='provisioned'
 AND hp.onboarding_status='verified' AND hp.onboarding_verified_by IS NOT NULL
 AND length(btrim(hp.onboarding_evidence_ref))>0
 AND hp.approved_by IS NOT NULL AND hp.approved_hash=hp.payload_hash
 AND hp.approved_revision=hp.revision
 AND portal_accounts.plan_current(hp.id)
 AND portal_access.has_permission(st.user_id,'learning.participate','group',p.access_group_id::text)
FOR SHARE OF p,st,m,hp;

-- $1 enrollment UUID; $2 program; $3 learner; $4 organization; $5 membership; $6 HR plan.
INSERT INTO portal_learning.enrollments
 (id,program_id,user_id,organization_id,membership_id,onboarding_plan_id,active)
VALUES($1::uuid,$2::uuid,$3::integer,$4::integer,$5::uuid,$6::uuid,true)
ON CONFLICT(id) DO NOTHING;
SELECT (program_id,user_id,organization_id,membership_id,onboarding_plan_id,active)
 IS NOT DISTINCT FROM ($2::uuid,$3::integer,$4::integer,$5::uuid,$6::uuid,true)
 AS matches FROM portal_learning.enrollments WHERE id=$1::uuid;
```

Require the inserted enrollment's `portal_learning.learner_eligible(id)` to be true. A false result means rollback, even if a CRM screen says onboarding is complete. Do not activate an identity, repair an HR plan, infer a company membership or grant a role from this publication transaction; those use their separate approved account procedures.

For each explicitly approved mentor mapping, require the following query to return one row. Bind enrollment UUID, mentor user ID and mentor membership UUID. The mentor must differ from the learner.

```sql
SELECT e.organization_id
FROM portal_learning.enrollments e JOIN portal_learning.programs p ON p.id=e.program_id
JOIN portal_security.memberships m ON m.id=$3::uuid AND m.user_id=$2::integer
 AND m.company_id=e.organization_id AND m.active
JOIN portal_security.account_states st ON st.user_id=m.user_id AND st.active
WHERE e.id=$1::uuid AND e.user_id<>m.user_id AND portal_learning.learner_eligible(e.id)
 AND portal_access.has_permission(m.user_id,'learning.review','group',p.access_group_id::text)
FOR SHARE OF e,p,m,st;

-- $1 mapping UUID; $2 mentor; $3 membership; $4 enrollment; $5 organization; $6 approved display label.
INSERT INTO portal_learning.mentor_assignments
 (id,mentor_user_id,membership_id,enrollment_id,organization_id,active,mentor_label)
VALUES($1::uuid,$2::integer,$3::uuid,$4::uuid,$5::integer,true,$6)
ON CONFLICT(id) DO NOTHING;
SELECT (mentor_user_id,membership_id,enrollment_id,organization_id,active,mentor_label)
 IS NOT DISTINCT FROM ($2::integer,$3::uuid,$4::uuid,$5::integer,true,$6::text)
 AS matches FROM portal_learning.mentor_assignments WHERE id=$1::uuid;
```

The caller verifies every `matches` result, required helper result and expected row count, then records the exact inserted/preserved IDs in the private execution record and commits. Failure or cancellation rolls back the entire transaction. A retry with identical stable IDs and payload preserves history; a changed approval must be reviewed separately.

After an approved release, verify using actual learner and mentor sessions: own enrollment appears; another learner's enrollment, attachment and feedback do not; assigned mentor can review the intended submitted receipt; an unassigned mentor cannot. Use the existing submission, revision and feedback routes. Do not insert completions, receipts, review drafts or feedback as part of curriculum setup.

## Compensation and evidence

If post-publication checks fail, keep entry/sends closed and deactivate only the affected enrollment or mentor assignment using an independently approved operator transaction. Preserve programs, curriculum, submissions, receipts, attachments and feedback. Do not delete a user, rewrite a receipt or add broad runtime table grants to bypass a failed check. Fix the approval/mapping with a reviewed forward change and repeat scoped-session verification before reopening.

The native portable-learning suite validates the underlying restricted runtime, enrollment/HR/group guards, explicit mentor mapping, immutable receipts and transaction rollback. The combined HTTP suite validates the existing learner submission/revision/mentor flow through real sessions. This operator template itself remains a review procedure; synthetic suite results do not authorize a production publication or certify a real learner's access.
