CREATE TABLE IF NOT EXISTS "second_brain_memories" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "kind" text NOT NULL,
  "key" text NOT NULL,
  "value" text NOT NULL,
  "normalized_value" text NOT NULL,
  "confidence_bps" integer NOT NULL DEFAULT 10000,
  "status" text NOT NULL DEFAULT 'active',
  "source_conversation_id" text,
  "source_turn_id" text,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "last_confirmed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "second_brain_memories_owner_kind_key_unique"
  ON "second_brain_memories" ("tenant_id", "owner_user_id", "kind", "key");
CREATE INDEX IF NOT EXISTS "second_brain_memories_owner_status_updated_idx"
  ON "second_brain_memories" ("tenant_id", "owner_user_id", "status", "updated_at");
CREATE INDEX IF NOT EXISTS "second_brain_memories_owner_normalized_value_idx"
  ON "second_brain_memories" ("tenant_id", "owner_user_id", "normalized_value");