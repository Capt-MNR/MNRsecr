CREATE TABLE IF NOT EXISTS "google_calendar_connections" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "email_address" text NOT NULL,
  "granted_scopes" text[] NOT NULL,
  "refresh_token_ciphertext" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "google_calendar_connections_owner_unique"
  ON "google_calendar_connections" ("tenant_id", "owner_user_id");
CREATE INDEX IF NOT EXISTS "google_calendar_connections_email_idx"
  ON "google_calendar_connections" ("email_address");

CREATE TABLE IF NOT EXISTS "google_calendar_oauth_states" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "state_hash" text NOT NULL,
  "code_verifier_ciphertext" text NOT NULL,
  "expires_at" timestamp with time zone NOT NULL,
  "consumed_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS "google_calendar_oauth_states_hash_unique"
  ON "google_calendar_oauth_states" ("state_hash");
CREATE INDEX IF NOT EXISTS "google_calendar_oauth_states_expiry_idx"
  ON "google_calendar_oauth_states" ("expires_at");
CREATE INDEX IF NOT EXISTS "google_calendar_oauth_states_owner_idx"
  ON "google_calendar_oauth_states" ("tenant_id", "owner_user_id");