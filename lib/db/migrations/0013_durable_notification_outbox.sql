CREATE TABLE IF NOT EXISTS "notification_outbox" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "work_id" uuid,
  "run_id" uuid,
  "source_event_id" uuid,
  "operation_id" text,
  "dedupe_key" text NOT NULL,
  "title" text NOT NULL,
  "body" text NOT NULL,
  "data" jsonb DEFAULT '{}'::jsonb NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_outbox_owner_dedupe_unique"
  ON "notification_outbox" ("tenant_id", "owner_user_id", "dedupe_key");
CREATE INDEX IF NOT EXISTS "notification_outbox_status_next_attempt_idx"
  ON "notification_outbox" ("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "notification_outbox_owner_created_idx"
  ON "notification_outbox" ("tenant_id", "owner_user_id", "created_at");

CREATE TABLE IF NOT EXISTS "notification_deliveries" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "notification_id" uuid NOT NULL REFERENCES "notification_outbox"("id") ON DELETE CASCADE,
  "token_id" uuid NOT NULL REFERENCES "mobile_push_tokens"("id"),
  "provider" text NOT NULL,
  "status" text DEFAULT 'queued' NOT NULL,
  "attempt_count" integer DEFAULT 0 NOT NULL,
  "next_attempt_at" timestamp with time zone DEFAULT now() NOT NULL,
  "lease_token" text,
  "lease_expires_at" timestamp with time zone,
  "provider_ticket" text,
  "last_error_class" text,
  "last_error" text,
  "submitted_at" timestamp with time zone,
  "confirmed_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_deliveries_owner_notification_token_unique"
  ON "notification_deliveries" ("tenant_id", "owner_user_id", "notification_id", "token_id");
CREATE INDEX IF NOT EXISTS "notification_deliveries_status_next_attempt_idx"
  ON "notification_deliveries" ("status", "next_attempt_at");
CREATE INDEX IF NOT EXISTS "notification_deliveries_notification_idx"
  ON "notification_deliveries" ("notification_id");

CREATE TABLE IF NOT EXISTS "notification_delivery_attempts" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "delivery_id" uuid NOT NULL REFERENCES "notification_deliveries"("id") ON DELETE CASCADE,
  "attempt_number" integer NOT NULL,
  "status" text NOT NULL,
  "provider_request_id" text,
  "error_class" text,
  "error" text,
  "started_at" timestamp with time zone DEFAULT now() NOT NULL,
  "completed_at" timestamp with time zone
);

CREATE UNIQUE INDEX IF NOT EXISTS "notification_delivery_attempts_delivery_number_unique"
  ON "notification_delivery_attempts" ("delivery_id", "attempt_number");
CREATE INDEX IF NOT EXISTS "notification_delivery_attempts_delivery_idx"
  ON "notification_delivery_attempts" ("delivery_id");