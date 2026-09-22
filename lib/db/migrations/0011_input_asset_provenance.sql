CREATE TABLE IF NOT EXISTS "input_asset_provenance" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "input_id" text NOT NULL,
  "conversation_id" text NOT NULL,
  "turn_id" text NOT NULL,
  "operation_id" text,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "input_asset_provenance_owner_input_turn_unique"
  ON "input_asset_provenance" (
    "tenant_id",
    "owner_user_id",
    "input_id",
    "turn_id"
  );
CREATE INDEX IF NOT EXISTS "input_asset_provenance_owner_conversation_idx"
  ON "input_asset_provenance" (
    "tenant_id",
    "owner_user_id",
    "conversation_id"
  );