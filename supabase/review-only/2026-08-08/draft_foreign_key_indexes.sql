-- ============================================================================
-- DRAFT / REVIEW ONLY / DO NOT APPLY
-- Static design date: 2026-08-08
-- This file is intentionally outside every automatic migration directory.
-- It has not been executed against any database.
-- ============================================================================
--
-- Source: FK and index definitions in epdg-backend-core/SCHEMA_REFERENCE.sql,
-- generated 2026-07-02. Re-export the target catalog and run Performance
-- Advisor before approval. The tracked migration history has known shape drift.
--
-- CREATE INDEX CONCURRENTLY cannot run inside a transaction. Apply one statement
-- at a time only in an approved non-production environment, inspect progress and
-- invalid indexes after each statement, then repeat workload measurements.

create index concurrently if not exists idx_announcements_created_by
  on epdg.announcements (created_by);

create index concurrently if not exists idx_badge_awards_awarded_by
  on epdg.badge_awards (awarded_by);
create index concurrently if not exists idx_badge_awards_badge_id
  on epdg.badge_awards (badge_id);
create index concurrently if not exists idx_badge_awards_user_id
  on epdg.badge_awards (user_id);

create index concurrently if not exists idx_career_experiences_career_file_id
  on epdg.career_experiences (career_file_id);
create index concurrently if not exists idx_career_skills_endorsed_by
  on epdg.career_skills (endorsed_by);

create index concurrently if not exists idx_certificates_intern_id
  on epdg.certificates (intern_id);
create index concurrently if not exists idx_certificates_issued_by
  on epdg.certificates (issued_by);
create index concurrently if not exists idx_certificates_template_id
  on epdg.certificates (template_id);

create index concurrently if not exists idx_feedback_given_by
  on epdg.feedback (given_by);
create index concurrently if not exists idx_feedback_target_user_id
  on epdg.feedback (target_user_id);

create index concurrently if not exists idx_intern_level_progress_track_id
  on epdg.intern_level_progress (track_id);
create index concurrently if not exists idx_intern_profiles_approved_by
  on epdg.intern_profiles (approved_by);
create index concurrently if not exists idx_intern_profiles_mentor_id
  on epdg.intern_profiles (mentor_id);
create index concurrently if not exists idx_intern_roadmap_progress_week_id
  on epdg.intern_roadmap_progress (week_id);
create index concurrently if not exists idx_internship_slots_created_by
  on epdg.internship_slots (created_by);

create index concurrently if not exists idx_module_completions_mentor_id
  on epdg.module_completions (mentor_id);
create index concurrently if not exists idx_module_completions_module_id
  on epdg.module_completions (module_id);

create index concurrently if not exists idx_opportunities_company_id
  on epdg.opportunities (company_id);
create index concurrently if not exists idx_opportunities_posted_by
  on epdg.opportunities (posted_by);
create index concurrently if not exists idx_opportunity_applications_reviewed_by
  on epdg.opportunity_applications (reviewed_by);

create index concurrently if not exists idx_point_events_awarded_by
  on epdg.point_events (awarded_by);
create index concurrently if not exists idx_point_events_user_id
  on epdg.point_events (user_id);
create index concurrently if not exists idx_resources_uploaded_by
  on epdg.resources (uploaded_by);
