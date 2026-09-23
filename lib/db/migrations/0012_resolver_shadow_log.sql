-- Resolver shadow evaluation is owned by the database migration history.
-- The API must not create application tables at request time.
CREATE TABLE IF NOT EXISTS "resolver_shadow_log" (
  "id" bigserial PRIMARY KEY,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "entity_type" text NOT NULL,
  "query_text" text NOT NULL,
  "candidate_count" integer NOT NULL,
  "selected_id" uuid,
  "confidence" double precision,
  "match_type" text NOT NULL,
  "would_change" boolean NOT NULL,
  "metadata" jsonb NOT NULL DEFAULT '{}'::jsonb,
  "created_at" timestamp with time zone NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "resolver_shadow_log_owner_created_idx"
  ON "resolver_shadow_log" ("tenant_id", "owner_user_id", "created_at");