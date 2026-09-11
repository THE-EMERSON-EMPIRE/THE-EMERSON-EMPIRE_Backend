# Week Two — Migration History & Recovery Checklist

**Prepared by:** Abhishek Chauhan
**Date:** 11 September 2026
**Status:** Investigation and proposal only — no database changes were made.

### Project Context

- **Team:** Team Eclipse
- **Area:** EPDG Platform Reliability, Identity, DevSecOps & QA
- **Reviewer:** Kamdem Netting II

---

## 1. Executive Summary

The goal this week was to establish the real database-change state of the backend before proposing any migration. The repository was reviewed end to end: both entrypoints (the root JavaScript foundation and `epdg-backend-core`), the migration files, the build tooling that protects them, the deployment documentation, and the test suite.

The repository contains 33 baseline migrations, numbered 001 through 033, and the application no longer has any startup path that applies migrations. The previous `postgres-migrations` runner — including its `ALLOW_DATABASE_MIGRATIONS` gate and a hash-mismatch "self-heal" that reset and replayed all migrations — was deliberately removed, and the build now excludes all migration SQL from the deployed artifact. The two destructive historical migrations (011 and 024) are locked in place as audit evidence and can no longer be executed by the service.

The repository also shows several areas that need to be checked against the live database: the tracked migrations and the introspected schema reference disagree on the announcements, feedback, and resources tables; a separate Supabase migration for the agency tables sits outside the numbered baseline; and the RLS/grants picture documented in July has not been resolved. The live migration ledger was last compared against the baseline on 25 July 2026 — that comparison is recorded in the release journal, but it could not be re-confirmed during this investigation.

No database connection was used and no migration was run at any point. Local verification was completed under the repository's pinned Node 22.23.1 toolchain, and all checks passed. The next step is owner-approved read-only database access to confirm the live ledger, the affected schema, RLS/grants, and the backup/restore evidence — only then should a reconciliation migration be drafted.

---

## 2. Repository and Migration Inventory

The backend is a single repository with two sibling entrypoints:

- `server.js` — a small JavaScript API foundation (agency inquiries, public contributions, certificate verification) using `pg` against `DATABASE_URL`.
- `epdg-backend-core/` — the TypeScript API for EPDG auth, interns, mentors, and administrators, using `pg` plus `@supabase/supabase-js` against separate `DB_*` variables.

Toolchain: Node 22.23.1 / npm 11.17.0, pinned in both `package.json` files and `.nvmrc`, with committed lockfiles. There is no Dockerfile, no compose file, and no CI configuration in the repository — deployment goes through Railway's Git integration (Nixpacks, build `npm run build`, start `npm start`, healthcheck `/health`). Deployment docs map the service to project `epdg platform`, service `tranquil-tenderness`, root `/epdg-backend-core`, production environment `production_epdg`.

Both `.env.example` files document variable names only, and no populated environment file exists in the worktree. Testing uses Node's built-in test runner in both packages.

For traceability: this investigation was done on branch `abhishek/week-2-migration-reliability` at commit `7bfdb11` ("Merge pull request #2"). PR #2 has since been merged to `main`, although some older documentation still describes it as open.

---

## 3. Migration History

All 33 baseline migrations live in `epdg-backend-core/src/db/migrations/` with LF line endings enforced by `.gitattributes`. Two layers protect them:

- `scripts/copy-migrations.cjs` fails the build if the migration filenames ever drift from the reviewed policy.
- `src/db/migrationSafety.ts` enforces consecutive IDs, an allowlist, and non-destructive SQL for any future forward migration.

| Migration | Purpose | Notes |
|---|---|---|
| 001 | Users table | Base auth table |
| 002 | Companies table | |
| 003 | Schools table | |
| 004 | Intern profiles | |
| 005 | Internship slots | |
| 006 | Applications | |
| 007 | Placements | |
| 008 | Tasks | |
| 009 | Submissions | |
| 010 | Milestones | |
| 011 | Admins table | **Destructive** — starts with `DROP TABLE IF EXISTS admins CASCADE` |
| 012 | Intern approval fields, rejection reason | Idempotent |
| 013 | Intern profile enrichment | Idempotent |
| 014 | `cover_letter` on intern profiles | |
| 015 | `extracted_skills` on applications | |
| 016 | Admin-created slots (optional company, `created_by`) | |
| 017 | Partial unique email index | Lets soft-deleted users re-register |
| 018 | Mentor capacity (`max_capacity`) | |
| 019 | Forced password change flag | |
| 020 | Certificates + certificate templates | |
| 021 | Certificates schema patch | Additive, idempotent |
| 022 | Announcements, gamification, resources, feedback | See schema discrepancy below |
| 023 | Audit log | |
| 024 | Certificates table fix | **Destructive** — conditionally drops and recreates `certificates` with a UUID id |
| 025 | Intern workflow: roadmap weeks, mentor sessions, intern skills | |
| 026 | `admin_type` on admins, mentor backfill | |
| 027 | Onboarding flow columns | |
| 028 | Opportunities + opportunity applications | |
| 029 | Roadmap system (tracks, modules, level progress, completions) | |
| 030 | Level-up request tracking | |
| 031 | Career file system + readiness score history | |
| 032 | Move tables and enums from `public` to `epdg` schema | Non-destructive; the `public.migrations` ledger stays put |
| 033 | Create `core` schema, backfill `core.users` and `core.user_branch_roles` | Additive; preserves existing `epdg.users` IDs |

**How the ledger used to work.** Before its removal, the runner (visible at commit `f6f8670`) used `postgres-migrations` against a `public.migrations` table (`id`, `name`, `hash`, `executed_at`) behind the `ALLOW_DATABASE_MIGRATIONS` gate. It also had a hash-mismatch "self-heal" that reset and replayed all migrations from scratch — the reason migrations 032 and 033 are written to be replay-safe. That whole mechanism was removed in commit `d125e57`; the hash convention (SHA-1 of filename plus LF-normalized SQL) is still recomputable from the policy module today.

**The separate Supabase migration.** `supabase/migrations/20260708_api_foundation_review.sql` creates the agency tables (`agency.clients`, `agency.booking_inquiries`, `agency.compliance_acknowledgements`) and enables RLS on them without policies. It is not part of the 001–033 sequence, is not covered by the migration policy, and its header says it was committed for review only. Whether it was ever applied through the Supabase dashboard is not visible from the repository — and if it was applied there, no ledger row would record it. The two migration streams should be reconciled under one policy before anyone treats them as one history.

---

## 4. Expected vs Actual State

| Area | Repository / expected state | Live state | Status |
|---|---|---|---|
| Migration files | 33 baseline files, consecutive IDs, LF endings | Confirmed in the repository; policy, build, and tests all enforce it | Confirmed |
| Runtime artifact | No SQL, no migrations directory, no executor, no `postgres-migrations` dependency | Confirmed by build and artifact inspection at this commit | Confirmed |
| Migration ledger (`public.migrations`) | Bootstrap row 0 plus IDs 1–33 matching the baseline | Last compared 25 July 2026 (release journal); not re-checked this week | Needs DB access |
| Migrations 011 / 024 | Already applied in the ledger; never pending, never re-run | Same source: the July journal | Needs DB access |
| Live schema vs `SCHEMA_REFERENCE.sql` | Snapshot generated 2 July 2026 | Nothing since; no evidence either way about changes | Needs DB access |
| Announcements / feedback / resources | Migrations and the schema snapshot describe different shapes (e.g. `subject/message/target_audience` vs `title/body/audience`) | Which shape the live database holds is unknown | Known drift, needs DB access |
| Agency tables | Review-only migration exists | Application status unknown | Needs owner confirmation |
| RLS / grants | July audit found disabled RLS on several tables; no policy map exists | Not re-checked; unresolved | Needs DB access |
| Database connectivity | Strict TLS, then `SELECT 1`, before listening | Last proven on a 26 July PR-environment deployment; not current | Needs current deployment |
| Startup migrations | Never run by the application | Confirmed in code and tests at this commit | Confirmed |

---

## 5. Key Findings and Risks

**1. The baseline is protected, but the live ledger is unproven since July.**
Evidence: release journal entry "Live migration-ledger verification" (25 July 2026); commits since then touched only auth logic, not schema. Why it matters: the ledger is the record that 011 and 024 were applied — if parity silently changed, decisions made from the repository would be wrong. Next step: re-run the comparison read-only (checklist below).

**2. Announcements, feedback, and resources have a real schema discrepancy inside the repository itself.**
Evidence: migration 022 defines `announcements(subject, message, target_audience, total_recipients)`; the introspected `SCHEMA_REFERENCE.sql` shows `announcements(title, body, audience)`. Why it matters: any new query or feature written against the wrong shape will fail — or worse, be "fixed" against the wrong assumption. Next step: compare the live tables, then decide which artifact is authoritative.

**3. The agency migration is outside every control.**
Evidence: file header (review-only), absence from the policy allowlist and the ledger narrative. Why it matters: out-of-band dashboard SQL bypasses both the ledger and the reviewed workflow. Next step: confirm with the owner whether it was applied, and bring it under the policy either way.

**4. RLS/grants gaps remain unresolved.**
Evidence: `docs/supabase-security-audit.md` — RLS disabled on `epdg.career_*`, `core.branches`, `core.users`, `core.user_branch_roles`; other tables have RLS enabled with no policies. Why it matters: the risk is contained while access stays backend-only, but it becomes serious the moment any direct Supabase client access ships. Next step: build the policy map before enabling anything.

**5. The identity mirrors have no database-level guarantee.**
Evidence: `core.users`/`epdg.users` parity is application-managed (transactional, fail-closed in code) with no trigger; row-level parity has never been verified live. Next step: include a read-only parity check with the database access.

**6. Backup and restore capability is unverified.**
Covered in the next section — this is the highest-consequence unknown.

Risk summary: the top risks are the unverified restore capability for identity and certificate data, the unresolved schema drift, and the possibility of untracked out-of-band migrations. Documentation staleness (July evidence used for September decisions) is a process risk worth fixing with a freshness rule.

---

## 6. Backup and Recovery Assessment

The repository contains no backup or restore tooling of any kind — no `pg_dump`/`pg_restore` scripts, no scheduled jobs, no CI steps, no runbook section. The only rollback guidance is code-level (redeploy the last verified Railway deployment) plus a firm policy: database rollback means a separately reviewed forward compensating migration, never drops or record replacement. No backup is recorded in the release journal, and none is claimed.

That does not prove backups don't exist — Supabase platform-level backups are provider-side and invisible from this repository. But for a system holding password hashes, legal acknowledgements, and certificate integrity records, having no documented and tested restore evidence is a material gap on its own. Nothing in this report should be read as assurance that a restore would succeed. Confirming the backup/PITR configuration and the last successful restore test is the first thing to settle with the project owner.

---

## 7. Dependencies / Impact

- **Provider access** — Supabase (read-only SQL role, backup settings) and Railway (environment names, deployment logs). None of this is reachable from the repository.
- **Authorization** — lead approval for the backup check, any reconciliation work, and the RLS/grant design.
- **Prerequisites** — a reviewed RLS policy map before any RLS change; the two migration streams unified under one policy allowlist.
- **Cross-repo decisions** — frontend contract items (school-type normalization, dashboard APIs) block parts of the schema reconciliation.
- **Toolchain** — release-gated runs must use the pinned Node 22.23.1 / npm 11.17.0.

---

## 8. Recovery Checklist

Ordered from safest to most privileged. Nothing below has been run.

| Check | What needs to be confirmed | Status |
|---|---|---|
| Migration ledger | Compare live `public.migrations` (names + hashes, metadata only) against the 001–033 baseline | Needs read-only DB access |
| Schema drift | Compare live `announcements`, `feedback`, `resources` (plus a `core`/`epdg` inventory) with the repository | Needs read-only DB access |
| RLS/grants | Inventory `rowsecurity` and policy counts for `core`, `epdg`, `agency` | Needs read-only DB access |
| Agency tables | Confirm whether `agency.*` exists and was applied out-of-band | Needs read-only DB access |
| Identity mirrors | Sample `core.users` vs `epdg.users` ID/hash equality counts (never values) | Needs read-only DB access |
| Environment variables | Confirm `DB_*` presence and pairing in production and PR environments, names only | Needs Railway access |
| Backup | Confirm latest backup/PITR coverage | Not verified |
| Restore test | Confirm the last successful restore test and its evidence | Not verified |
| Reconciliation (034) | Decide whether a minimal forward-only migration is required | Blocked on evidence and approval |
| 034 execution | If approved, run via a manual reviewed operator workflow — never at startup | Not drafted, not executed |

---

## 9. Questions / Approvals Needed

1. Can I get owner-approved read-only access to the target database so I can compare the migration ledger and the live schema?
2. Which environment should be treated as the target for this comparison — `production_epdg`, or a supervised copy?
3. What is the latest verified backup/PITR point, and when was the last restore test performed? Is evidence available?
4. Was the agency review migration ever applied through the Supabase dashboard, and should out-of-band changes be brought under the migration policy?
5. Once the live state is confirmed, should I prepare a minimal reconciliation migration for review — and which of the two announcements/feedback/resources shapes is authoritative?

---

## 10. Verification Results

| Check | Result |
|---|---|
| Root tests (`npm test`) | 9/9 passed |
| EPDG install (`npm ci`) | Passed (443 packages) |
| EPDG build (incl. migration-exclusion guard) | Passed; `dist/db/migrations` absent |
| EPDG tests | 57/57 passed |
| EPDG lint | 0 errors, 161 pre-existing warnings (unsuppressed) |
| Migration artifact guard | Passed |
| `postgres-migrations` lockfile audit | Absent, as expected |

These checks were run using the repository's pinned Node 22.23.1 / npm 11.17.0 toolchain. The initial pass was done on the workstation's default Node 24.14.0 with the same results; the pinned-toolchain run is the evidence of record. One environment note: this machine has a separate Node installation earlier in PATH than nvm's, so the pinned version was used session-scoped for the verification — worth tidying up on this workstation at some point, but it doesn't affect the repository.

All commands were local and repo-only: no live database was connected, no migration ran, no credential was read, and nothing under `src/db/migrations` was modified.

---

## 11. Open Items

| Item | Current status | Next action |
|---|---|---|
| Live migration ledger | Not verified this week | Read-only DB check |
| Live schema (announcements / feedback / resources) | Not verified | Read-only table comparison |
| RLS/grants | Not verified | DB inspection |
| Backup / PITR | Not verified | Owner evidence |
| Restore test | Not verified | Owner evidence |
| Agency table status | Unknown | Confirm with owner |
| Deployment smoke test | Not run against a current deployment | Run once an origin is provided |
| Reconciliation migration 034 | Not drafted | Decide after evidence |

None of these is a code defect — they are open verification items that need owner-approved access or decisions. The npm pin has one mechanical footnote: Node 22.23.1 bundles npm 10.9.8, so the exact npm 11.17.0 pin was met by invoking `npx npm@11.17.0`; the team may want to document the canonical way to install that npm version.

---

## 12. Final Recommendation

Do not apply or create a reconciliation migration yet. The repository-side investigation is complete: the 33-migration baseline is intact, protected, and excluded from the runtime artifact, and local verification passes under the pinned toolchain. What is still outstanding is everything that lives outside the repository — the live ledger, the affected schema, RLS/grants, the agency tables, and the backup/restore evidence.

The next step is owner-approved read-only database access to run the checklist in section 8. If that comparison confirms the ledger and schema match the baseline, this document stands as the migration history and recovery checklist and no database change is needed. If it confirms drift, a minimal forward-only reconciliation migration can then be prepared for review — with a compensating plan, never by editing history, marking migrations as applied without evidence, or rewriting migration files to force a match.
