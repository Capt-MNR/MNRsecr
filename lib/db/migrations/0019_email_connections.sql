CREATE TABLE IF NOT EXISTS "email_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "provider" text NOT NULL DEFAULT 'gmail',
  "email_address" text NOT NULL,
  "refresh_token_ciphertext" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_connections_owner_provider_unique"
  ON "email_connections" ("tenant_id", "owner_user_id", "provider");
CREATE INDEX IF NOT EXISTS "email_connections_email_idx"
  ON "email_connections" ("email_address");

CREATE TABLE IF NOT EXISTS "email_oauth_states" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "state_hash" text NOT NULL,
  "code_verifier_ciphertext" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "email_oauth_states_hash_unique"
  ON "email_oauth_states" ("state_hash");
CREATE INDEX IF NOT EXISTS "email_oauth_states_expiry_idx"
  ON "email_oauth_states" ("expires_at");
CREATE INDEX IF NOT EXISTS "email_oauth_states_owner_idx"
  ON "email_oauth_states" ("tenant_id", "owner_user_id");