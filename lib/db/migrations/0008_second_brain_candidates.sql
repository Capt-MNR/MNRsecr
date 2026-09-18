CREATE TABLE IF NOT EXISTS "second_brain_candidates" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "kind" text NOT NULL,
  "key" text NOT NULL,
  "value" text NOT NULL,
  "normalized_value" text NOT NULL,
  "confidence_bps" integer NOT NULL,
  "status" text NOT NULL DEFAULT 'pending_review',
  "source_conversation_id" text,
  "source_turn_id" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "reviewer_note" text,
  "promoted_memory_id" uuid,
  "reviewed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "second_brain_candidates_owner_status_updated_idx"
  ON "second_brain_candidates" ("tenant_id", "owner_user_id", "status", "updated_at");
CREATE INDEX IF NOT EXISTS "second_brain_candidates_owner_source_idx"
  ON "second_brain_candidates" ("tenant_id", "owner_user_id", "source_conversation_id", "source_turn_id");