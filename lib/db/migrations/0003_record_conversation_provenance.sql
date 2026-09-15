-- Conversation provenance is additive. Existing records remain usable without a source.
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "source_conversation_id" text;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "source_turn_id" text;
ALTER TABLE "expenses" ADD COLUMN IF NOT EXISTS "source_operation_id" text;
ALTER TABLE "reminders" ADD COLUMN IF NOT EXISTS "source_conversation_id" text;
ALTER TABLE "reminders" ADD COLUMN IF NOT EXISTS "source_turn_id" text;
ALTER TABLE "reminders" ADD COLUMN IF NOT EXISTS "source_operation_id" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "source_conversation_id" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "source_turn_id" text;
ALTER TABLE "tasks" ADD COLUMN IF NOT EXISTS "source_operation_id" text;
ALTER TABLE "secretary_operations" ADD COLUMN IF NOT EXISTS "source_turn_id" text;

CREATE INDEX IF NOT EXISTS "expenses_owner_source_conversation_idx"
  ON "expenses" ("tenant_id", "owner_user_id", "source_conversation_id");
CREATE INDEX IF NOT EXISTS "reminders_owner_source_conversation_idx"
  ON "reminders" ("tenant_id", "owner_user_id", "source_conversation_id");
CREATE INDEX IF NOT EXISTS "tasks_owner_source_conversation_idx"
  ON "tasks" ("tenant_id", "owner_user_id", "source_conversation_id");