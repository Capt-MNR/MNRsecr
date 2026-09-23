CREATE TABLE IF NOT EXISTS "auth_users" (
  "id" text PRIMARY KEY NOT NULL,
  "email" text NOT NULL,
  "password_hash" text NOT NULL,
  "disabled" boolean NOT NULL DEFAULT false,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "updated_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "auth_users_email_unique" ON "auth_users" ("email");

CREATE TABLE IF NOT EXISTS "auth_tenants" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS "auth_memberships" (
  "tenant_id" text NOT NULL,
  "user_id" text NOT NULL,
  "role" text NOT NULL DEFAULT 'owner',
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  CONSTRAINT "auth_memberships_tenant_user_unique" UNIQUE ("tenant_id", "user_id")
);
CREATE INDEX IF NOT EXISTS "auth_memberships_user_idx" ON "auth_memberships" ("user_id");

CREATE TABLE IF NOT EXISTS "auth_sessions" (
  "id" text PRIMARY KEY NOT NULL,
  "user_id" text NOT NULL,
  "tenant_id" text NOT NULL,
  "access_token_hash" text NOT NULL,
  "refresh_token_hash" text NOT NULL,
  "access_expires_at" timestamp with time zone NOT NULL,
  "refresh_expires_at" timestamp with time zone NOT NULL,
  "revoked_at" timestamp with time zone,
  "created_at" timestamp with time zone NOT NULL DEFAULT now(),
  "last_seen_at" timestamp with time zone NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS "auth_sessions_access_hash_unique" ON "auth_sessions" ("access_token_hash");
CREATE UNIQUE INDEX IF NOT EXISTS "auth_sessions_refresh_hash_unique" ON "auth_sessions" ("refresh_token_hash");
CREATE INDEX IF NOT EXISTS "auth_sessions_user_idx" ON "auth_sessions" ("user_id", "revoked_at");

CREATE UNIQUE INDEX IF NOT EXISTS "mobile_push_tokens_token_unique" ON "mobile_push_tokens" ("token");