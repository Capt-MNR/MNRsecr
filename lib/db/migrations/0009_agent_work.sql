-- Durable Agent Work state. All rows are tenant/user scoped.
CREATE TABLE IF NOT EXISTS "agent_works" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "description" text,
  "status" text NOT NULL DEFAULT 'draft',
  "source" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "condition" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "schedule" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "next_run_at" timestamp with time zone,
  "last_run_at" timestamp with time zone,
  "last_run_status" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "row_version" integer NOT NULL DEFAULT 1
);

CREATE INDEX IF NOT EXISTS "agent_works_owner_status_next_run_idx"
  ON "agent_works" ("tenant_id", "owner_user_id", "status", "next_run_at");
CREATE INDEX IF NOT EXISTS "agent_works_owner_updated_idx"
  ON "agent_works" ("tenant_id", "owner_user_id", "updated_at");

CREATE TABLE IF NOT EXISTS "agent_work_runs" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "work_id" uuid NOT NULL REFERENCES "agent_works"("id"),
  "attempt" integer NOT NULL DEFAULT 1,
  "status" text NOT NULL DEFAULT 'queued',
  "idempotency_key" text NOT NULL,
  "lease_token" text,
  "lease_expires_at" timestamp with time zone,
  "started_at" timestamp with time zone,
  "completed_at" timestamp with time zone,
  "verification" jsonb,
  "error" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_work_runs_owner_idempotency_unique"
  ON "agent_work_runs" ("tenant_id", "owner_user_id", "idempotency_key");
CREATE UNIQUE INDEX IF NOT EXISTS "agent_work_runs_owner_attempt_unique"
  ON "agent_work_runs" ("tenant_id", "owner_user_id", "work_id", "attempt");
CREATE INDEX IF NOT EXISTS "agent_work_runs_owner_work_created_idx"
  ON "agent_work_runs" ("tenant_id", "owner_user_id", "work_id", "created_at");
CREATE INDEX IF NOT EXISTS "agent_work_runs_lease_idx"
  ON "agent_work_runs" ("status", "lease_expires_at");

CREATE TABLE IF NOT EXISTS "agent_work_events" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "work_id" uuid NOT NULL REFERENCES "agent_works"("id"),
  "run_id" uuid REFERENCES "agent_work_runs"("id"),
  "event_type" text NOT NULL,
  "actor_type" text NOT NULL DEFAULT 'agent',
  "actor_id" text,
  "summary" text NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "dedupe_key" text,
  "occurred_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_work_events_owner_dedupe_unique"
  ON "agent_work_events" ("tenant_id", "owner_user_id", "dedupe_key");
CREATE INDEX IF NOT EXISTS "agent_work_events_owner_work_occurred_idx"
  ON "agent_work_events" ("tenant_id", "owner_user_id", "work_id", "occurred_at");

CREATE TABLE IF NOT EXISTS "agent_work_evidence" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "work_id" uuid NOT NULL REFERENCES "agent_works"("id"),
  "run_id" uuid NOT NULL REFERENCES "agent_work_runs"("id"),
  "snapshot_hash" text NOT NULL,
  "snapshot" jsonb NOT NULL,
  "retention_class" text NOT NULL DEFAULT 'standard',
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "agent_work_evidence_owner_run_hash_unique"
  ON "agent_work_evidence" ("tenant_id", "owner_user_id", "run_id", "snapshot_hash");
CREATE INDEX IF NOT EXISTS "agent_work_evidence_owner_work_created_idx"
  ON "agent_work_evidence" ("tenant_id", "owner_user_id", "work_id", "created_at");