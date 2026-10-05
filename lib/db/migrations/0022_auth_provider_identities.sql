CREATE TABLE IF NOT EXISTS auth_external_identities (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id text NOT NULL,
  owner_user_id text NOT NULL,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  provider_subject text NOT NULL,
  email_address text,
  created_at timestamptz NOT NULL DEFAULT now(),
  last_used_at timestamptz NOT NULL DEFAULT now()
);

CREATE UNIQUE INDEX IF NOT EXISTS auth_external_identities_provider_subject_unique
  ON auth_external_identities (provider, provider_subject);
CREATE UNIQUE INDEX IF NOT EXISTS auth_external_identities_owner_provider_unique
  ON auth_external_identities (tenant_id, owner_user_id, provider);
CREATE INDEX IF NOT EXISTS auth_external_identities_owner_idx
  ON auth_external_identities (tenant_id, owner_user_id);

CREATE TABLE IF NOT EXISTS auth_external_oauth_states (
  id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  state_hash text NOT NULL UNIQUE,
  provider text NOT NULL CHECK (provider IN ('google', 'microsoft')),
  mode text NOT NULL CHECK (mode IN ('login', 'link')),
  client text NOT NULL CHECK (client IN ('web', 'mobile')),
  tenant_id text,
  owner_user_id text,
  return_to text NOT NULL,
  code_verifier_ciphertext text NOT NULL,
  expires_at timestamptz NOT NULL,
  consumed_at timestamptz,
  ticket_hash text UNIQUE,
  ticket_expires_at timestamptz,
  ticket_consumed_at timestamptz,
  resolved_tenant_id text,
  resolved_user_id text,
  created_at timestamptz NOT NULL DEFAULT now(),
  CHECK ((mode = 'login' AND tenant_id IS NULL AND owner_user_id IS NULL)
    OR (mode = 'link' AND tenant_id IS NOT NULL AND owner_user_id IS NOT NULL))
);

CREATE INDEX IF NOT EXISTS auth_external_oauth_states_expiry_idx
  ON auth_external_oauth_states (expires_at);
