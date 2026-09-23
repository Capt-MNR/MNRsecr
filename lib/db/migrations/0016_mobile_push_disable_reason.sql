ALTER TABLE "mobile_push_tokens"
  ADD COLUMN IF NOT EXISTS "disabled_reason" text;