-- Phase 2 Financial Graph is additive. No legacy rows are rewritten or deleted.

CREATE TABLE IF NOT EXISTS "financial_parties" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "party_type" text NOT NULL,
  "name" text NOT NULL,
  "name_key" text NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "row_version" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "financial_parties_party_type_check"
    CHECK ("party_type" IN ('person', 'project', 'organization', 'external'))
);
CREATE INDEX IF NOT EXISTS "financial_parties_owner_name_key_idx"
  ON "financial_parties" ("tenant_id", "owner_user_id", "name_key");

CREATE TABLE IF NOT EXISTS "financial_party_people" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "party_id" uuid NOT NULL REFERENCES "financial_parties"("id"),
  "person_id" uuid NOT NULL REFERENCES "people"("id"),
  "relationship" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "financial_party_people_owner_pair_unique"
  ON "financial_party_people" ("tenant_id", "owner_user_id", "party_id", "person_id");

CREATE TABLE IF NOT EXISTS "financial_party_projects" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "party_id" uuid NOT NULL REFERENCES "financial_parties"("id"),
  "project_id" uuid NOT NULL REFERENCES "projects"("id"),
  "relationship" text,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "financial_party_projects_owner_pair_unique"
  ON "financial_party_projects" ("tenant_id", "owner_user_id", "party_id", "project_id");

CREATE TABLE IF NOT EXISTS "financial_party_purposes" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "party_id" uuid NOT NULL REFERENCES "financial_parties"("id"),
  "purpose_id" uuid NOT NULL REFERENCES "purposes"("id"),
  "created_at" timestamp with time zone DEFAULT now() NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS "financial_party_purposes_owner_pair_unique"
  ON "financial_party_purposes" ("tenant_id", "owner_user_id", "party_id", "purpose_id");

CREATE TABLE IF NOT EXISTS "financial_obligations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "lender_party_id" uuid NOT NULL REFERENCES "financial_parties"("id"),
  "borrower_party_id" uuid NOT NULL REFERENCES "financial_parties"("id"),
  "principal_amount_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "purpose_id" uuid REFERENCES "purposes"("id"),
  "project_id" uuid REFERENCES "projects"("id"),
  "due_at" timestamp with time zone,
  "status" text DEFAULT 'open' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "row_version" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "financial_obligations_kind_check" CHECK ("kind" IN ('advance', 'debt')),
  CONSTRAINT "financial_obligations_amount_check" CHECK ("principal_amount_minor" > 0),
  CONSTRAINT "financial_obligations_direction_check" CHECK ("lender_party_id" <> "borrower_party_id")
);
CREATE INDEX IF NOT EXISTS "financial_obligations_owner_status_idx"
  ON "financial_obligations" ("tenant_id", "owner_user_id", "status");
CREATE INDEX IF NOT EXISTS "financial_obligations_owner_due_idx"
  ON "financial_obligations" ("tenant_id", "owner_user_id", "due_at");

CREATE TABLE IF NOT EXISTS "financial_payments" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "payment_kind" text DEFAULT 'general' NOT NULL,
  "payer_party_id" uuid NOT NULL REFERENCES "financial_parties"("id"),
  "payee_party_id" uuid NOT NULL REFERENCES "financial_parties"("id"),
  "amount_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "description" text,
  "occurred_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "row_version" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "financial_payments_amount_check" CHECK ("amount_minor" > 0),
  CONSTRAINT "financial_payments_direction_check" CHECK ("payer_party_id" <> "payee_party_id")
);
CREATE INDEX IF NOT EXISTS "financial_payments_owner_occurred_idx"
  ON "financial_payments" ("tenant_id", "owner_user_id", "occurred_at");

CREATE TABLE IF NOT EXISTS "obligation_settlements" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "obligation_id" uuid NOT NULL REFERENCES "financial_obligations"("id"),
  "payment_id" uuid NOT NULL REFERENCES "financial_payments"("id"),
  "amount_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "settled_at" timestamp with time zone DEFAULT now() NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "obligation_settlements_amount_check" CHECK ("amount_minor" > 0)
);
CREATE INDEX IF NOT EXISTS "obligation_settlements_owner_obligation_idx"
  ON "obligation_settlements" ("tenant_id", "owner_user_id", "obligation_id", "settled_at");
CREATE UNIQUE INDEX IF NOT EXISTS "obligation_settlements_owner_payment_unique"
  ON "obligation_settlements" ("tenant_id", "owner_user_id", "obligation_id", "payment_id");

CREATE TABLE IF NOT EXISTS "donations" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "donor_party_id" uuid NOT NULL REFERENCES "financial_parties"("id"),
  "recipient_party_id" uuid NOT NULL REFERENCES "financial_parties"("id"),
  "amount_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "purpose_id" uuid REFERENCES "purposes"("id"),
  "project_id" uuid REFERENCES "projects"("id"),
  "description" text,
  "status" text DEFAULT 'pledged' NOT NULL,
  "pledged_at" timestamp with time zone DEFAULT now() NOT NULL,
  "paid_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "row_version" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "donations_amount_check" CHECK ("amount_minor" > 0),
  CONSTRAINT "donations_direction_check" CHECK ("donor_party_id" <> "recipient_party_id")
);
CREATE INDEX IF NOT EXISTS "donations_owner_status_idx"
  ON "donations" ("tenant_id", "owner_user_id", "status");

CREATE TABLE IF NOT EXISTS "income_receivables" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "kind" text NOT NULL,
  "title" text NOT NULL,
  "creditor_party_id" uuid NOT NULL REFERENCES "financial_parties"("id"),
  "debtor_party_id" uuid NOT NULL REFERENCES "financial_parties"("id"),
  "amount_minor" bigint NOT NULL,
  "currency" text NOT NULL,
  "purpose_id" uuid REFERENCES "purposes"("id"),
  "project_id" uuid REFERENCES "projects"("id"),
  "due_at" timestamp with time zone,
  "status" text DEFAULT 'open' NOT NULL,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  "row_version" integer DEFAULT 1 NOT NULL,
  CONSTRAINT "income_receivables_kind_check" CHECK ("kind" IN ('income', 'receivable')),
  CONSTRAINT "income_receivables_amount_check" CHECK ("amount_minor" > 0),
  CONSTRAINT "income_receivables_direction_check" CHECK ("creditor_party_id" <> "debtor_party_id")
);
CREATE INDEX IF NOT EXISTS "income_receivables_owner_status_idx"
  ON "income_receivables" ("tenant_id", "owner_user_id", "status");

CREATE TABLE IF NOT EXISTS "payment_links" (
  "id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
  "tenant_id" text NOT NULL,
  "owner_user_id" text NOT NULL,
  "token" text NOT NULL,
  "payment_id" uuid REFERENCES "financial_payments"("id"),
  "receivable_id" uuid REFERENCES "income_receivables"("id"),
  "donation_id" uuid REFERENCES "donations"("id"),
  "provider" text DEFAULT 'internal' NOT NULL,
  "status" text DEFAULT 'active' NOT NULL,
  "expires_at" timestamp with time zone,
  "created_at" timestamp with time zone DEFAULT now() NOT NULL,
  "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
  CONSTRAINT "payment_links_one_target_check" CHECK (
    (CASE WHEN "payment_id" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "receivable_id" IS NOT NULL THEN 1 ELSE 0 END) +
    (CASE WHEN "donation_id" IS NOT NULL THEN 1 ELSE 0 END) = 1
  )
);
CREATE UNIQUE INDEX IF NOT EXISTS "payment_links_owner_token_unique"
  ON "payment_links" ("tenant_id", "owner_user_id", "token");
CREATE INDEX IF NOT EXISTS "payment_links_owner_status_idx"
  ON "payment_links" ("tenant_id", "owner_user_id", "status");