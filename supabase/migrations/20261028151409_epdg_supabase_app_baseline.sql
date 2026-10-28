-- Fresh Supabase application schemas only; managed database objects are preserved.
-- Eight core/EPDG table definitions, constraints, indexes, sequences and five enum
-- types are retained from immutable local baseline; no legacy public/private DDL.
DO $fresh_app_schemas$
BEGIN
  IF current_database()<>'postgres' OR current_user<>'postgres'
    OR EXISTS(SELECT 1 FROM pg_namespace WHERE nspname=ANY(ARRAY['core','epdg','portal_security','synthetic_learning','synthetic_handoff','hosted_practice','synthetic_meta']))
    OR NOT EXISTS(SELECT 1 FROM pg_roles WHERE rolname='epdg_synthetic_app' AND rolcanlogin
      AND NOT rolsuper AND NOT rolcreatedb AND NOT rolcreaterole AND NOT rolreplication AND NOT rolbypassrls AND NOT rolinherit)
    OR EXISTS(SELECT 1 FROM pg_auth_members WHERE member=(SELECT oid FROM pg_roles WHERE rolname='epdg_synthetic_app')) THEN
    RAISE EXCEPTION 'Fresh reviewed Supabase application schemas and restricted runtime role required' USING ERRCODE='23514';
  END IF;
END;
$fresh_app_schemas$;
SET LOCAL search_path=pg_catalog;
CREATE SCHEMA core;
CREATE SCHEMA epdg;
CREATE SCHEMA synthetic_meta;
REVOKE ALL ON SCHEMA core,epdg,synthetic_meta FROM PUBLIC;
CREATE TYPE "core"."admin_role" AS ENUM ('admin', 'super_admin');
CREATE TYPE "core"."user_role" AS ENUM ('admin', 'company', 'intern', 'school');
CREATE TYPE "epdg"."admin_role" AS ENUM ('admin', 'super_admin');
CREATE TYPE "epdg"."school_type" AS ENUM ('university', 'college', 'polytechnic', 'tvet');
CREATE TYPE "epdg"."user_role" AS ENUM ('admin', 'company', 'intern', 'school');
CREATE SEQUENCE "core"."branches_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "core"."user_branch_roles_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "core"."users_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."admins_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."companies_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."intern_profiles_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."schools_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
CREATE SEQUENCE "epdg"."users_id_seq" AS integer INCREMENT 1 MINVALUE 1 MAXVALUE 2147483647 START 1 CACHE 1 NO CYCLE;
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
ALTER TABLE "core"."branches" ADD CONSTRAINT "branches_code_key" UNIQUE (code);
ALTER TABLE "core"."branches" ADD CONSTRAINT "branches_pkey" PRIMARY KEY (id);
ALTER TABLE "core"."user_branch_roles" ADD CONSTRAINT "user_branch_roles_pkey" PRIMARY KEY (id);
ALTER TABLE "core"."user_branch_roles" ADD CONSTRAINT "user_branch_roles_user_id_branch_id_key" UNIQUE (user_id, branch_id);
ALTER TABLE "core"."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."admins" ADD CONSTRAINT "admins_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."companies" ADD CONSTRAINT "companies_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."intern_profiles" ADD CONSTRAINT "intern_profiles_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."schools" ADD CONSTRAINT "schools_pkey" PRIMARY KEY (id);
ALTER TABLE "epdg"."users" ADD CONSTRAINT "users_pkey" PRIMARY KEY (id);
ALTER TABLE "core"."user_branch_roles" ADD CONSTRAINT "user_branch_roles_branch_id_fkey" FOREIGN KEY (branch_id) REFERENCES core.branches(id);
ALTER TABLE "core"."user_branch_roles" ADD CONSTRAINT "user_branch_roles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES core.users(id);
ALTER TABLE "epdg"."admins" ADD CONSTRAINT "admins_user_id_fkey" FOREIGN KEY (user_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."companies" ADD CONSTRAINT "companies_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES epdg.users(id) ON DELETE SET NULL;
ALTER TABLE "epdg"."companies" ADD CONSTRAINT "companies_user_id_fkey" FOREIGN KEY (user_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."intern_profiles" ADD CONSTRAINT "intern_profiles_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES epdg.users(id);
ALTER TABLE "epdg"."intern_profiles" ADD CONSTRAINT "intern_profiles_mentor_id_fkey" FOREIGN KEY (mentor_id) REFERENCES epdg.users(id) ON DELETE SET NULL;
ALTER TABLE "epdg"."intern_profiles" ADD CONSTRAINT "intern_profiles_school_id_fkey" FOREIGN KEY (school_id) REFERENCES epdg.schools(id) ON DELETE SET NULL;
ALTER TABLE "epdg"."intern_profiles" ADD CONSTRAINT "intern_profiles_user_id_fkey" FOREIGN KEY (user_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
ALTER TABLE "epdg"."schools" ADD CONSTRAINT "schools_approved_by_fkey" FOREIGN KEY (approved_by) REFERENCES epdg.users(id) ON DELETE SET NULL;
ALTER TABLE "epdg"."schools" ADD CONSTRAINT "schools_user_id_fkey" FOREIGN KEY (user_id) REFERENCES epdg.users(id) ON DELETE CASCADE;
CREATE INDEX idx_user_branch_roles_branch_id ON core.user_branch_roles USING btree (branch_id);
CREATE INDEX idx_user_branch_roles_user_id ON core.user_branch_roles USING btree (user_id);
CREATE UNIQUE INDEX core_users_email_unique_active ON core.users USING btree (email) WHERE (deleted_at IS NULL);
CREATE INDEX idx_admins_admin_type ON epdg.admins USING btree (admin_type);
CREATE UNIQUE INDEX idx_admins_user_id ON epdg.admins USING btree (user_id);
CREATE INDEX idx_companies_approved_by ON epdg.companies USING btree (approved_by);
CREATE INDEX idx_companies_user_id ON epdg.companies USING btree (user_id);
CREATE INDEX idx_intern_profiles_approved ON epdg.intern_profiles USING btree (is_approved);
CREATE INDEX idx_intern_profiles_school_id ON epdg.intern_profiles USING btree (school_id);
CREATE INDEX idx_intern_profiles_user_id ON epdg.intern_profiles USING btree (user_id);
CREATE INDEX idx_schools_approved_by ON epdg.schools USING btree (approved_by);
CREATE INDEX idx_schools_user_id ON epdg.schools USING btree (user_id);
CREATE UNIQUE INDEX users_email_unique_active ON epdg.users USING btree (email) WHERE (deleted_at IS NULL);
ALTER SEQUENCE "core"."branches_id_seq" OWNED BY "core"."branches"."id";
ALTER SEQUENCE "core"."user_branch_roles_id_seq" OWNED BY "core"."user_branch_roles"."id";
ALTER SEQUENCE "core"."users_id_seq" OWNED BY "core"."users"."id";
ALTER SEQUENCE "epdg"."admins_id_seq" OWNED BY "epdg"."admins"."id";
ALTER SEQUENCE "epdg"."companies_id_seq" OWNED BY "epdg"."companies"."id";
ALTER SEQUENCE "epdg"."intern_profiles_id_seq" OWNED BY "epdg"."intern_profiles"."id";
ALTER SEQUENCE "epdg"."schools_id_seq" OWNED BY "epdg"."schools"."id";
ALTER SEQUENCE "epdg"."users_id_seq" OWNED BY "epdg"."users"."id";
ALTER TABLE core.branches ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.user_branch_roles ENABLE ROW LEVEL SECURITY;
ALTER TABLE core.users ENABLE ROW LEVEL SECURITY;
ALTER TABLE epdg.admins ENABLE ROW LEVEL SECURITY;
ALTER TABLE epdg.companies ENABLE ROW LEVEL SECURITY;
ALTER TABLE epdg.intern_profiles ENABLE ROW LEVEL SECURITY;
ALTER TABLE epdg.schools ENABLE ROW LEVEL SECURITY;
ALTER TABLE epdg.users ENABLE ROW LEVEL SECURITY;

CREATE TABLE synthetic_meta.identity (
  instance_id uuid PRIMARY KEY,
  provider text NOT NULL CHECK(provider='supabase'),
  supabase_project_ref text NOT NULL CHECK(supabase_project_ref ~ '^[a-z]{20}$'),
  baseline_sha256 text NOT NULL CHECK(baseline_sha256 ~ '^[0-9a-f]{64}$'),
  isolation_sha256 text NOT NULL CHECK(isolation_sha256 ~ '^[0-9a-f]{64}$'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
ALTER TABLE synthetic_meta.identity ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON synthetic_meta.identity FROM PUBLIC;
