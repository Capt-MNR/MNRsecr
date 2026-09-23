ALTER TABLE "agent_works"
  ADD COLUMN IF NOT EXISTS "dedupe_key" text;

CREATE UNIQUE INDEX IF NOT EXISTS "agent_works_owner_dedupe_unique"
  ON "agent_works" ("tenant_id", "owner_user_id", "dedupe_key");

CREATE TABLE IF NOT EXISTS "trigger_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "event_type" text NOT NULL,
  "aggregate_type" text NOT NULL,
  "aggregate_id" text NOT NULL,
  "schema_version" integer NOT NULL DEFAULT 1,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  "payload" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "dedupe_key" text NOT NULL,
  "status" text NOT NULL DEFAULT 'pending',
  "attempt_count" integer NOT NULL DEFAULT 0,
  "available_at" timestamp with time zone NOT NULL DEFAULT now(),
  "lease_token" text,
  "lease_expires_at" timestamp with time zone,
  "last_error" text,
  "processed_at" timestamp with time zone,
  "quarantined_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "trigger_outbox_owner_dedupe_unique"
  ON "trigger_outbox" ("tenant_id", "owner_user_id", "dedupe_key");
CREATE INDEX IF NOT EXISTS "trigger_outbox_status_available_idx"
  ON "trigger_outbox" ("status", "available_at");
CREATE INDEX IF NOT EXISTS "trigger_outbox_lease_idx"
  ON "trigger_outbox" ("status", "lease_expires_at");
CREATE INDEX IF NOT EXISTS "trigger_outbox_owner_occurred_idx"
  ON "trigger_outbox" ("tenant_id", "owner_user_id", "occurred_at");