-- Phase 1 is an additive expansion of the legacy push-managed schema.
-- Every statement is safe to run against an existing development database.

CREATE TABLE IF NOT EXISTS "purposes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "name" text NOT NULL,
  "name_key" text NOT NULL,
  "description" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "row_version" integer DEFAULT 1 NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "purposes_owner_name_key_unique"
  ON "purposes" ("tenant_id", "owner_user_id", "name_key");

ALTER TABLE "people"
  ADD COLUMN IF NOT EXISTS "row_version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "projects"
  ADD COLUMN IF NOT EXISTS "row_version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "purpose_id" uuid;
ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "expenses"
  ADD COLUMN IF NOT EXISTS "row_version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "reminders"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "reminders"
  ADD COLUMN IF NOT EXISTS "row_version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "tasks"
  ADD COLUMN IF NOT EXISTS "row_version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "project_people"
  ADD COLUMN IF NOT EXISTS "row_version" integer DEFAULT 1 NOT NULL;
ALTER TABLE "commitments"
  ADD COLUMN IF NOT EXISTS "updated_at" timestamp with time zone DEFAULT now() NOT NULL;
ALTER TABLE "commitments"
  ADD COLUMN IF NOT EXISTS "row_version" integer DEFAULT 1 NOT NULL;

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'expenses_purpose_id_purposes_id_fk'
  ) THEN
    ALTER TABLE "expenses"
      ADD CONSTRAINT "expenses_purpose_id_purposes_id_fk"
      FOREIGN KEY ("purpose_id") REFERENCES "purposes"("id");
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "people_owner_id_unique"
  ON "people" ("tenant_id", "owner_user_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "projects_owner_id_unique"
  ON "projects" ("tenant_id", "owner_user_id", "id");
CREATE UNIQUE INDEX IF NOT EXISTS "purposes_owner_id_unique"
  ON "purposes" ("tenant_id", "owner_user_id", "id");

CREATE TABLE IF NOT EXISTS "activity_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "event_type" text NOT NULL,
  "source_type" text NOT NULL,
  "source_id" uuid,
  "actor_type" text DEFAULT 'user' NOT NULL,
  "actor_id" text,
  "summary" text NOT NULL,
  "metadata" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "activity_events_owner_occurred_idx"
  ON "activity_events" ("tenant_id", "owner_user_id", "occurred_at");
CREATE INDEX IF NOT EXISTS "activity_events_owner_source_idx"
  ON "activity_events" ("tenant_id", "owner_user_id", "source_type", "source_id");

CREATE TABLE IF NOT EXISTS "activity_event_entities" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "event_id" uuid NOT NULL,
  "entity_type" text NOT NULL,
  "entity_id" uuid NOT NULL,
  "role" text DEFAULT 'related' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);

DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_constraint WHERE conname = 'activity_event_entities_event_id_activity_events_id_fk'
  ) THEN
    ALTER TABLE "activity_event_entities"
      ADD CONSTRAINT "activity_event_entities_event_id_activity_events_id_fk"
      FOREIGN KEY ("event_id") REFERENCES "activity_events"("id") ON DELETE CASCADE;
  END IF;
END $$;

CREATE UNIQUE INDEX IF NOT EXISTS "activity_event_entities_owner_event_entity_unique"
  ON "activity_event_entities" (
    "tenant_id", "owner_user_id", "event_id", "entity_type", "entity_id", "role"
  );
CREATE INDEX IF NOT EXISTS "activity_event_entities_owner_entity_idx"
  ON "activity_event_entities" (
    "tenant_id", "owner_user_id", "entity_type", "entity_id", "created_at"
  );