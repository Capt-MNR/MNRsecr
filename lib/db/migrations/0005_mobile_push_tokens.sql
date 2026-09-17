CREATE TABLE IF NOT EXISTS "mobile_push_tokens" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "token" text NOT NULL,
  "provider" text DEFAULT 'expo' NOT NULL,
  "platform" text NOT NULL,
  "app_id" text NOT NULL,
  "device_id" text,
  "enabled" integer DEFAULT 1 NOT NULL,
  "last_seen_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

CREATE UNIQUE INDEX IF NOT EXISTS "mobile_push_tokens_owner_token_unique"
  ON "mobile_push_tokens" ("tenant_id", "owner_user_id", "token");
CREATE INDEX IF NOT EXISTS "mobile_push_tokens_owner_enabled_idx"
  ON "mobile_push_tokens" ("tenant_id", "owner_user_id", "enabled");