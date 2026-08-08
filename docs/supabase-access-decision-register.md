# Supabase ownership gaps and decision register

> All decisions are open for founder/technical review. “Fail closed” is a temporary safety posture, not a claim that business behavior has been approved.

## Ownership-column gaps

A missing owner is not automatically a schema defect: system catalogs, audit records, and settings may correctly be backend-only. It becomes a blocker when direct participant or public access is desired.

| Table(s) | What exists | Missing or ambiguous evidence | Safe interim disposition |
|---|---|---|---|
| `core.users`, `epdg.users` | Mirrored integer IDs and application JWT authentication | No immutable mapping to `auth.users.id`; no reviewed database request claim | Backend only; do not write `auth.uid()` or ad-hoc claim policies. |
| `core.user_branch_roles` | User + branch + role rows | Same missing request identity; no claim freshness/revocation contract | Backend only. |
| `core.branches` | Branch code/name | No owner needed for backend lookup; no public/participant rule or tenant policy defined | Backend-only lookup. |
| `epdg.admins` | `user_id`, `admin_role`, `is_mentor`, `admin_type` | No team-lead role/assignment; “founder” is not a schema value | Backend guards only. |
| `epdg.announcements` | `created_by`, string `audience` | No recipient membership relation; migration/service column drift | Do not derive a Data API audience policy. |
| `epdg.badges` | Shared badge catalog | No publication flag/author; direct public/authenticated visibility unapproved | Backend projection only. |
| `epdg.certificate_templates` | Shared templates | No author/owner/public flag | Administrator backend only. |
| `epdg.platform_settings` | Global key/value rows | No branch/owner column; no row-level founder marker | Super-admin backend update only. |
| `epdg.tracks`, `epdg.roadmap_modules`, `epdg.roadmap_weeks` | Shared curriculum keys | No publication state, branch scope, or author | Backend-mediated participant reads only. |
| `epdg.resources` | Snapshot has `uploaded_by`; historical migration/service use `created_by/owner/status` | Canonical ownership and publication columns are unresolved | Reconcile DDL before policy design. |
| `epdg.feedback` | Snapshot has `given_by`, `target_user_id`, `placement_id` | Historical migration/service expect incompatible sender/role/status columns | Reconcile DDL before policy design. |
| `epdg.tasks` | `assigned_by`, `placement_id` | `assigned_by` is actor, not assignee; intern ownership is only through placement | Use backend placement predicate; no direct policy yet. |
| `epdg.milestones` | `placement_id`, optional `completed_by` | No explicit row owner/updater role | Use backend placement predicate; decide who may complete. |
| `epdg.module_completions` | Intern profile + optional signing mentor | `mentor_id` records signer; current sign-off method does not prove assignment | Do not equate signer with assigned mentor. |
| `epdg.internship_slots` | Optional `company_id`, optional `created_by` | Company-owned and admin-created rows need different rules; company APIs are absent | Administrator backend only for writes. |
| `epdg.opportunities` | Optional `company_id`, optional `posted_by` | Company-owned and admin-posted rows need different rules; company APIs are absent | Administrator backend only for writes. |
| `epdg.placements`, `epdg.mentor_sessions` | Mentor IDs plus placement/profile links | `intern_profiles.mentor_id`, `placements.mentor_id`, and session mentor can diverge | Decide canonical assignment and enforce consistency first. |
| `agency.clients`, `agency.booking_inquiries`, `agency.compliance_acknowledgements` | Anonymous intake chain by `client_id` | No authenticated owner by design; no administrator management route/retention owner | Anonymous writes only through validated backend; raw rows private. |
| `public.migrations` | Mentioned by historical migration comments | No tracked DDL, owner, RLS, grant, or current existence evidence | Treat as internal; catalog-verify separately. |
| Issue-only `public.messages`, `public.notifications`, `public.rooms`, `public.sessions` | Names in Issue #18 | No tracked table contract at all | Do not invent policies or map rows; confirm existence first. |

## Decision register

| ID | Decision required | Evidence and risk | Options that require approval | Default until decided | Owner / status |
|---|---|---|---|---|---|
| DR-01 | Will browser clients use the Data API for application tables? | Current architecture and docs use backend Postgres; direct access changes the trust boundary. | Backend-only; selected security-invoker projections; full client access with reviewed policies. | Data API denied for app tables. | Founder + technical lead / **Open** |
| DR-02 | What immutable database identity represents the current application user? | Express verifies a custom HS256 token with integer `id`; schema has no `auth.users` UUID link. | Migrate to Supabase Auth UUID; add reviewed immutable mapping; keep DB behind backend. | No participant RLS policy. | Security/identity owner / **Open, blocking** |
| DR-03 | Which schemas are exposed through the Data API? | Dashboard setting is not versioned; `public` defaults cannot establish `core`, `epdg`, or `agency`. | Disable Data API; expose a dedicated API schema; expose selected existing schemas. | Assume none are approved. | Supabase project owner / **Open, dashboard-only** |
| DR-04 | What are the actual object and default grants? | Zero tracked `GRANT`/`REVOKE`; Supabase defaults have changed over time. | Adopt explicit opt-in grants after catalog export. | No grant inferred. | DBA / **Open, catalog export required** |
| DR-05 | What role does the Railway backend connect as, and does it own tables or bypass RLS? | Enabling RLS may block a non-owner; owners normally bypass unless forced; runtime role is untracked. | Dedicated least-privilege runtime role; owner role; forced RLS with compatible policies. | Draft is not runtime-compatible evidence. | Railway/Supabase owners / **Open, blocking** |
| DR-06 | Is `super_admin` the approved founder-equivalent? | Code guards `admin_role === 'super_admin'`; no `founder` value exists. | Treat super-admin as founder gate; add a distinct immutable role; retain founder approval outside DB. | Document as “founder/super-admin” but do not invent mapping. | Founder / **Open** |
| DR-07 | How is a team lead represented and assigned? | No team-lead role/table exists. `admin_type` and mentor flags are insufficient proof. | Add reviewed role/assignment relation; define team lead as a constrained admin type. | No team-lead access. | Founder + program owner / **Open** |
| DR-08 | Which mentor relation is canonical? | Profile, placement, and session mentor IDs can diverge; some roadmap sign-off code lacks an assignment predicate. | Profile mentor; placement mentor; explicit assignment history table with validity dates. | Only backend methods with an explicit `ip.mentor_id = caller` check count as proven. | Program owner / **Open, blocking mentor policies** |
| DR-09 | Should company and school participants directly access owned rows? | Ownership roots exist, but current routes do not implement company/school workflows. | Backend APIs only; direct Data API after identity/policy work. | No direct access. | Product owner / **Open** |
| DR-10 | What is the canonical schema for announcements, feedback, and resources? | Snapshot, historical migrations, and services conflict. Policy columns cannot be chosen safely. | Forward reconciliation migration after data-shape assessment. | No policy or index application on unresolved columns. | DBA + backend owner / **Open, blocking** |
| DR-11 | How should public career data be exposed? | Backend deliberately selects columns and checks `is_public`, approved profile, and active user. Raw tables include more data. | Keep backend projection; create reviewed security-invoker view + column grants; direct raw table access (not recommended). | Backend projection only. | Privacy/product owners / **Open** |
| DR-12 | How should public certificate verification be exposed? | Backend returns a limited active-certificate projection; raw table includes URL/hash/internal IDs. | Keep backend projection; reviewed view/RPC with least columns. | Backend projection only. | Privacy/product owners / **Open** |
| DR-13 | May anonymous Agency intake ever write directly through Data API? | Current route validates, feature-gates, and writes three related private records. Tables contain contact/IP/user-agent data. | Backend only; reviewed RPC with rate limits; direct insert policies (high risk). | Backend only. | Agency/privacy owner / **Open** |
| DR-14 | Are the Agency review tables already applied, and is `supabase/migrations/` automated? | The file says review-only but occupies a conventional migration path; no history export exists. | Move only in a separately reviewed governance change; document runner behavior. | Treat existence/application as unknown. | Repository + Supabase owners / **Open** |
| DR-15 | What is the public/shared lookup publication model? | Tracks, modules, weeks, badges, templates lack publication flags. | Backend projection; explicit `is_published`; dedicated read-only view. | No direct table reads. | Product owner / **Open** |
| DR-16 | Should RLS be forced for table owners? | `ENABLE RLS` alone does not constrain owners; forcing may break backend operations. | Dedicated non-owner runtime role; `FORCE ROW LEVEL SECURITY` after synthetic verification. | Do not force in draft. | DBA / **Open** |
| DR-17 | What is the approved default-privilege policy for future objects? | Opt-in grants are safer, but the object-owning migration role is unknown. | `ALTER DEFAULT PRIVILEGES FOR ROLE <owner>` after owner identification. | No default-privilege SQL in draft. | DBA / **Open** |
| DR-18 | Do any Edge Functions or RPCs depend on current schema/function grants? | The draft function revocation is intentionally broad; consumers are untracked here. | Inventory and explicitly re-grant approved RPCs. | Do not trial revokes without captured grants and consumer inventory. | Supabase/Edge owner / **Open, blocking** |
| DR-19 | What Storage bucket policies and key boundaries apply? | Server code creates/uses CV, submission, and certificate storage; database-table review does not cover `storage.objects`. | Private buckets + signed URLs; explicit storage policies; prohibit browser privileged key. | Keep privileged credentials server-side; no live role test. | Storage/security owner / **Open** |
| DR-20 | Are the 24 FK indexes useful and safe for the actual workload? | Static snapshot proves missing leading-column coverage, not query benefit; catalog may have changed. | Advisor/plan validation; staged concurrent creation; reject redundant indexes. | Draft only. | DBA / **Open** |
| DR-21 | What are the exact live RLS/policy states for every table? | Prior audit names only seven disabled tables and summarizes others. | Authenticated `pg_class`, `pg_policies`, grants export + Security Advisor. | Mark unknown table by table. | Supabase owner / **Open, dashboard/catalog** |
| DR-22 | Do issue-only messaging/session tables exist? | Issue #18 names four `public` tables absent from all tracked contracts. | Add catalog evidence and a separate reviewed map if present. | Out of tracked-table count. | Supabase owner / **Open** |

## Policy design gate

No participant, mentor, administrator, or founder policy is ready until DR-02 is resolved. Once it is, policy tests must use synthetic accounts and prove both allowed and denied cross-user cases. An update test must also prove the matching select rule, `USING`, and `WITH CHECK`; testing only a successful own-row update is insufficient.
