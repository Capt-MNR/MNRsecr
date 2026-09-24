ALTER TABLE "second_brain_memories"
  ADD COLUMN IF NOT EXISTS "source_kind" text NOT NULL DEFAULT 'legacy_unknown',
  ADD COLUMN IF NOT EXISTS "revision" integer NOT NULL DEFAULT 1,
  ADD COLUMN IF NOT EXISTS "expires_at" timestamp with time zone;

CREATE TABLE IF NOT EXISTS "second_brain_memory_history" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "memory_id" uuid NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "kind" text NOT NULL,
  "key" text NOT NULL,
  "value" text NOT NULL,
  "normalized_value" text NOT NULL,
  "confidence_bps" integer NOT NULL,
  "temporal_state" text NOT NULL,
  "source_kind" text NOT NULL,
  "revision" integer NOT NULL,
  "source_conversation_id" text,
  "source_turn_id" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_confirmed_at" timestamp with time zone,
  "source_created_at" timestamp with time zone NOT NULL,
  "source_updated_at" timestamp with time zone NOT NULL,
  "valid_from" timestamp with time zone NOT NULL,
  "valid_to" timestamp with time zone,
  "expires_at" timestamp with time zone,
  "transitioned_at" timestamp with time zone NOT NULL DEFAULT now(),
  "recorded_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "second_brain_memory_history_state_check"
    CHECK ("temporal_state" IN ('superseded', 'expired', 'archived', 'conflict'))
);

CREATE INDEX IF NOT EXISTS "second_brain_memory_history_owner_recorded_idx"
  ON "second_brain_memory_history" ("tenant_id", "owner_user_id", "recorded_at");
CREATE INDEX IF NOT EXISTS "second_brain_memory_history_owner_memory_idx"
  ON "second_brain_memory_history" ("tenant_id", "owner_user_id", "memory_id", "recorded_at");
CREATE UNIQUE INDEX IF NOT EXISTS "second_brain_memory_history_source_version_unique"
  ON "second_brain_memory_history" (
    "tenant_id",
    "owner_user_id",
    "memory_id",
    "source_turn_id",
    "kind",
    "key",
    "revision",
    "temporal_state",
    "normalized_value"
  )
  WHERE "source_turn_id" IS NOT NULL;