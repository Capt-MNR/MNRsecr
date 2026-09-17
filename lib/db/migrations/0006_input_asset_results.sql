CREATE TABLE IF NOT EXISTS "input_asset_results" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "input_id" text NOT NULL,
  "content_hash" text NOT NULL,
  "kind" text NOT NULL,
  "mime_type" text NOT NULL,
  "text" text NOT NULL,
  "receipt" jsonb,
  "provider" text NOT NULL,
  "model" text NOT NULL,
  "input_tokens" integer,
  "output_tokens" integer,
  "expires_at" timestamp with time zone NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "input_asset_results_owner_hash_unique"
  ON "input_asset_results" ("tenant_id", "owner_user_id", "content_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "input_asset_results_owner_input_unique"
  ON "input_asset_results" ("tenant_id", "owner_user_id", "input_id");
CREATE INDEX IF NOT EXISTS "input_asset_results_owner_expires_idx"
  ON "input_asset_results" ("tenant_id", "owner_user_id", "expires_at");