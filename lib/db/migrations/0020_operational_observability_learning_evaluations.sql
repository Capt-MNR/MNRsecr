CREATE TABLE IF NOT EXISTS "learning_signal_evaluations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "review_id" uuid NOT NULL REFERENCES "learning_signal_reviews"("id"),
  "signal_id" text NOT NULL,
  "reviewed_at" timestamp with time zone NOT NULL,
  "candidate_hash" text NOT NULL,
  "evaluator_version" text NOT NULL,
  "status" text NOT NULL,
  "checks" jsonb NOT NULL,
  "evaluated_at" timestamp with time zone NOT NULL DEFAULT now(),
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS "learning_signal_evaluations_owner_signal_time_idx"
  ON "learning_signal_evaluations" ("tenant_id", "owner_user_id", "signal_id", "evaluated_at");
CREATE INDEX IF NOT EXISTS "learning_signal_evaluations_owner_review_idx"
  ON "learning_signal_evaluations" ("tenant_id", "owner_user_id", "review_id", "evaluated_at");

CREATE TABLE IF NOT EXISTS "operational_provider_failures" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "request_id" text NOT NULL,
  "conversation_id" text,
  "logical_call_number" integer NOT NULL,
  "attempt_number" integer NOT NULL,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "route_id" text NOT NULL,
  "failure_reason" text,
  "latency_ms" integer NOT NULL,
  "started_at" timestamp with time zone NOT NULL,
  "completed_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "operational_provider_failures_attempt_unique"
  ON "operational_provider_failures" (
    "tenant_id", "owner_user_id", "request_id", "logical_call_number", "attempt_number"
  );
CREATE INDEX IF NOT EXISTS "operational_provider_failures_owner_completed_idx"
  ON "operational_provider_failures" ("tenant_id", "owner_user_id", "completed_at");

CREATE INDEX IF NOT EXISTS "trigger_outbox_owner_processed_idx"
  ON "trigger_outbox" ("tenant_id", "owner_user_id", "processed_at");
CREATE INDEX IF NOT EXISTS "trigger_outbox_owner_quarantined_idx"
  ON "trigger_outbox" ("tenant_id", "owner_user_id", "quarantined_at");
CREATE INDEX IF NOT EXISTS "notification_deliveries_owner_confirmed_idx"
  ON "notification_deliveries" ("tenant_id", "owner_user_id", "confirmed_at");
CREATE INDEX IF NOT EXISTS "notification_delivery_attempts_owner_started_idx"
  ON "notification_delivery_attempts" ("tenant_id", "owner_user_id", "started_at");
CREATE INDEX IF NOT EXISTS "agent_works_owner_created_idx"
  ON "agent_works" ("tenant_id", "owner_user_id", "created_at");
CREATE INDEX IF NOT EXISTS "agent_work_runs_owner_completed_idx"
  ON "agent_work_runs" ("tenant_id", "owner_user_id", "completed_at");
CREATE INDEX IF NOT EXISTS "agent_work_events_owner_type_occurred_idx"
  ON "agent_work_events" ("tenant_id", "owner_user_id", "event_type", "occurred_at");