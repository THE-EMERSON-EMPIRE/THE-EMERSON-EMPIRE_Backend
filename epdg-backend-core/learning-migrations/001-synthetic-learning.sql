-- Local synthetic learning fixture schema only; never a production migration.
-- Operator execution is gated by the exact local instance identity and checksum.
CREATE SCHEMA synthetic_learning;
REVOKE ALL ON SCHEMA synthetic_learning FROM PUBLIC;

CREATE TABLE synthetic_learning.schema_migrations (
  version text PRIMARY KEY,
  sha256 text NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
  applied_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE TABLE synthetic_learning.programs (
  id uuid PRIMARY KEY,
  school_id integer NOT NULL REFERENCES epdg.schools(id),
  title text NOT NULL CHECK (title LIKE 'SYNTHETIC %'),
  summary text NOT NULL,
  starts_at timestamptz NOT NULL,
  ends_at timestamptz NOT NULL CHECK (ends_at > starts_at),
  UNIQUE (id, school_id)
);
CREATE INDEX synthetic_learning_program_school ON synthetic_learning.programs(school_id);
CREATE TABLE synthetic_learning.enrollments (
  id uuid PRIMARY KEY,
  program_id uuid NOT NULL,
  user_id integer NOT NULL REFERENCES core.users(id),
  school_id integer NOT NULL,
  membership_id uuid NOT NULL REFERENCES portal_security.memberships(id),
  active boolean NOT NULL DEFAULT true,
  FOREIGN KEY (program_id, school_id) REFERENCES synthetic_learning.programs(id, school_id),
  UNIQUE (user_id, program_id),
  UNIQUE (id, program_id)
);
CREATE INDEX synthetic_learning_enrollment_scope ON synthetic_learning.enrollments(user_id, membership_id) WHERE active;
CREATE INDEX synthetic_learning_enrollment_program ON synthetic_learning.enrollments(program_id);
CREATE INDEX synthetic_learning_enrollment_membership ON synthetic_learning.enrollments(membership_id);
CREATE TABLE synthetic_learning.items (
  id uuid PRIMARY KEY,
  program_id uuid NOT NULL REFERENCES synthetic_learning.programs(id),
  position integer NOT NULL CHECK (position > 0),
  title text NOT NULL,
  kind text NOT NULL CHECK (kind IN ('lesson', 'assignment')),
  description text NOT NULL,
  content text NOT NULL,
  due_at timestamptz,
  UNIQUE (id, program_id),
  UNIQUE (program_id, position)
);
CREATE TABLE synthetic_learning.completions (
  enrollment_id uuid NOT NULL,
  program_id uuid NOT NULL,
  item_id uuid NOT NULL,
  completed_at timestamptz NOT NULL DEFAULT clock_timestamp(),
  PRIMARY KEY (enrollment_id, item_id),
  FOREIGN KEY (enrollment_id, program_id) REFERENCES synthetic_learning.enrollments(id, program_id),
  FOREIGN KEY (item_id, program_id) REFERENCES synthetic_learning.items(id, program_id)
);
CREATE INDEX synthetic_learning_completion_item ON synthetic_learning.completions(item_id, program_id);
CREATE TABLE synthetic_learning.feedback (
  id uuid PRIMARY KEY,
  enrollment_id uuid NOT NULL REFERENCES synthetic_learning.enrollments(id),
  title text NOT NULL,
  comment text NOT NULL,
  mentor_label text NOT NULL CHECK (mentor_label LIKE 'SYNTHETIC %'),
  created_at timestamptz NOT NULL DEFAULT clock_timestamp()
);
CREATE INDEX synthetic_learning_feedback_enrollment ON synthetic_learning.feedback(enrollment_id, created_at DESC);
CREATE TABLE synthetic_learning.resources (
  id uuid PRIMARY KEY,
  program_id uuid NOT NULL REFERENCES synthetic_learning.programs(id),
  title text NOT NULL,
  description text NOT NULL,
  body text NOT NULL
);
CREATE INDEX synthetic_learning_resource_program ON synthetic_learning.resources(program_id);

ALTER TABLE synthetic_learning.schema_migrations ENABLE ROW LEVEL SECURITY;
ALTER TABLE synthetic_learning.programs ENABLE ROW LEVEL SECURITY;
ALTER TABLE synthetic_learning.enrollments ENABLE ROW LEVEL SECURITY;
ALTER TABLE synthetic_learning.items ENABLE ROW LEVEL SECURITY;
ALTER TABLE synthetic_learning.completions ENABLE ROW LEVEL SECURITY;
ALTER TABLE synthetic_learning.feedback ENABLE ROW LEVEL SECURITY;
ALTER TABLE synthetic_learning.resources ENABLE ROW LEVEL SECURITY;
REVOKE ALL ON ALL TABLES IN SCHEMA synthetic_learning FROM PUBLIC;
