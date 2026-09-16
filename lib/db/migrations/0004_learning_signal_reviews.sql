-- Review-only correction signals. This table never drives production mutations.
CREATE TABLE IF NOT EXISTS "learning_signal_reviews" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "signal_id" text NOT NULL,
  "conversation_id" text NOT NULL,
  "turn_id" text,
  "category" text NOT NULL,
  "confidence_bps" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'pending_review',
  "reviewer_note" text,
  "benchmark_payload" jsonb NOT NULL,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "learning_signal_reviews_owner_signal_unique"
  ON "learning_signal_reviews" ("tenant_id", "owner_user_id", "signal_id");

CREATE INDEX IF NOT EXISTS "learning_signal_reviews_owner_status_updated_idx"
  ON "learning_signal_reviews" ("tenant_id", "owner_user_id", "status", "updated_at");