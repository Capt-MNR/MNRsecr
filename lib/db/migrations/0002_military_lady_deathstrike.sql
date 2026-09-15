-- Phase 3 Typed Relationships is additive. Existing tables and rows are untouched.

CREATE TABLE IF NOT EXISTS "task_people" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "tasks"("id"),
  "person_id" uuid NOT NULL REFERENCES "people"("id"),
  "relationship" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "row_version" integer DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "task_people_owner_pair_unique"
  ON "task_people" ("tenant_id", "owner_user_id", "task_id", "person_id");
CREATE INDEX IF NOT EXISTS "task_people_owner_person_idx"
  ON "task_people" ("tenant_id", "owner_user_id", "person_id");

CREATE TABLE IF NOT EXISTS "task_projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "tasks"("id"),
  "project_id" uuid NOT NULL REFERENCES "projects"("id"),
  "relationship" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "row_version" integer DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "task_projects_owner_pair_unique"
  ON "task_projects" ("tenant_id", "owner_user_id", "task_id", "project_id");
CREATE INDEX IF NOT EXISTS "task_projects_owner_project_idx"
  ON "task_projects" ("tenant_id", "owner_user_id", "project_id");

CREATE TABLE IF NOT EXISTS "task_purposes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "task_id" uuid NOT NULL REFERENCES "tasks"("id"),
  "purpose_id" uuid NOT NULL REFERENCES "purposes"("id"),
  "relationship" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "row_version" integer DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "task_purposes_owner_pair_unique"
  ON "task_purposes" ("tenant_id", "owner_user_id", "task_id", "purpose_id");
CREATE INDEX IF NOT EXISTS "task_purposes_owner_purpose_idx"
  ON "task_purposes" ("tenant_id", "owner_user_id", "purpose_id");

CREATE TABLE IF NOT EXISTS "reminder_people" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "reminder_id" uuid NOT NULL REFERENCES "reminders"("id"),
  "person_id" uuid NOT NULL REFERENCES "people"("id"),
  "relationship" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "row_version" integer DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "reminder_people_owner_pair_unique"
  ON "reminder_people" ("tenant_id", "owner_user_id", "reminder_id", "person_id");

CREATE TABLE IF NOT EXISTS "reminder_projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "reminder_id" uuid NOT NULL REFERENCES "reminders"("id"),
  "project_id" uuid NOT NULL REFERENCES "projects"("id"),
  "relationship" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "row_version" integer DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "reminder_projects_owner_pair_unique"
  ON "reminder_projects" ("tenant_id", "owner_user_id", "reminder_id", "project_id");

CREATE TABLE IF NOT EXISTS "reminder_tasks" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "reminder_id" uuid NOT NULL REFERENCES "reminders"("id"),
  "task_id" uuid NOT NULL REFERENCES "tasks"("id"),
  "relationship" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "row_version" integer DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "reminder_tasks_owner_pair_unique"
  ON "reminder_tasks" ("tenant_id", "owner_user_id", "reminder_id", "task_id");

CREATE TABLE IF NOT EXISTS "commitment_people" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "commitment_id" uuid NOT NULL REFERENCES "commitments"("id"),
  "person_id" uuid NOT NULL REFERENCES "people"("id"),
  "relationship" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "row_version" integer DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "commitment_people_owner_pair_unique"
  ON "commitment_people" ("tenant_id", "owner_user_id", "commitment_id", "person_id");

CREATE TABLE IF NOT EXISTS "commitment_projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "commitment_id" uuid NOT NULL REFERENCES "commitments"("id"),
  "project_id" uuid NOT NULL REFERENCES "projects"("id"),
  "relationship" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "row_version" integer DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "commitment_projects_owner_pair_unique"
  ON "commitment_projects" ("tenant_id", "owner_user_id", "commitment_id", "project_id");

CREATE TABLE IF NOT EXISTS "commitment_purposes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "commitment_id" uuid NOT NULL REFERENCES "commitments"("id"),
  "purpose_id" uuid NOT NULL REFERENCES "purposes"("id"),
  "relationship" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "row_version" integer DEFAULT 1 NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "commitment_purposes_owner_pair_unique"
  ON "commitment_purposes" ("tenant_id", "owner_user_id", "commitment_id", "purpose_id");