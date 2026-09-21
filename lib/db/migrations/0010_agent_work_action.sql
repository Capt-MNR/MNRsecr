ALTER TABLE "agent_works"
  ADD COLUMN IF NOT EXISTS "action" jsonb NOT NULL DEFAULT '{}'::jsonb;