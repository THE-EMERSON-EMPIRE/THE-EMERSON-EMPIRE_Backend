# RLS policy map — static review package

> **Design status: DRAFT / REVIEW ONLY. No SQL was applied and no runtime policy was verified.**

This map has exactly one row for each tracked table contract: 40 tables in `epdg-backend-core/SCHEMA_REFERENCE.sql` (three `core`, 37 `epdg`) plus three proposed `agency` tables in `supabase/migrations/20260708_api_foundation_review.sql`. Supabase-managed tables and the issue-only names `public.messages`, `public.notifications`, `public.rooms`, and `public.sessions` are not tracked schema contracts and are listed separately under decisions rather than invented here. The runtime-mentioned `public.migrations` table also lacks tracked DDL and is handled as an internal-object decision.

The 2026-07-02 schema reference is the newest versioned catalog snapshot, not fresh August 8 database evidence. `docs/supabase-security-audit.md` reports seven named tables with RLS disabled and says many other tables have RLS enabled without policies, but it does not identify those other tables one by one. Accordingly:

- **D** — repository audit explicitly reported RLS disabled.
- **U** — exact live RLS state and policy count are unknown from static evidence.
- **P** — review SQL proposes `ENABLE ROW LEVEL SECURITY`; application is unverified.

Access notation describes backend behavior proven in tracked routes/services, not direct Data API permission:

- **R/C/U/D** — read/create/update/delete through a backend-mediated path.
- **Projection** — a privacy-limited backend response; it is not permission to select the raw table.
- **Issue-only** — checked in Issue #18 but not proven by tracked RLS or an equivalent current route.
- **Decision** — repository evidence is insufficient; no permission may be inferred.
- **—** — no access rule was found.

At the database boundary the design intent is backend-mediated: no direct Data API access is approved until the identity and role decisions are resolved. The review draft removes only ACL entries granted directly to `anon` and `authenticated`; it does not establish effective denial because `PUBLIC` grants, inherited role membership, default privileges, and callable routines are unverified. This preserves the documented `frontend → backend API → Postgres` architecture as a design boundary, not a claim about live ACL state. Supabase documents [grants and RLS as separate Data API layers](https://supabase.com/docs/guides/api/securing-your-api) and requires RLS on exposed tables while still granting only necessary object privileges in its [RLS guide](https://supabase.com/docs/guides/database/postgres/row-level-security).

<!-- TABLE_MAP_START -->
| Table | Source / RLS evidence | Anonymous / public | Authenticated participant | Intern own record | Assigned mentor or team lead | Administrator | Founder / super-admin | Backend service only | Ownership or unresolved rule |
|---|---|---|---|---|---|---|---|---|---|
| `core.branches` | Snapshot; **D** | — | — | — | — | — | Decision | Yes | Shared branch dictionary; no row owner. |
| `core.user_branch_roles` | Snapshot; **D** | — | Auth context only | Auth context only | Auth context only | Read via admin flows | U/D via super-admin flows | Yes | `user_id → core.users`; no Supabase Auth identity bridge. |
| `core.users` | Snapshot; **D** | — | R/U own account via API | R/U own account via API | R/U own account via API | R/U via admin API | C/R/U/D via guarded API | Yes | Integer application identity; no `auth.users` UUID link. |
| `epdg.admins` | Snapshot; **U** | — | Admin auth context | — | R own mentor context | R/U via admin API | C/R/U/D mentor/admin management | Yes | `user_id → epdg.users`; mentor flag exists, team-lead role does not. |
| `epdg.announcements` | Snapshot; **U** | Issue #18 public-read group only; unproven | Audience values exist; company/school routes unproven | R via intern API | Decision | C/R via admin API | Inherits guarded admin API | Yes, mediated | `created_by` records author, but audience strings are not an authorization model. |
| `epdg.applications` | Snapshot; **U** | — | Company access is not proven | C/R through `intern_profiles.user_id` | — | R/review via admin API | Inherits guarded admin API | Yes, mediated | `intern_id → intern_profiles`; identity bridge unresolved. |
| `epdg.audit_log` | Snapshot; **U** | — | — | — | — | R/C through audit APIs | R through guarded admin APIs | **Only** | `admin_id` is actor attribution, not ownership; private metadata. |
| `epdg.badge_awards` | Snapshot; **U** | — | — | R own awards | — | C/R award flows | Inherits guarded admin API | Yes, mediated | `user_id → users`; `awarded_by` is actor attribution. |
| `epdg.badges` | Snapshot; **U** | — | R catalog through intern API | R | — | R/award selection | Inherits guarded admin API | Yes, mediated | Shared lookup; no owner or publication flag. |
| `epdg.career_experiences` | Snapshot; **D** | — | — | C/R/D through parent career file | Not exposed by current mentor view | — | Decision | Yes, mediated | `career_file_id → career_files → intern_profiles → users`. |
| `epdg.career_files` | Snapshot; **D** | R **projection** only when public + approved + active | R public search projection | C/R/U own | R/U only when `intern_profiles.mentor_id` matches | R cohort analytics | Inherits guarded admin API | Yes, mediated | Proven parent ownership; raw row has fields broader than public projection. |
| `epdg.career_projects` | Snapshot; **D** | R **projection** only through public parent | — | C/R/D own manual projects | R for assigned intern | — | Decision | Yes, mediated | `career_file_id → career_files`; public status lives on parent. |
| `epdg.career_skills` | Snapshot; **D** | R **projection** only through public parent | — | C/R/U/D own | R/U endorsement for assigned intern | Used in analytics | Inherits guarded admin API | Yes, mediated | `career_file_id → career_files`; mentor predicate is proven in service code. |
| `epdg.certificate_templates` | Snapshot; **U** | — | — | — | — | R for issuance | Decision | **Only** | Shared template; no owner/author column. Issue #18 priority remains unchecked. |
| `epdg.certificates` | Snapshot; **U** | R active-certificate **projection** via backend | — | **Issue-only** self-access; no matching RLS/route proven | — | R/list; issuance currently unavailable | U revoke through super-admin guard | Yes, mediated | `intern_id → users`; RLS cannot provide the existing column-limited public response by itself. |
| `epdg.companies` | Snapshot; **U** | Limited company fields appear in slot/opportunity projections | R own profile via account API | — | — | R/U approval flows | Inherits guarded admin API | Yes, mediated | `user_id → users`; company-owned write behavior is not implemented. |
| `epdg.feedback` | Snapshot; **U** | — | Decision | C/R intent exists, but tracked code/schema shapes conflict | Mentor-to-intern intent exists; exact path conflicts | R/U intent in admin service | Inherits guarded admin API | Yes, mediated | Snapshot uses `given_by/type`; migration/code also use `from_name/role/category`. Reconcile first. |
| `epdg.intern_level_progress` | Snapshot; **U** | — | — | C/R/U through profile ownership | Admin/mentor semantics unresolved | R/U level-up flow | Inherits guarded admin API | Yes, mediated | `intern_id → intern_profiles`; request identity unresolved. |
| `epdg.intern_profiles` | Snapshot; **U** | Limited fields in public career projection only | — | R/U by `user_id` | R/U by `mentor_id`; team lead absent | R/U approval and workflow | Inherits guarded admin API | Yes, mediated | Both owner and assigned-mentor columns exist; no Supabase identity mapping. |
| `epdg.intern_roadmap_progress` | Snapshot; **U** | — | — | C/R/U by direct `intern_id → users` | — | Issue #18 says priority complete; runtime policy unproven | Decision | Yes, mediated | Direct integer user relationship is proven; database request identity is not. |
| `epdg.intern_skills` | Snapshot; **U** | — | — | R by direct `intern_id → users`; writes are system-derived | R for assigned intern only through broader career flow | Analytics/administration intent | Inherits guarded admin API | Yes, mediated | Direct user relationship is proven. |
| `epdg.internship_slots` | Snapshot; **U** | — | Company ownership is a Decision | R open slots | — | C/R/U/D through admin API | D through super-admin guard | Yes, mediated | `company_id → companies`; nullable admin-created rows need a separate rule. |
| `epdg.mentor_sessions` | Snapshot; **U** | — | — | C/R by `intern_id` | Relationship exists by `mentor_id`; mentor API is incomplete | Decision | Decision | Yes, mediated | Direct intern and mentor IDs exist; assignment consistency with placement/profile is undefined. |
| `epdg.milestones` | Snapshot; **U** | — | — | R through owned placement | Decision | Decision | Decision | Yes, mediated | Ownership is indirect through `placement_id`; updater semantics are not documented. |
| `epdg.module_completions` | Snapshot; **U** | — | — | C/R/U by intern profile | Sign-off code exists but does not prove assignment in that method | R/U through admin roadmap API | Inherits guarded admin API | Yes, mediated | `intern_id → intern_profiles`; `mentor_id` is signer, not proof of assignment. |
| `epdg.onboarding_agreements` | Snapshot; **U** | — | — | **Issue-only**; write route is currently unavailable | — | Decision | Decision | **Only** currently | `intern_id → users`; contains IP, user agent, and agreement text. |
| `epdg.opportunities` | Snapshot; **U** | — | Company-owned behavior is not proven | R open opportunities | — | C/R/U through admin API | Inherits guarded admin API | Yes, mediated | Optional `company_id`; admin `posted_by`; dual ownership needs a decision. |
| `epdg.opportunity_applications` | Snapshot; **U** | — | Company review is not proven | C/R by `intern_id → intern_profiles` | — | R/U review via admin API | Inherits guarded admin API | Yes, mediated | Profile ownership is proven; reviewer is actor attribution. |
| `epdg.placements` | Snapshot; **U** | — | Company/school visibility is a Decision | R indirectly through intern profile | `mentor_id` exists; profile-vs-placement authority unresolved | C/R/U/D through admin workflows | Inherits guarded admin API | Yes, mediated | Multiple participant FKs; no single canonical mentor assignment chosen. |
| `epdg.platform_settings` | Snapshot; **U** | — | — | — | — | R through admin API | U through super-admin guard | **Only** | Key/value global state; no row owner and no branch column. |
| `epdg.point_events` | Snapshot; **U** | — | — | R own points/rank | — | C/R award flows | Inherits guarded admin API | Yes, mediated | `user_id → users`; `awarded_by` is actor attribution. |
| `epdg.readiness_score_history` | Snapshot; **U** | — | — | R through owned career file | Decision | R analytics | Inherits guarded admin API | Yes, mediated | `career_file_id → career_files`; no independent public flag. |
| `epdg.resources` | Snapshot; **U** | Issue #18 public-read group only; priority table unchecked | — | R intent in intern API | — | C/R/U/D intent | D through super-admin guard | Yes, mediated | Snapshot uses `uploaded_by/category`; migration/code use `created_by/owner/status`. Reconcile first. |
| `epdg.roadmap_modules` | Snapshot; **U** | — | — | R for enrolled track | Sign-off context | R roadmap flows | Decision | Yes, mediated | Shared track content; no publication/author field. |
| `epdg.roadmap_weeks` | Snapshot; **U** | — | — | R legacy roadmap | — | Decision | Decision | Yes, mediated | Shared curriculum; no publication/author field. |
| `epdg.schools` | Snapshot; **U** | — | R own profile via account API | Limited school association only | — | R/U approval flows | Inherits guarded admin API | Yes, mediated | `user_id → users`; school-to-intern visibility is unspecified. |
| `epdg.submissions` | Snapshot; **U** | — | — | R is proven; C/U delivery routes are unavailable | Reviewer semantics are a Decision | R/review intent | Inherits guarded admin API | Yes, mediated | Direct `intern_id` plus placement/task links; Issue #18 priority remains unchecked. |
| `epdg.tasks` | Snapshot; **U** | — | — | R/U only through owned placement | `assigned_by` does not itself prove assigned-mentor scope | C/R/U intent | Inherits guarded admin API | Yes, mediated | Indirect owner via placement; task assigner may be any user FK. |
| `epdg.tracks` | Snapshot; **U** | — | — | R during roadmap | R context | Seed/system management | Decision | Yes, mediated | Shared lookup; no publication/author field. |
| `epdg.users` | Snapshot; **U** | — | R/U own auth/account data via API | R/U own | R/U own | R/U administration | C/R/U/D guarded user management | Yes | Integer identity mirror; no `auth.users` UUID link; contains password hashes/tokens. |
| `agency.clients` | Review migration; **P** | C only through feature-flagged validated backend intake | — | — | — | No management route proven | Decision | **Only** | Anonymous prospect record has no authenticated owner by design. |
| `agency.booking_inquiries` | Review migration; **P** | C only through feature-flagged backend intake | — | — | — | No management route proven | Decision | **Only** | `client_id → agency.clients`; raw messages/contact data are private. |
| `agency.compliance_acknowledgements` | Review migration; **P** | C only through backend intake | — | — | — | No management route proven | Decision | **Only** | `client_id → agency.clients`; IP and user-agent fields are sensitive. |
<!-- TABLE_MAP_END -->

## Uniform direct Data API disposition

No tracked SQL grants access to `anon` or `authenticated`, no tracked SQL creates a policy, and the project dashboard's exposed-schema list is not versioned. Therefore no row above is approved for direct Data API access. The review-only draft enables RLS where the known table exists and removes only direct ACL entries from those two roles; it creates no allow policy. That operation does not remove privileges granted to `PUBLIC` or inherited roles, change default privileges, or make callable routines safe. Effective denial remains unproven until full catalog review, `has_*_privilege` assertions, and Data API/RPC probes pass in a disposable environment.

An eventual `UPDATE` policy must have a matching `SELECT` policy and both `USING` and `WITH CHECK` predicates. A role target such as `TO authenticated` is only authentication, not row authorization. No future policy may use `auth.role()`, user-editable metadata, an unreviewed top-level JWT claim, or a `SECURITY DEFINER` shortcut.

## Issue #18 state is not policy evidence

As of August 8, Issue #18 shows these policy-group boxes checked: public-read; intern self-access for profile/progress/submissions/certificates/notifications/saved resources; admin/founder access; backend/service-only audit/role/sensitive actions; and deny-by-default private intern records. It also shows these priority tables checked: `epdg.users`, `epdg.intern_profiles`, `epdg.admins`, `epdg.intern_roadmap_progress`, and `epdg.module_completions`.

The repository contains no corresponding `CREATE POLICY` statements or authenticated catalog export, so those checked boxes are historical issue state, not verified implementation. The issue still leaves `epdg.applications`, `announcements`, `resources`, `tasks`, `submissions`, `certificates`, `certificate_templates`, `onboarding_agreements`, `platform_settings`, and `audit_log` unchecked. All acceptance items also remain unchecked. Keep Issue #18 open.

## Scope decisions outside the 43 tracked rows

- `public.messages`, `public.notifications`, `public.rooms`, and `public.sessions` appear in Issue #18 but not in tracked DDL or the schema snapshot. Confirm whether they exist before adding them to a policy map.
- `public.migrations` is mentioned by historical migration comments, but its DDL and current existence are untracked. Treat it as an internal backend-only object and verify it separately.
- Supabase-managed `auth`, `storage`, and other provider schemas are outside the versioned application-table inventory. Storage bucket/policy review remains a dashboard/catalog task.
