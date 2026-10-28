-- LOCAL SYNTHETIC BASELINE ONLY. Catalog definitions, never production rows or sequence values.
-- Source: metadata-only inspection 2026-10-20, PostgreSQL 17; backend 7bfdb114.
SET search_path = public;
CREATE SCHEMA IF NOT EXISTS core;
CREATE SCHEMA IF NOT EXISTS epdg;
CREATE SCHEMA IF NOT EXISTS private;
CREATE TYPE "core"."admin_role" AS ENUM ('admin', 'super_admin');
CREATE TYPE "core"."user_role" AS ENUM ('admin', 'company', 'intern', 'school');
CREATE TYPE "epdg"."admin_role" AS ENUM ('admin', 'super_admin');
CREATE TYPE "epdg"."application_status" AS ENUM ('pending', 'shortlisted', 'accepted', 'rejected');
CREATE TYPE "epdg"."internship_slot_status" AS ENUM ('draft', 'open', 'closed', 'filled');
CREATE TYPE "epdg"."placement_status" AS ENUM ('active', 'completed', 'terminated', 'on_hold');
CREATE TYPE "epdg"."school_type" AS ENUM ('university', 'college', 'polytechnic', 'tvet');
CREATE TYPE "epdg"."submission_status" AS ENUM ('submitted', 'under_review', 'approved', 'rejected');
CREATE TYPE "epdg"."task_priority" AS ENUM ('low', 'normal', 'urgent');
CREATE TYPE "epdg"."task_status" AS ENUM ('pending', 'in_progress', 'review', 'done');
CREATE TYPE "epdg"."user_role" AS ENUM ('admin', 'company', 'intern', 'school');
CREATE TYPE "public"."agency_service" AS ENUM ('Tax', 'Insurance', 'Tax & Insurance');
CREATE TYPE "public"."application_status_enum" AS ENUM ('draft', 'submitted', 'under_review', 'accepted', 'rejected');
CREATE TYPE "public"."email_status_enum" AS ENUM ('pending', 'sent', 'failed', 'bounced');
CREATE TYPE "public"."enrollment_status_enum" AS ENUM ('pending', 'active', 'completed', 'cancelled');
CREATE TYPE "public"."inquiry_status_enum" AS ENUM ('new', 'read', 'replied', 'closed');
CREATE TYPE "public"."inquiry_type_enum" AS ENUM ('contact', 'intern', 'partner', 'program');
CREATE TYPE "public"."job_status_enum" AS ENUM ('pending', 'running', 'completed', 'failed', 'cancelled');
CREATE TYPE "public"."job_type_enum" AS ENUM ('email', 'certificate_generation', 'report', 'data_export', 'notification');
CREATE TYPE "public"."professional_service" AS ENUM ('Web Development', 'Sales', 'Digital Marketing', 'Leadership');
CREATE TYPE "public"."program_type_enum" AS ENUM ('internship', 'career_readiness', 'training');
CREATE TYPE "public"."track_enum" AS ENUM ('web_development', 'digital_marketing', 'sales', 'business_operations');
CREATE TYPE "public"."urgency_type" AS ENUM ('Urgent', 'Normal', 'Not Sure');
CREATE TYPE "public"."user_role_enum" AS ENUM ('intern', 'partner', 'admin');
CREATE SEQUENCE "core"."branches_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "core"."user_branch_roles_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "core"."users_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."admins_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."announcements_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."applications_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."audit_log_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."badge_awards_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."badges_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."career_experiences_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."career_files_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."career_projects_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."career_skills_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."certificate_templates_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."companies_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."feedback_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."intern_level_progress_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."intern_profiles_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."intern_roadmap_progress_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."intern_skills_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."internship_slots_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."mentor_sessions_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."milestones_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."module_completions_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."onboarding_agreements_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."opportunities_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."opportunity_applications_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."placements_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."point_events_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."readiness_score_history_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."resources_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."roadmap_modules_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."roadmap_weeks_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."schools_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."submissions_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."tasks_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."tracks_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."users_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "public"."leaderboard_points_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "public"."messages_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "public"."notifications_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "public"."resource_saves_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "public"."room_members_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "public"."rooms_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "public"."sessions_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE TABLE "core"."branches" (
  "id" integer DEFAULT nextval('core.branches_id_seq'::regclass) NOT NULL,
  "code" character varying(30) NOT NULL,
  "name" character varying(100) NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "core"."user_branch_roles" (
  "id" integer DEFAULT nextval('core.user_branch_roles_id_seq'::regclass) NOT NULL,
  "user_id" integer NOT NULL,
  "branch_id" integer NOT NULL,
  "role_name" core.user_role NOT NULL,
  "admin_role" core.admin_role,
  "rejection_reason" text,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "core"."users" (
  "id" integer DEFAULT nextval('core.users_id_seq'::regclass) NOT NULL,
  "email" character varying(150) NOT NULL,
  "name" character varying(100) NOT NULL,
  "password" character varying(255) NOT NULL,
  "is_verified" boolean DEFAULT false,
  "verification_token" character varying(255),
  "token_expires_at" timestamp without time zone,
  "last_login_at" timestamp without time zone,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" timestamp without time zone
);
CREATE TABLE "epdg"."admins" (
  "id" integer DEFAULT nextval('epdg.admins_id_seq'::regclass) NOT NULL,
  "user_id" integer NOT NULL,
  "admin_role" epdg.admin_role DEFAULT 'admin'::epdg.admin_role NOT NULL,
  "is_mentor" boolean DEFAULT false,
  "department" character varying(100),
  "permissions" jsonb,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP,
  "max_capacity" integer DEFAULT 3,
  "force_password_change" boolean DEFAULT false,
  "admin_type" character varying(30) DEFAULT 'general'::character varying NOT NULL
);
CREATE TABLE "epdg"."announcements" (
  "id" integer DEFAULT nextval('epdg.announcements_id_seq'::regclass) NOT NULL,
  "title" character varying(200) NOT NULL,
  "body" text NOT NULL,
  "audience" character varying(20) DEFAULT 'all'::character varying NOT NULL,
  "created_by" integer,
  "created_at" timestamp without time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp without time zone
);
CREATE TABLE "epdg"."applications" (
  "id" integer DEFAULT nextval('epdg.applications_id_seq'::regclass) NOT NULL,
  "intern_id" integer NOT NULL,
  "slot_id" integer NOT NULL,
  "cover_letter" text,
  "status" epdg.application_status DEFAULT 'pending'::epdg.application_status,
  "company_notes" text,
  "applied_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" timestamp with time zone,
  "reviewed_by" integer,
  "extracted_skills" jsonb,
  "cv_text_snapshot" text
);
CREATE TABLE "epdg"."audit_log" (
  "id" integer DEFAULT nextval('epdg.audit_log_id_seq'::regclass) NOT NULL,
  "admin_id" integer,
  "action" character varying(100) NOT NULL,
  "target_type" character varying(50),
  "target_id" character varying(100),
  "metadata" jsonb,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "epdg"."badge_awards" (
  "id" integer DEFAULT nextval('epdg.badge_awards_id_seq'::regclass) NOT NULL,
  "badge_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "awarded_by" integer,
  "awarded_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "epdg"."badges" (
  "id" integer DEFAULT nextval('epdg.badges_id_seq'::regclass) NOT NULL,
  "name" character varying(100) NOT NULL,
  "emoji" character varying(10) NOT NULL,
  "description" text,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "epdg"."career_experiences" (
  "id" integer DEFAULT nextval('epdg.career_experiences_id_seq'::regclass) NOT NULL,
  "career_file_id" integer NOT NULL,
  "title" character varying(255) NOT NULL,
  "organization" character varying(255),
  "start_date" date,
  "end_date" date,
  "is_current" boolean DEFAULT false NOT NULL,
  "description" text,
  "source" character varying(20) DEFAULT 'manual'::character varying NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "epdg"."career_files" (
  "id" integer DEFAULT nextval('epdg.career_files_id_seq'::regclass) NOT NULL,
  "intern_profile_id" integer NOT NULL,
  "slug" character varying(120),
  "headline" character varying(255),
  "summary" text,
  "readiness_score" integer DEFAULT 0 NOT NULL,
  "readiness_tier" character varying(30) DEFAULT 'not_ready'::character varying NOT NULL,
  "mentor_approved_tier" boolean DEFAULT false NOT NULL,
  "is_public" boolean DEFAULT false NOT NULL,
  "last_auto_populated_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "epdg"."career_projects" (
  "id" integer DEFAULT nextval('epdg.career_projects_id_seq'::regclass) NOT NULL,
  "career_file_id" integer NOT NULL,
  "title" character varying(255) NOT NULL,
  "description" text,
  "technologies" text[] DEFAULT '{}'::text[],
  "url" text,
  "source" character varying(30) DEFAULT 'manual'::character varying NOT NULL,
  "source_ref_id" integer,
  "verified" boolean DEFAULT false NOT NULL,
  "mentor_signed" boolean DEFAULT false NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "epdg"."career_skills" (
  "id" integer DEFAULT nextval('epdg.career_skills_id_seq'::regclass) NOT NULL,
  "career_file_id" integer NOT NULL,
  "skill_name" character varying(100) NOT NULL,
  "category" character varying(50),
  "source" character varying(30) DEFAULT 'self_reported'::character varying NOT NULL,
  "proficiency" character varying(20) DEFAULT 'beginner'::character varying NOT NULL,
  "endorsed_by" integer,
  "endorsed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "epdg"."certificate_templates" (
  "id" integer DEFAULT nextval('epdg.certificate_templates_id_seq'::regclass) NOT NULL,
  "name" character varying(100) NOT NULL,
  "department" character varying(100),
  "background_image_url" text,
  "field_positions" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "epdg"."certificates" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "certificate_number" character varying(50) NOT NULL,
  "intern_id" integer NOT NULL,
  "intern_name_snapshot" character varying(200) NOT NULL,
  "department_snapshot" character varying(100),
  "program_name" character varying(200) NOT NULL,
  "issue_date" date DEFAULT CURRENT_DATE NOT NULL,
  "issued_by" integer NOT NULL,
  "template_id" integer,
  "pdf_url" text,
  "integrity_hash" character varying(64) NOT NULL,
  "status" character varying(20) DEFAULT 'active'::character varying NOT NULL,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "epdg"."companies" (
  "id" integer DEFAULT nextval('epdg.companies_id_seq'::regclass) NOT NULL,
  "user_id" integer NOT NULL,
  "company_name" character varying(150) NOT NULL,
  "email" character varying(150),
  "country" character varying(100),
  "county" character varying(100),
  "industry" character varying(100),
  "number_of_employees" integer,
  "registration_number" character varying(100),
  "website" character varying(255),
  "logo_url" character varying(500),
  "description" text,
  "contact_person" character varying(100),
  "contact_phone" character varying(20),
  "is_verified" boolean DEFAULT false,
  "is_approved" boolean DEFAULT false,
  "approved_at" timestamp with time zone,
  "approved_by" integer,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" timestamp with time zone
);
CREATE TABLE "epdg"."feedback" (
  "id" integer DEFAULT nextval('epdg.feedback_id_seq'::regclass) NOT NULL,
  "placement_id" integer NOT NULL,
  "given_by" integer NOT NULL,
  "type" character varying(30) NOT NULL,
  "rating" smallint NOT NULL,
  "comment" text,
  "is_anonymous" boolean DEFAULT false,
  "week_number" integer,
  "created_at" timestamp with time zone DEFAULT now(),
  "target_user_id" integer
);
CREATE TABLE "epdg"."intern_level_progress" (
  "id" integer DEFAULT nextval('epdg.intern_level_progress_id_seq'::regclass) NOT NULL,
  "intern_id" integer NOT NULL,
  "track_id" integer NOT NULL,
  "current_level" character varying(20) DEFAULT 'beginner'::character varying NOT NULL,
  "level_started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "level_up_requested_at" timestamp with time zone
);
CREATE TABLE "epdg"."intern_profiles" (
  "id" integer DEFAULT nextval('epdg.intern_profiles_id_seq'::regclass) NOT NULL,
  "user_id" integer NOT NULL,
  "school_id" integer,
  "course" character varying(150),
  "year_of_study" smallint,
  "cv_url" character varying(500),
  "skills" jsonb,
  "bio" text,
  "availability_start" date,
  "availability_end" date,
  "nda_signed" boolean DEFAULT false,
  "disclaimer_accepted" boolean DEFAULT false,
  "onboarding_complete" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  "is_approved" boolean DEFAULT false NOT NULL,
  "approved_at" timestamp with time zone,
  "approved_by" integer,
  "rejection_reason" text,
  "contact_phone" character varying(20),
  "department" character varying(100),
  "mentor_name" character varying(100),
  "track" character varying(100),
  "onboarding_step" integer DEFAULT 1 NOT NULL,
  "profile_photo" character varying(500),
  "linkedin_url" character varying(500),
  "github_url" character varying(500),
  "portfolio_url" character varying(500),
  "country" character varying(100),
  "city" character varying(100),
  "cover_letter" text,
  "onboarding_status" character varying(30) DEFAULT 'pending_approval'::character varying NOT NULL,
  "mentor_id" integer,
  "track_confirmed_at" timestamp with time zone,
  "discovery_problem" text
);
CREATE TABLE "epdg"."intern_roadmap_progress" (
  "id" integer DEFAULT nextval('epdg.intern_roadmap_progress_id_seq'::regclass) NOT NULL,
  "intern_id" integer NOT NULL,
  "week_id" integer NOT NULL,
  "status" character varying(20) DEFAULT 'locked'::character varying NOT NULL,
  "completed_at" timestamp without time zone
);
CREATE TABLE "epdg"."intern_skills" (
  "id" integer DEFAULT nextval('epdg.intern_skills_id_seq'::regclass) NOT NULL,
  "intern_id" integer NOT NULL,
  "skill_name" character varying(100) NOT NULL,
  "proficiency" smallint DEFAULT 0 NOT NULL,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "epdg"."internship_slots" (
  "id" integer DEFAULT nextval('epdg.internship_slots_id_seq'::regclass) NOT NULL,
  "company_id" integer,
  "title" character varying(200) NOT NULL,
  "department" character varying(100),
  "description" text,
  "requirements" text,
  "skills_required" jsonb,
  "slots_available" integer DEFAULT 1,
  "slots_filled" integer DEFAULT 0,
  "duration_weeks" integer,
  "stipend" numeric(10,2),
  "is_remote" boolean DEFAULT false,
  "county" character varying(100),
  "deadline" date,
  "status" epdg.internship_slot_status DEFAULT 'draft'::epdg.internship_slot_status,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" timestamp with time zone,
  "created_by" integer
);
CREATE TABLE "epdg"."mentor_sessions" (
  "id" integer DEFAULT nextval('epdg.mentor_sessions_id_seq'::regclass) NOT NULL,
  "placement_id" integer NOT NULL,
  "mentor_id" integer NOT NULL,
  "intern_id" integer NOT NULL,
  "scheduled_at" timestamp without time zone NOT NULL,
  "status" character varying(20) DEFAULT 'pending'::character varying NOT NULL,
  "notes" text,
  "intern_rating" smallint,
  "mentor_notes" text,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "epdg"."milestones" (
  "id" integer DEFAULT nextval('epdg.milestones_id_seq'::regclass) NOT NULL,
  "placement_id" integer NOT NULL,
  "title" character varying(200) NOT NULL,
  "description" text,
  "due_week" integer NOT NULL,
  "is_completed" boolean DEFAULT false,
  "completed_by" integer,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "epdg"."module_completions" (
  "id" integer DEFAULT nextval('epdg.module_completions_id_seq'::regclass) NOT NULL,
  "intern_id" integer NOT NULL,
  "module_id" integer NOT NULL,
  "completed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "mentor_signed" boolean DEFAULT false NOT NULL,
  "mentor_id" integer,
  "mentor_signed_at" timestamp with time zone,
  "artifact_url" text,
  "notes" text
);
CREATE TABLE "epdg"."onboarding_agreements" (
  "id" integer DEFAULT nextval('epdg.onboarding_agreements_id_seq'::regclass) NOT NULL,
  "intern_id" integer NOT NULL,
  "agreement_type" character varying(30) NOT NULL,
  "agreed_at" timestamp with time zone DEFAULT now() NOT NULL,
  "ip_address" character varying(45),
  "user_agent" text,
  "agreement_text" text NOT NULL
);
CREATE TABLE "epdg"."opportunities" (
  "id" integer DEFAULT nextval('epdg.opportunities_id_seq'::regclass) NOT NULL,
  "type" character varying(10) DEFAULT 'gig'::character varying NOT NULL,
  "title" character varying(200) NOT NULL,
  "company_id" integer,
  "department" character varying(100),
  "description" text,
  "requirements" text,
  "skills_required" jsonb,
  "compensation" character varying(100),
  "duration" character varying(100),
  "is_remote" boolean DEFAULT false NOT NULL,
  "county" character varying(100),
  "deadline" date,
  "status" character varying(20) DEFAULT 'open'::character varying NOT NULL,
  "posted_by" integer,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "deleted_at" timestamp with time zone
);
CREATE TABLE "epdg"."opportunity_applications" (
  "id" integer DEFAULT nextval('epdg.opportunity_applications_id_seq'::regclass) NOT NULL,
  "intern_id" integer NOT NULL,
  "opportunity_id" integer NOT NULL,
  "cover_letter" text,
  "status" character varying(20) DEFAULT 'pending'::character varying NOT NULL,
  "applied_at" timestamp with time zone DEFAULT now() NOT NULL,
  "reviewed_at" timestamp with time zone,
  "reviewed_by" integer
);
CREATE TABLE "epdg"."placements" (
  "id" integer DEFAULT nextval('epdg.placements_id_seq'::regclass) NOT NULL,
  "application_id" integer NOT NULL,
  "intern_id" integer NOT NULL,
  "company_id" integer NOT NULL,
  "school_id" integer,
  "slot_id" integer NOT NULL,
  "mentor_id" integer,
  "start_date" date NOT NULL,
  "end_date" date NOT NULL,
  "status" epdg.placement_status DEFAULT 'active'::epdg.placement_status,
  "termination_reason" text,
  "completed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "epdg"."platform_settings" (
  "key" character varying(100) NOT NULL,
  "value" text NOT NULL,
  "updated_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "epdg"."point_events" (
  "id" integer DEFAULT nextval('epdg.point_events_id_seq'::regclass) NOT NULL,
  "user_id" integer NOT NULL,
  "action" character varying(200) NOT NULL,
  "points" integer NOT NULL,
  "awarded_by" integer,
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "epdg"."readiness_score_history" (
  "id" integer DEFAULT nextval('epdg.readiness_score_history_id_seq'::regclass) NOT NULL,
  "career_file_id" integer NOT NULL,
  "score" integer NOT NULL,
  "tier" character varying(30) NOT NULL,
  "breakdown" jsonb,
  "snapshot_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "epdg"."resources" (
  "id" integer DEFAULT nextval('epdg.resources_id_seq'::regclass) NOT NULL,
  "title" character varying(200) NOT NULL,
  "type" character varying(30) NOT NULL,
  "category" character varying(100),
  "url" character varying(500) NOT NULL,
  "description" text,
  "thumbnail_url" character varying(500),
  "is_featured" boolean DEFAULT false,
  "views" integer DEFAULT 0,
  "saves" integer DEFAULT 0,
  "uploaded_by" integer NOT NULL,
  "created_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
CREATE TABLE "epdg"."roadmap_modules" (
  "id" integer DEFAULT nextval('epdg.roadmap_modules_id_seq'::regclass) NOT NULL,
  "track_id" integer NOT NULL,
  "level" character varying(20) NOT NULL,
  "order_index" integer NOT NULL,
  "title" character varying(200) NOT NULL,
  "objective" text NOT NULL,
  "artifact" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "epdg"."roadmap_weeks" (
  "id" integer DEFAULT nextval('epdg.roadmap_weeks_id_seq'::regclass) NOT NULL,
  "week_number" smallint NOT NULL,
  "title" character varying(200) NOT NULL,
  "description" text,
  "skills" text[] DEFAULT '{}'::text[],
  "created_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "epdg"."schools" (
  "id" integer DEFAULT nextval('epdg.schools_id_seq'::regclass) NOT NULL,
  "user_id" integer NOT NULL,
  "school_name" character varying(150) NOT NULL,
  "email" character varying(150),
  "school_type" epdg.school_type,
  "county" character varying(100),
  "address" text,
  "website" character varying(255),
  "logo_url" character varying(500),
  "contact_person" character varying(100),
  "contact_phone" character varying(20),
  "courses_offered" jsonb,
  "is_verified" boolean DEFAULT false,
  "is_approved" boolean DEFAULT false,
  "approved_at" timestamp with time zone,
  "approved_by" integer,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" timestamp with time zone
);
CREATE TABLE "epdg"."submissions" (
  "id" integer DEFAULT nextval('epdg.submissions_id_seq'::regclass) NOT NULL,
  "task_id" integer NOT NULL,
  "placement_id" integer NOT NULL,
  "intern_id" integer NOT NULL,
  "file_url" character varying(500) NOT NULL,
  "file_name" character varying(255),
  "file_size_kb" integer,
  "notes" text,
  "status" epdg.submission_status DEFAULT 'submitted'::epdg.submission_status,
  "reviewer_comment" text,
  "reviewed_by" integer,
  "submitted_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  "reviewed_at" timestamp with time zone
);
CREATE TABLE "epdg"."tasks" (
  "id" integer DEFAULT nextval('epdg.tasks_id_seq'::regclass) NOT NULL,
  "placement_id" integer NOT NULL,
  "assigned_by" integer NOT NULL,
  "title" character varying(200) NOT NULL,
  "description" text,
  "priority" epdg.task_priority DEFAULT 'normal'::epdg.task_priority,
  "status" epdg.task_status DEFAULT 'pending'::epdg.task_status,
  "due_date" timestamp with time zone NOT NULL,
  "points" integer DEFAULT 10,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  "completed_at" timestamp with time zone,
  "deleted_at" timestamp with time zone
);
CREATE TABLE "epdg"."tracks" (
  "id" integer DEFAULT nextval('epdg.tracks_id_seq'::regclass) NOT NULL,
  "slug" character varying(50) NOT NULL,
  "name" character varying(100) NOT NULL,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "epdg"."users" (
  "id" integer DEFAULT nextval('epdg.users_id_seq'::regclass) NOT NULL,
  "email" character varying(150) NOT NULL,
  "name" character varying(100) NOT NULL,
  "password" character varying(255) NOT NULL,
  "role" epdg.user_role NOT NULL,
  "is_verified" boolean DEFAULT false,
  "verification_token" character varying(255),
  "token_expires_at" timestamp with time zone,
  "last_login_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT CURRENT_TIMESTAMP,
  "deleted_at" timestamp with time zone,
  "rejection_reason" text
);
CREATE TABLE "private"."lead_rate_limits" (
  "id" bigint GENERATED BY DEFAULT AS IDENTITY NOT NULL,
  "requester_hash" text NOT NULL,
  "requested_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE TABLE "public"."leaderboard_points" (
  "id" integer DEFAULT nextval('leaderboard_points_id_seq'::regclass) NOT NULL,
  "placement_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "company_id" integer NOT NULL,
  "total_points" integer DEFAULT 0,
  "weekly_points" integer DEFAULT 0,
  "tasks_completed" integer DEFAULT 0,
  "on_time_rate" numeric(5,2) DEFAULT 0.00,
  "badges" jsonb,
  "week_number" integer,
  "year" integer,
  "updated_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE "public"."leads" (
  "id" uuid DEFAULT gen_random_uuid() NOT NULL,
  "first_name" text,
  "last_name" text,
  "full_name" text,
  "email" text NOT NULL,
  "phone" text,
  "message" text,
  "service_interest" text,
  "urgency" text,
  "intent_description" text,
  "track_interest" text,
  "division" text,
  "division_label" text,
  "status" text DEFAULT 'new'::text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "idempotency_key" text
);
CREATE TABLE "public"."messages" (
  "id" integer DEFAULT nextval('messages_id_seq'::regclass) NOT NULL,
  "room_id" integer NOT NULL,
  "sender_id" integer NOT NULL,
  "content" text NOT NULL,
  "type" character varying(20) DEFAULT 'text'::character varying NOT NULL,
  "file_url" character varying(500),
  "file_name" character varying(255),
  "is_edited" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now(),
  "deleted_at" timestamp with time zone
);
CREATE TABLE "public"."migrations" (
  "id" integer NOT NULL,
  "name" character varying(100) NOT NULL,
  "hash" character varying(40) NOT NULL,
  "executed_at" timestamp without time zone DEFAULT CURRENT_TIMESTAMP
);
CREATE TABLE "public"."notifications" (
  "id" integer DEFAULT nextval('notifications_id_seq'::regclass) NOT NULL,
  "user_id" integer NOT NULL,
  "type" character varying(100),
  "title" character varying(200),
  "body" text,
  "link" character varying(500),
  "is_read" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE "public"."resource_saves" (
  "id" integer DEFAULT nextval('resource_saves_id_seq'::regclass) NOT NULL,
  "resource_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "saved_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE "public"."room_members" (
  "id" integer DEFAULT nextval('room_members_id_seq'::regclass) NOT NULL,
  "room_id" integer NOT NULL,
  "user_id" integer NOT NULL,
  "last_read_at" timestamp with time zone,
  "joined_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE "public"."rooms" (
  "id" integer DEFAULT nextval('rooms_id_seq'::regclass) NOT NULL,
  "name" character varying(100) NOT NULL,
  "type" character varying(20) NOT NULL,
  "company_id" integer,
  "department" character varying(100),
  "created_by" integer NOT NULL,
  "is_archived" boolean DEFAULT false,
  "created_at" timestamp with time zone DEFAULT now()
);
CREATE TABLE "public"."sessions" (
  "id" integer DEFAULT nextval('sessions_id_seq'::regclass) NOT NULL,
  "placement_id" integer NOT NULL,
  "mentor_id" integer NOT NULL,
  "intern_id" integer NOT NULL,
  "scheduled_at" timestamp with time zone NOT NULL,
  "duration_minutes" integer DEFAULT 60,
  "status" character varying(20) DEFAULT 'scheduled'::character varying NOT NULL,
  "meeting_link" character varying(500),
  "notes" text,
  "intern_rating" smallint,
  "intern_feedback" text,
  "created_at" timestamp with time zone DEFAULT now()
);
ALTER TABLE "core"."branches" ADD CONSTRAINT "branches_code_key" UNIQUE (code);
ALTER TABLE "core"."branches" ADD CONSTRAINT "branches_pkey" PRIMARY KEY (id);
ALTER TABLE "core"."user_branch_roles" ADD CONSTRAINT "user_branch_roles_pkey" PRIMARY KEY (id);
ALTER TABLE "core"."user_branch_roles" ADD CONSTRAINT "user_branch_roles_user_id_branch_id_key" UNIQUE (user_id, branch_id);
ALTER TABLE "core"."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."admins" ADD CONSTRAINT "admins_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."announcements" ADD CONSTRAINT "announcements_audience_check" CHECK (audience::text = ANY (ARRAY['all'::character varying, 'intern'::character varying, 'company'::character varying, 'school'::character varying, 'admin'::character varying]::text[]));
ALTER TABLE "epdg"."announcements" ADD CONSTRAINT "announcements_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."applications" ADD CONSTRAINT "applications_intern_id_slot_id_key" UNIQUE (intern_id, slot_id);
ALTER TABLE "epdg"."applications" ADD CONSTRAINT "applications_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."audit_log" ADD CONSTRAINT "audit_log_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."badge_awards" ADD CONSTRAINT "badge_awards_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."badges" ADD CONSTRAINT "badges_name_key" UNIQUE (name);
ALTER TABLE "epdg"."badges" ADD CONSTRAINT "badges_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."career_experiences" ADD CONSTRAINT "career_experiences_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."career_experiences" ADD CONSTRAINT "career_experiences_source_check" CHECK (source::text = ANY (ARRAY['manual'::character varying, 'platform'::character varying]::text[]));
ALTER TABLE "epdg"."career_files" ADD CONSTRAINT "career_files_intern_profile_id_key" UNIQUE (intern_profile_id);
ALTER TABLE "epdg"."career_files" ADD CONSTRAINT "career_files_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."career_files" ADD CONSTRAINT "career_files_readiness_score_check" CHECK (readiness_score >= 0 AND readiness_score <= 100);
ALTER TABLE "epdg"."career_files" ADD CONSTRAINT "career_files_readiness_tier_check" CHECK (readiness_tier::text = ANY (ARRAY['not_ready'::character varying, 'developing'::character varying, 'internship_ready'::character varying, 'internship_ready_plus'::character varying, 'employer_ready'::character varying]::text[]));
ALTER TABLE "epdg"."career_files" ADD CONSTRAINT "career_files_slug_key" UNIQUE (slug);
ALTER TABLE "epdg"."career_projects" ADD CONSTRAINT "career_projects_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."career_projects" ADD CONSTRAINT "career_projects_source_check" CHECK (source::text = ANY (ARRAY['manual'::character varying, 'module_completion'::character varying, 'submission'::character varying, 'portfolio'::character varying]::text[]));
ALTER TABLE "epdg"."career_skills" ADD CONSTRAINT "career_skills_career_file_id_skill_name_key" UNIQUE (career_file_id, skill_name);
ALTER TABLE "epdg"."career_skills" ADD CONSTRAINT "career_skills_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."career_skills" ADD CONSTRAINT "career_skills_proficiency_check" CHECK (proficiency::text = ANY (ARRAY['beginner'::character varying, 'intermediate'::character varying, 'advanced'::character varying]::text[]));
ALTER TABLE "epdg"."career_skills" ADD CONSTRAINT "career_skills_source_check" CHECK (source::text = ANY (ARRAY['self_reported'::character varying, 'extracted_cv'::character varying, 'platform_activity'::character varying, 'mentor_endorsed'::character varying]::text[]));
ALTER TABLE "epdg"."certificate_templates" ADD CONSTRAINT "certificate_templates_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."certificates" ADD CONSTRAINT "certificates_certificate_number_key" UNIQUE (certificate_number);
ALTER TABLE "epdg"."certificates" ADD CONSTRAINT "certificates_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."certificates" ADD CONSTRAINT "certificates_status_check" CHECK (status::text = ANY (ARRAY['active'::character varying, 'revoked'::character varying]::text[]));
ALTER TABLE "epdg"."companies" ADD CONSTRAINT "companies_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."feedback" ADD CONSTRAINT "feedback_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."feedback" ADD CONSTRAINT "feedback_rating_check" CHECK (rating >= 1 AND rating <= 5);
ALTER TABLE "epdg"."feedback" ADD CONSTRAINT "feedback_type_check" CHECK (type::text = ANY (ARRAY['intern_to_program'::character varying, 'mentor_to_intern'::character varying, 'intern_to_mentor'::character varying]::text[]));
ALTER TABLE "epdg"."intern_level_progress" ADD CONSTRAINT "intern_level_progress_current_level_check" CHECK (current_level::text = ANY (ARRAY['beginner'::character varying, 'intermediate'::character varying, 'advanced'::character varying]::text[]));
ALTER TABLE "epdg"."intern_level_progress" ADD CONSTRAINT "intern_level_progress_intern_id_track_id_key" UNIQUE (intern_id, track_id);
ALTER TABLE "epdg"."intern_level_progress" ADD CONSTRAINT "intern_level_progress_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."intern_profiles" ADD CONSTRAINT "intern_profiles_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."intern_roadmap_progress" ADD CONSTRAINT "intern_roadmap_progress_intern_id_week_id_key" UNIQUE (intern_id, week_id);
ALTER TABLE "epdg"."intern_roadmap_progress" ADD CONSTRAINT "intern_roadmap_progress_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."intern_skills" ADD CONSTRAINT "intern_skills_intern_id_skill_name_key" UNIQUE (intern_id, skill_name);
ALTER TABLE "epdg"."intern_skills" ADD CONSTRAINT "intern_skills_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."intern_skills" ADD CONSTRAINT "intern_skills_proficiency_check" CHECK (proficiency >= 0 AND proficiency <= 100);
ALTER TABLE "epdg"."internship_slots" ADD CONSTRAINT "internship_slots_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."mentor_sessions" ADD CONSTRAINT "mentor_sessions_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."milestones" ADD CONSTRAINT "milestones_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."module_completions" ADD CONSTRAINT "module_completions_intern_id_module_id_key" UNIQUE (intern_id, module_id);
ALTER TABLE "epdg"."module_completions" ADD CONSTRAINT "module_completions_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."onboarding_agreements" ADD CONSTRAINT "onboarding_agreements_agreement_type_check" CHECK (agreement_type::text = ANY (ARRAY['nda'::character varying, 'disclaimer'::character varying]::text[]));
ALTER TABLE "epdg"."onboarding_agreements" ADD CONSTRAINT "onboarding_agreements_intern_id_agreement_type_key" UNIQUE (intern_id, agreement_type);
ALTER TABLE "epdg"."onboarding_agreements" ADD CONSTRAINT "onboarding_agreements_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."opportunities" ADD CONSTRAINT "opportunities_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."opportunities" ADD CONSTRAINT "opportunities_status_check" CHECK (status::text = ANY (ARRAY['open'::character varying, 'closed'::character varying, 'filled'::character varying]::text[]));
ALTER TABLE "epdg"."opportunities" ADD CONSTRAINT "opportunities_type_check" CHECK (type::text = ANY (ARRAY['gig'::character varying, 'job'::character varying]::text[]));
ALTER TABLE "epdg"."opportunity_applications" ADD CONSTRAINT "opportunity_applications_intern_id_opportunity_id_key" UNIQUE (intern_id, opportunity_id);
ALTER TABLE "epdg"."opportunity_applications" ADD CONSTRAINT "opportunity_applications_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."opportunity_applications" ADD CONSTRAINT "opportunity_applications_status_check" CHECK (status::text = ANY (ARRAY['pending'::character varying, 'shortlisted'::character varying, 'accepted'::character varying, 'rejected'::character varying]::text[]));
ALTER TABLE "epdg"."placements" ADD CONSTRAINT "placements_application_id_key" UNIQUE (application_id);
ALTER TABLE "epdg"."placements" ADD CONSTRAINT "placements_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."platform_settings" ADD CONSTRAINT "platform_settings_pkey" PRIMARY KEY (key);
ALTER TABLE "epdg"."point_events" ADD CONSTRAINT "point_events_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."readiness_score_history" ADD CONSTRAINT "readiness_score_history_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."readiness_score_history" ADD CONSTRAINT "readiness_score_history_score_check" CHECK (score >= 0 AND score <= 100);
ALTER TABLE "epdg"."resources" ADD CONSTRAINT "resources_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."resources" ADD CONSTRAINT "resources_type_check" CHECK (type::text = ANY (ARRAY['article'::character varying, 'video'::character varying, 'course'::character varying, 'opportunity'::character varying, 'event'::character varying, 'scholarship'::character varying]::text[]));
ALTER TABLE "epdg"."roadmap_modules" ADD CONSTRAINT "roadmap_modules_level_check" CHECK (level::text = ANY (ARRAY['beginner'::character varying, 'intermediate'::character varying, 'advanced'::character varying]::text[]));
ALTER TABLE "epdg"."roadmap_modules" ADD CONSTRAINT "roadmap_modules_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."roadmap_modules" ADD CONSTRAINT "roadmap_modules_track_id_level_order_index_key" UNIQUE (track_id, level, order_index);
ALTER TABLE "epdg"."roadmap_weeks" ADD CONSTRAINT "roadmap_weeks_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."roadmap_weeks" ADD CONSTRAINT "roadmap_weeks_week_number_key" UNIQUE (week_number);
ALTER TABLE "epdg"."schools" ADD CONSTRAINT "schools_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."submissions" ADD CONSTRAINT "submissions_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."tasks" ADD CONSTRAINT "tasks_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."tracks" ADD CONSTRAINT "tracks_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."tracks" ADD CONSTRAINT "tracks_slug_key" UNIQUE (slug);
ALTER TABLE "epdg"."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY (id);
ALTER TABLE "private"."lead_rate_limits" ADD CONSTRAINT "lead_rate_limits_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."leaderboard_points" ADD CONSTRAINT "leaderboard_points_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."leaderboard_points" ADD CONSTRAINT "leaderboard_points_placement_id_user_id_week_number_year_key" UNIQUE (placement_id, user_id, week_number, year);
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_idempotency_key_format" CHECK (idempotency_key IS NULL OR idempotency_key ~ '^[0-9a-f]{64}$'::text);
ALTER TABLE "public"."leads" ADD CONSTRAINT "leads_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_type_check" CHECK (type::text = ANY (ARRAY['text'::character varying, 'file'::character varying, 'image'::character varying, 'system'::character varying]::text[]));
ALTER TABLE "public"."migrations" ADD CONSTRAINT "migrations_name_key" UNIQUE (name);
ALTER TABLE "public"."migrations" ADD CONSTRAINT "migrations_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."resource_saves" ADD CONSTRAINT "resource_saves_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."resource_saves" ADD CONSTRAINT "resource_saves_resource_id_user_id_key" UNIQUE (resource_id, user_id);
ALTER TABLE "public"."room_members" ADD CONSTRAINT "room_members_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."room_members" ADD CONSTRAINT "room_members_room_id_user_id_key" UNIQUE (room_id, user_id);
ALTER TABLE "public"."rooms" ADD CONSTRAINT "rooms_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."rooms" ADD CONSTRAINT "rooms_type_check" CHECK (type::text = ANY (ARRAY['group'::character varying, 'direct'::character varying, 'announcement'::character varying, 'department'::character varying]::text[]));
ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_intern_rating_check" CHECK (intern_rating >= 1 AND intern_rating <= 5);
ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_pkey" PRIMARY KEY (id);
ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_status_check" CHECK (status::text = ANY (ARRAY['scheduled'::character varying, 'completed'::character varying, 'cancelled'::character varying, 'rescheduled'::character varying]::text[]));
ALTER TABLE "core"."user_branch_roles" ADD CONSTRAINT "user_branch_roles_branch_id_fkey" FOREIGN KEY (branch_id) REFERENCES core.branches(id);
ALTER TABLE "core"."user_branch_roles" ADD CONSTRAINT "user_branch_roles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES core.users(id);
ALTER TABLE "epdg"."admins" ADD CONSTRAINT "admins_user_id_fkey" FOREIGN KEY (user_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."announcements" ADD CONSTRAINT "announcements_created_by_fkey" FOREIGN KEY (created_by) REFERENCES epdg.users(id);
ALTER TABLE "epdg"."applications" ADD CONSTRAINT "applications_intern_id_fkey" FOREIGN KEY (intern_id) REFERENCES epdg.intern_profiles(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."applications" ADD CONSTRAINT "applications_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES epdg.users(id) ON DELETE SET NULL;
ALTER TABLE "epdg"."applications" ADD CONSTRAINT "applications_slot_id_fkey" FOREIGN KEY (slot_id) REFERENCES epdg.internship_slots(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."audit_log" ADD CONSTRAINT "audit_log_admin_id_fkey" FOREIGN KEY (admin_id) REFERENCES epdg.users(id) ON DELETE SET NULL;
ALTER TABLE "epdg"."badge_awards" ADD CONSTRAINT "badge_awards_awarded_by_fkey" FOREIGN KEY (awarded_by) REFERENCES epdg.users(id) ON DELETE SET NULL;
ALTER TABLE "epdg"."badge_awards" ADD CONSTRAINT "badge_awards_badge_id_fkey" FOREIGN KEY (badge_id) REFERENCES epdg.badges(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."badge_awards" ADD CONSTRAINT "badge_awards_user_id_fkey" FOREIGN KEY (user_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."career_experiences" ADD CONSTRAINT "career_experiences_career_file_id_fkey" FOREIGN KEY (career_file_id) REFERENCES epdg.career_files(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."career_files" ADD CONSTRAINT "career_files_intern_profile_id_fkey" FOREIGN KEY (intern_profile_id) REFERENCES epdg.intern_profiles(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."career_projects" ADD CONSTRAINT "career_projects_career_file_id_fkey" FOREIGN KEY (career_file_id) REFERENCES epdg.career_files(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."career_skills" ADD CONSTRAINT "career_skills_career_file_id_fkey" FOREIGN KEY (career_file_id) REFERENCES epdg.career_files(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."career_skills" ADD CONSTRAINT "career_skills_endorsed_by_fkey" FOREIGN KEY (endorsed_by) REFERENCES epdg.users(id) ON DELETE SET NULL;
ALTER TABLE "epdg"."certificates" ADD CONSTRAINT "certificates_intern_id_fkey" FOREIGN KEY (intern_id) REFERENCES epdg.users(id);
ALTER TABLE "epdg"."certificates" ADD CONSTRAINT "certificates_issued_by_fkey" FOREIGN KEY (issued_by) REFERENCES epdg.users(id);
ALTER TABLE "epdg"."certificates" ADD CONSTRAINT "certificates_template_id_fkey" FOREIGN KEY (template_id) REFERENCES epdg.certificate_templates(id);
ALTER TABLE "epdg"."companies" ADD CONSTRAINT "companies_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES epdg.users(id) ON DELETE SET NULL;
ALTER TABLE "epdg"."companies" ADD CONSTRAINT "companies_user_id_fkey" FOREIGN KEY (user_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."feedback" ADD CONSTRAINT "feedback_given_by_fkey" FOREIGN KEY (given_by) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."feedback" ADD CONSTRAINT "feedback_placement_id_fkey" FOREIGN KEY (placement_id) REFERENCES epdg.placements(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."feedback" ADD CONSTRAINT "feedback_target_user_id_fkey" FOREIGN KEY (target_user_id) REFERENCES epdg.users(id) ON DELETE SET NULL;
ALTER TABLE "epdg"."intern_level_progress" ADD CONSTRAINT "intern_level_progress_intern_id_fkey" FOREIGN KEY (intern_id) REFERENCES epdg.intern_profiles(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."intern_level_progress" ADD CONSTRAINT "intern_level_progress_track_id_fkey" FOREIGN KEY (track_id) REFERENCES epdg.tracks(id);
ALTER TABLE "epdg"."intern_profiles" ADD CONSTRAINT "intern_profiles_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES epdg.users(id);
ALTER TABLE "epdg"."intern_profiles" ADD CONSTRAINT "intern_profiles_mentor_id_fkey" FOREIGN KEY (mentor_id) REFERENCES epdg.users(id) ON DELETE SET NULL;
ALTER TABLE "epdg"."intern_profiles" ADD CONSTRAINT "intern_profiles_school_id_fkey" FOREIGN KEY (school_id) REFERENCES epdg.schools(id) ON DELETE SET NULL;
ALTER TABLE "epdg"."intern_profiles" ADD CONSTRAINT "intern_profiles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."intern_roadmap_progress" ADD CONSTRAINT "intern_roadmap_progress_intern_id_fkey" FOREIGN KEY (intern_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."intern_roadmap_progress" ADD CONSTRAINT "intern_roadmap_progress_week_id_fkey" FOREIGN KEY (week_id) REFERENCES epdg.roadmap_weeks(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."intern_skills" ADD CONSTRAINT "intern_skills_intern_id_fkey" FOREIGN KEY (intern_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."internship_slots" ADD CONSTRAINT "internship_slots_company_id_fkey" FOREIGN KEY (company_id) REFERENCES epdg.companies(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."internship_slots" ADD CONSTRAINT "internship_slots_created_by_fkey" FOREIGN KEY (created_by) REFERENCES epdg.users(id) ON DELETE SET NULL;
ALTER TABLE "epdg"."mentor_sessions" ADD CONSTRAINT "mentor_sessions_intern_id_fkey" FOREIGN KEY (intern_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."mentor_sessions" ADD CONSTRAINT "mentor_sessions_mentor_id_fkey" FOREIGN KEY (mentor_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."mentor_sessions" ADD CONSTRAINT "mentor_sessions_placement_id_fkey" FOREIGN KEY (placement_id) REFERENCES epdg.placements(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."milestones" ADD CONSTRAINT "milestones_completed_by_fkey" FOREIGN KEY (completed_by) REFERENCES epdg.users(id) ON DELETE SET NULL;
ALTER TABLE "epdg"."milestones" ADD CONSTRAINT "milestones_placement_id_fkey" FOREIGN KEY (placement_id) REFERENCES epdg.placements(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."module_completions" ADD CONSTRAINT "module_completions_intern_id_fkey" FOREIGN KEY (intern_id) REFERENCES epdg.intern_profiles(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."module_completions" ADD CONSTRAINT "module_completions_mentor_id_fkey" FOREIGN KEY (mentor_id) REFERENCES epdg.users(id) ON DELETE SET NULL;
ALTER TABLE "epdg"."module_completions" ADD CONSTRAINT "module_completions_module_id_fkey" FOREIGN KEY (module_id) REFERENCES epdg.roadmap_modules(id);
ALTER TABLE "epdg"."onboarding_agreements" ADD CONSTRAINT "onboarding_agreements_intern_id_fkey" FOREIGN KEY (intern_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."opportunities" ADD CONSTRAINT "opportunities_company_id_fkey" FOREIGN KEY (company_id) REFERENCES epdg.companies(id) ON DELETE SET NULL;
ALTER TABLE "epdg"."opportunities" ADD CONSTRAINT "opportunities_posted_by_fkey" FOREIGN KEY (posted_by) REFERENCES epdg.users(id) ON DELETE SET NULL;
ALTER TABLE "epdg"."opportunity_applications" ADD CONSTRAINT "opportunity_applications_intern_id_fkey" FOREIGN KEY (intern_id) REFERENCES epdg.intern_profiles(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."opportunity_applications" ADD CONSTRAINT "opportunity_applications_opportunity_id_fkey" FOREIGN KEY (opportunity_id) REFERENCES epdg.opportunities(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."opportunity_applications" ADD CONSTRAINT "opportunity_applications_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES epdg.users(id) ON DELETE SET NULL;
ALTER TABLE "epdg"."placements" ADD CONSTRAINT "placements_application_id_fkey" FOREIGN KEY (application_id) REFERENCES epdg.applications(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."placements" ADD CONSTRAINT "placements_company_id_fkey" FOREIGN KEY (company_id) REFERENCES epdg.companies(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."placements" ADD CONSTRAINT "placements_intern_id_fkey" FOREIGN KEY (intern_id) REFERENCES epdg.intern_profiles(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."placements" ADD CONSTRAINT "placements_mentor_id_fkey" FOREIGN KEY (mentor_id) REFERENCES epdg.users(id) ON DELETE SET NULL;
ALTER TABLE "epdg"."placements" ADD CONSTRAINT "placements_school_id_fkey" FOREIGN KEY (school_id) REFERENCES epdg.schools(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."placements" ADD CONSTRAINT "placements_slot_id_fkey" FOREIGN KEY (slot_id) REFERENCES epdg.internship_slots(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."point_events" ADD CONSTRAINT "point_events_awarded_by_fkey" FOREIGN KEY (awarded_by) REFERENCES epdg.users(id) ON DELETE SET NULL;
ALTER TABLE "epdg"."point_events" ADD CONSTRAINT "point_events_user_id_fkey" FOREIGN KEY (user_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."readiness_score_history" ADD CONSTRAINT "readiness_score_history_career_file_id_fkey" FOREIGN KEY (career_file_id) REFERENCES epdg.career_files(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."resources" ADD CONSTRAINT "resources_uploaded_by_fkey" FOREIGN KEY (uploaded_by) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."roadmap_modules" ADD CONSTRAINT "roadmap_modules_track_id_fkey" FOREIGN KEY (track_id) REFERENCES epdg.tracks(id);
ALTER TABLE "epdg"."schools" ADD CONSTRAINT "schools_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES epdg.users(id) ON DELETE SET NULL;
ALTER TABLE "epdg"."schools" ADD CONSTRAINT "schools_user_id_fkey" FOREIGN KEY (user_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."submissions" ADD CONSTRAINT "submissions_intern_id_fkey" FOREIGN KEY (intern_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."submissions" ADD CONSTRAINT "submissions_placement_id_fkey" FOREIGN KEY (placement_id) REFERENCES epdg.placements(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."submissions" ADD CONSTRAINT "submissions_reviewed_by_fkey" FOREIGN KEY (reviewed_by) REFERENCES epdg.users(id) ON DELETE SET NULL;
ALTER TABLE "epdg"."submissions" ADD CONSTRAINT "submissions_task_id_fkey" FOREIGN KEY (task_id) REFERENCES epdg.tasks(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."tasks" ADD CONSTRAINT "tasks_assigned_by_fkey" FOREIGN KEY (assigned_by) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."tasks" ADD CONSTRAINT "tasks_placement_id_fkey" FOREIGN KEY (placement_id) REFERENCES epdg.placements(id) ON DELETE CASCADE;
ALTER TABLE "public"."leaderboard_points" ADD CONSTRAINT "leaderboard_points_company_id_fkey" FOREIGN KEY (company_id) REFERENCES epdg.companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."leaderboard_points" ADD CONSTRAINT "leaderboard_points_placement_id_fkey" FOREIGN KEY (placement_id) REFERENCES epdg.placements(id) ON DELETE CASCADE;
ALTER TABLE "public"."leaderboard_points" ADD CONSTRAINT "leaderboard_points_user_id_fkey" FOREIGN KEY (user_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_room_id_fkey" FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE "public"."messages" ADD CONSTRAINT "messages_sender_id_fkey" FOREIGN KEY (sender_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."notifications" ADD CONSTRAINT "notifications_user_id_fkey" FOREIGN KEY (user_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."resource_saves" ADD CONSTRAINT "resource_saves_resource_id_fkey" FOREIGN KEY (resource_id) REFERENCES epdg.resources(id) ON DELETE CASCADE;
ALTER TABLE "public"."resource_saves" ADD CONSTRAINT "resource_saves_user_id_fkey" FOREIGN KEY (user_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."room_members" ADD CONSTRAINT "room_members_room_id_fkey" FOREIGN KEY (room_id) REFERENCES rooms(id) ON DELETE CASCADE;
ALTER TABLE "public"."room_members" ADD CONSTRAINT "room_members_user_id_fkey" FOREIGN KEY (user_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."rooms" ADD CONSTRAINT "rooms_company_id_fkey" FOREIGN KEY (company_id) REFERENCES epdg.companies(id) ON DELETE CASCADE;
ALTER TABLE "public"."rooms" ADD CONSTRAINT "rooms_created_by_fkey" FOREIGN KEY (created_by) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_intern_id_fkey" FOREIGN KEY (intern_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_mentor_id_fkey" FOREIGN KEY (mentor_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "public"."sessions" ADD CONSTRAINT "sessions_placement_id_fkey" FOREIGN KEY (placement_id) REFERENCES epdg.placements(id) ON DELETE CASCADE;
CREATE INDEX idx_user_branch_roles_branch_id ON core.user_branch_roles USING btree (branch_id);
CREATE INDEX idx_user_branch_roles_user_id ON core.user_branch_roles USING btree (user_id);
CREATE UNIQUE INDEX core_users_email_unique_active ON core.users USING btree (email) WHERE (deleted_at IS NULL);
CREATE INDEX idx_admins_admin_type ON epdg.admins USING btree (admin_type);
CREATE UNIQUE INDEX idx_admins_user_id ON epdg.admins USING btree (user_id);
CREATE INDEX idx_announcements_audience ON epdg.announcements USING btree (audience);
CREATE INDEX idx_applications_intern_id ON epdg.applications USING btree (intern_id);
CREATE INDEX idx_applications_reviewed_by ON epdg.applications USING btree (reviewed_by);
CREATE INDEX idx_applications_slot_id ON epdg.applications USING btree (slot_id);
CREATE INDEX idx_applications_status ON epdg.applications USING btree (status);
CREATE INDEX idx_audit_log_admin_id ON epdg.audit_log USING btree (admin_id);
CREATE INDEX idx_audit_log_created_at ON epdg.audit_log USING btree (created_at DESC);
CREATE INDEX idx_career_experiences_career_file_id ON epdg.career_experiences USING btree (career_file_id);
CREATE INDEX idx_career_files_intern_profile ON epdg.career_files USING btree (intern_profile_id);
CREATE INDEX idx_career_files_slug ON epdg.career_files USING btree (slug);
CREATE INDEX idx_career_files_tier ON epdg.career_files USING btree (readiness_tier);
CREATE INDEX idx_career_projects_file ON epdg.career_projects USING btree (career_file_id);
CREATE UNIQUE INDEX idx_career_projects_platform_dedup ON epdg.career_projects USING btree (career_file_id, source, source_ref_id) WHERE (source_ref_id IS NOT NULL);
CREATE INDEX idx_career_skills_endorsed_by ON epdg.career_skills USING btree (endorsed_by);
CREATE INDEX idx_career_skills_file ON epdg.career_skills USING btree (career_file_id);
CREATE INDEX idx_companies_approved_by ON epdg.companies USING btree (approved_by);
CREATE INDEX idx_companies_user_id ON epdg.companies USING btree (user_id);
CREATE INDEX idx_feedback_placement_id ON epdg.feedback USING btree (placement_id);
CREATE INDEX idx_intern_level_progress_intern ON epdg.intern_level_progress USING btree (intern_id);
CREATE INDEX idx_intern_profiles_approved ON epdg.intern_profiles USING btree (is_approved);
CREATE INDEX idx_intern_profiles_school_id ON epdg.intern_profiles USING btree (school_id);
CREATE INDEX idx_intern_profiles_user_id ON epdg.intern_profiles USING btree (user_id);
CREATE INDEX idx_intern_roadmap_intern_id ON epdg.intern_roadmap_progress USING btree (intern_id);
CREATE INDEX idx_intern_skills_intern_id ON epdg.intern_skills USING btree (intern_id);
CREATE INDEX idx_internship_slots_company_id ON epdg.internship_slots USING btree (company_id);
CREATE INDEX idx_internship_slots_status ON epdg.internship_slots USING btree (status);
CREATE INDEX idx_mentor_sessions_intern_id ON epdg.mentor_sessions USING btree (intern_id);
CREATE INDEX idx_mentor_sessions_mentor_id ON epdg.mentor_sessions USING btree (mentor_id);
CREATE INDEX idx_mentor_sessions_placement ON epdg.mentor_sessions USING btree (placement_id);
CREATE INDEX idx_milestones_completed_by ON epdg.milestones USING btree (completed_by);
CREATE INDEX idx_milestones_placement_id ON epdg.milestones USING btree (placement_id);
CREATE INDEX idx_module_completions_intern_id ON epdg.module_completions USING btree (intern_id);
CREATE INDEX idx_onboarding_agreements_intern ON epdg.onboarding_agreements USING btree (intern_id);
CREATE INDEX idx_opportunities_status ON epdg.opportunities USING btree (status);
CREATE INDEX idx_opportunities_type ON epdg.opportunities USING btree (type);
CREATE INDEX idx_opp_apps_intern_id ON epdg.opportunity_applications USING btree (intern_id);
CREATE INDEX idx_opp_apps_opp_id ON epdg.opportunity_applications USING btree (opportunity_id);
CREATE INDEX idx_placements_company_id ON epdg.placements USING btree (company_id);
CREATE INDEX idx_placements_intern_id ON epdg.placements USING btree (intern_id);
CREATE INDEX idx_placements_mentor_id ON epdg.placements USING btree (mentor_id);
CREATE INDEX idx_placements_school_id ON epdg.placements USING btree (school_id);
CREATE INDEX idx_placements_slot_id ON epdg.placements USING btree (slot_id);
CREATE INDEX idx_placements_status ON epdg.placements USING btree (status);
CREATE INDEX idx_readiness_history_file ON epdg.readiness_score_history USING btree (career_file_id, snapshot_at);
CREATE INDEX idx_resources_category ON epdg.resources USING btree (category);
CREATE INDEX idx_resources_type ON epdg.resources USING btree (type);
CREATE INDEX idx_roadmap_modules_track_level ON epdg.roadmap_modules USING btree (track_id, level);
CREATE INDEX idx_schools_approved_by ON epdg.schools USING btree (approved_by);
CREATE INDEX idx_schools_user_id ON epdg.schools USING btree (user_id);
CREATE INDEX idx_submissions_intern_id ON epdg.submissions USING btree (intern_id);
CREATE INDEX idx_submissions_placement_id ON epdg.submissions USING btree (placement_id);
CREATE INDEX idx_submissions_reviewed_by ON epdg.submissions USING btree (reviewed_by);
CREATE INDEX idx_submissions_status ON epdg.submissions USING btree (status);
CREATE INDEX idx_submissions_task_id ON epdg.submissions USING btree (task_id);
CREATE INDEX idx_tasks_assigned_by ON epdg.tasks USING btree (assigned_by);
CREATE INDEX idx_tasks_placement_id ON epdg.tasks USING btree (placement_id);
CREATE INDEX idx_tasks_status ON epdg.tasks USING btree (status);
CREATE UNIQUE INDEX users_email_unique_active ON epdg.users USING btree (email) WHERE (deleted_at IS NULL);
CREATE INDEX idx_lead_rate_limits_requested_at ON private.lead_rate_limits USING btree (requested_at);
CREATE INDEX idx_lead_rate_limits_requester_time ON private.lead_rate_limits USING btree (requester_hash, requested_at DESC);
CREATE INDEX idx_leaderboard_company_id ON public.leaderboard_points USING btree (company_id);
CREATE INDEX idx_leads_created_at ON public.leads USING btree (created_at DESC);
CREATE INDEX idx_leads_status_created_at ON public.leads USING btree (status, created_at DESC);
CREATE UNIQUE INDEX idx_leads_idempotency_key ON public.leads USING btree (idempotency_key) WHERE (idempotency_key IS NOT NULL);
CREATE INDEX idx_messages_room_id ON public.messages USING btree (room_id);
CREATE INDEX idx_notifications_is_read ON public.notifications USING btree (is_read);
CREATE INDEX idx_notifications_user_id ON public.notifications USING btree (user_id);
CREATE INDEX idx_resource_saves_user_id ON public.resource_saves USING btree (user_id);
CREATE INDEX idx_room_members_user_id ON public.room_members USING btree (user_id);
CREATE INDEX idx_rooms_company_id ON public.rooms USING btree (company_id);
CREATE INDEX idx_sessions_intern_id ON public.sessions USING btree (intern_id);
CREATE INDEX idx_sessions_mentor_id ON public.sessions USING btree (mentor_id);
CREATE INDEX idx_sessions_placement_id ON public.sessions USING btree (placement_id);
ALTER SEQUENCE "core"."branches_id_seq" OWNED BY "core"."branches"."id";
ALTER SEQUENCE "core"."user_branch_roles_id_seq" OWNED BY "core"."user_branch_roles"."id";
ALTER SEQUENCE "core"."users_id_seq" OWNED BY "core"."users"."id";
ALTER SEQUENCE "epdg"."admins_id_seq" OWNED BY "epdg"."admins"."id";
ALTER SEQUENCE "epdg"."announcements_id_seq" OWNED BY "epdg"."announcements"."id";
ALTER SEQUENCE "epdg"."applications_id_seq" OWNED BY "epdg"."applications"."id";
ALTER SEQUENCE "epdg"."audit_log_id_seq" OWNED BY "epdg"."audit_log"."id";
ALTER SEQUENCE "epdg"."badge_awards_id_seq" OWNED BY "epdg"."badge_awards"."id";
ALTER SEQUENCE "epdg"."badges_id_seq" OWNED BY "epdg"."badges"."id";
ALTER SEQUENCE "epdg"."career_experiences_id_seq" OWNED BY "epdg"."career_experiences"."id";
ALTER SEQUENCE "epdg"."career_files_id_seq" OWNED BY "epdg"."career_files"."id";
ALTER SEQUENCE "epdg"."career_projects_id_seq" OWNED BY "epdg"."career_projects"."id";
ALTER SEQUENCE "epdg"."career_skills_id_seq" OWNED BY "epdg"."career_skills"."id";
ALTER SEQUENCE "epdg"."certificate_templates_id_seq" OWNED BY "epdg"."certificate_templates"."id";
ALTER SEQUENCE "epdg"."companies_id_seq" OWNED BY "epdg"."companies"."id";
ALTER SEQUENCE "epdg"."feedback_id_seq" OWNED BY "epdg"."feedback"."id";
ALTER SEQUENCE "epdg"."intern_level_progress_id_seq" OWNED BY "epdg"."intern_level_progress"."id";
ALTER SEQUENCE "epdg"."intern_profiles_id_seq" OWNED BY "epdg"."intern_profiles"."id";
ALTER SEQUENCE "epdg"."intern_roadmap_progress_id_seq" OWNED BY "epdg"."intern_roadmap_progress"."id";
ALTER SEQUENCE "epdg"."intern_skills_id_seq" OWNED BY "epdg"."intern_skills"."id";
ALTER SEQUENCE "epdg"."internship_slots_id_seq" OWNED BY "epdg"."internship_slots"."id";
ALTER SEQUENCE "epdg"."mentor_sessions_id_seq" OWNED BY "epdg"."mentor_sessions"."id";
ALTER SEQUENCE "epdg"."milestones_id_seq" OWNED BY "epdg"."milestones"."id";
ALTER SEQUENCE "epdg"."module_completions_id_seq" OWNED BY "epdg"."module_completions"."id";
ALTER SEQUENCE "epdg"."onboarding_agreements_id_seq" OWNED BY "epdg"."onboarding_agreements"."id";
ALTER SEQUENCE "epdg"."opportunities_id_seq" OWNED BY "epdg"."opportunities"."id";
ALTER SEQUENCE "epdg"."opportunity_applications_id_seq" OWNED BY "epdg"."opportunity_applications"."id";
ALTER SEQUENCE "epdg"."placements_id_seq" OWNED BY "epdg"."placements"."id";
ALTER SEQUENCE "epdg"."point_events_id_seq" OWNED BY "epdg"."point_events"."id";
ALTER SEQUENCE "epdg"."readiness_score_history_id_seq" OWNED BY "epdg"."readiness_score_history"."id";
ALTER SEQUENCE "epdg"."resources_id_seq" OWNED BY "epdg"."resources"."id";
ALTER SEQUENCE "epdg"."roadmap_modules_id_seq" OWNED BY "epdg"."roadmap_modules"."id";
ALTER SEQUENCE "epdg"."roadmap_weeks_id_seq" OWNED BY "epdg"."roadmap_weeks"."id";
ALTER SEQUENCE "epdg"."schools_id_seq" OWNED BY "epdg"."schools"."id";
ALTER SEQUENCE "epdg"."submissions_id_seq" OWNED BY "epdg"."submissions"."id";
ALTER SEQUENCE "epdg"."tasks_id_seq" OWNED BY "epdg"."tasks"."id";
ALTER SEQUENCE "epdg"."tracks_id_seq" OWNED BY "epdg"."tracks"."id";
ALTER SEQUENCE "epdg"."users_id_seq" OWNED BY "epdg"."users"."id";
ALTER SEQUENCE "public"."leaderboard_points_id_seq" OWNED BY "public"."leaderboard_points"."id";
ALTER SEQUENCE "public"."messages_id_seq" OWNED BY "public"."messages"."id";
ALTER SEQUENCE "public"."notifications_id_seq" OWNED BY "public"."notifications"."id";
ALTER SEQUENCE "public"."resource_saves_id_seq" OWNED BY "public"."resource_saves"."id";
ALTER SEQUENCE "public"."room_members_id_seq" OWNED BY "public"."room_members"."id";
ALTER SEQUENCE "public"."rooms_id_seq" OWNED BY "public"."rooms"."id";
ALTER SEQUENCE "public"."sessions_id_seq" OWNED BY "public"."sessions"."id";
CREATE OR REPLACE FUNCTION public.check_lead_rate_limit(request_hash text, max_requests integer DEFAULT 5, window_minutes integer DEFAULT 15)
 RETURNS boolean
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
declare
  recent_count integer;
begin
  if request_hash is null or length(request_hash) < 16 then
    return false;
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('lead_rate_limit:' || request_hash, 0)
  );

  delete from private.lead_rate_limits
  where requested_at < now() - interval '24 hours';

  select count(*)
    into recent_count
  from private.lead_rate_limits
  where requester_hash = request_hash
    and requested_at >= now() - make_interval(mins => greatest(window_minutes, 1));

  if recent_count >= greatest(max_requests, 1) then
    return false;
  end if;

  insert into private.lead_rate_limits (requester_hash)
  values (request_hash);

  return true;
end;
$function$;

CREATE OR REPLACE FUNCTION public.store_lead_request(p_request_hash text, p_request_key text, p_first_name text DEFAULT NULL::text, p_last_name text DEFAULT NULL::text, p_full_name text DEFAULT NULL::text, p_email text DEFAULT NULL::text, p_phone text DEFAULT NULL::text, p_message text DEFAULT NULL::text, p_service_interest text DEFAULT NULL::text, p_urgency text DEFAULT NULL::text, p_intent_description text DEFAULT NULL::text, p_track_interest text DEFAULT NULL::text, p_division text DEFAULT NULL::text, p_division_label text DEFAULT NULL::text, p_max_requests integer DEFAULT 5, p_window_minutes integer DEFAULT 15)
 RETURNS text
 LANGUAGE plpgsql
 SECURITY DEFINER
 SET search_path TO ''
AS $function$
begin
  if p_request_hash is null
    or length(p_request_hash) < 16
    or p_request_key is null
    or p_request_key !~ '^[0-9a-f]{64}$'
    or p_email is null
    or length(p_email) > 254 then
    return 'rejected';
  end if;

  perform pg_catalog.pg_advisory_xact_lock(
    pg_catalog.hashtextextended('lead_request:' || p_request_key, 0)
  );

  if exists (
    select 1
    from public.leads
    where idempotency_key = p_request_key
  ) then
    return 'duplicate';
  end if;

  if not public.check_lead_rate_limit(
    p_request_hash,
    greatest(p_max_requests, 1),
    greatest(p_window_minutes, 1)
  ) then
    return 'rate_limited';
  end if;

  insert into public.leads (
    first_name,
    last_name,
    full_name,
    email,
    phone,
    message,
    service_interest,
    urgency,
    intent_description,
    track_interest,
    division,
    division_label,
    idempotency_key
  )
  values (
    p_first_name,
    p_last_name,
    p_full_name,
    p_email,
    p_phone,
    p_message,
    p_service_interest,
    p_urgency,
    p_intent_description,
    p_track_interest,
    p_division,
    p_division_label,
    p_request_key
  );

  return 'inserted';
end;
$function$;

CREATE OR REPLACE FUNCTION public.update_timestamp()
 RETURNS trigger
 LANGUAGE plpgsql
 SET search_path TO ''
AS $function$
BEGIN
    NEW.updated_at = NOW();
    RETURN NEW;
END;
$function$;

ALTER TABLE "epdg"."admins" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."announcements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."audit_log" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."badge_awards" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."badges" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."career_experiences" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."career_files" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."career_projects" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."career_skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."certificate_templates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."certificates" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."companies" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."feedback" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."intern_level_progress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."intern_profiles" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."intern_roadmap_progress" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."intern_skills" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."internship_slots" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."mentor_sessions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."milestones" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."module_completions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."onboarding_agreements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."opportunities" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."opportunity_applications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."placements" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."platform_settings" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."point_events" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."readiness_score_history" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."resources" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."roadmap_modules" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."roadmap_weeks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."schools" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."submissions" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."tasks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."tracks" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "epdg"."users" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "private"."lead_rate_limits" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."leaderboard_points" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."leads" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."messages" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."migrations" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."notifications" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."resource_saves" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."room_members" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."rooms" ENABLE ROW LEVEL SECURITY;
ALTER TABLE "public"."sessions" ENABLE ROW LEVEL SECURITY;
-- Local grants deliberately omit browser access and public/private records.
REVOKE ALL ON SCHEMA public, core, epdg, private FROM PUBLIC;
REVOKE ALL ON ALL TABLES IN SCHEMA public, core, epdg, private FROM PUBLIC;
REVOKE ALL ON ALL SEQUENCES IN SCHEMA public, core, epdg, private FROM PUBLIC;
REVOKE ALL ON ALL FUNCTIONS IN SCHEMA public, core, epdg, private FROM PUBLIC;
GRANT USAGE ON SCHEMA core, epdg TO epdg_synthetic_app;
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA core, epdg TO epdg_synthetic_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA core, epdg TO epdg_synthetic_app;

