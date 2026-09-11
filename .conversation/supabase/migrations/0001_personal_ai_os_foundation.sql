-- Future Postgres/Supabase schema boundary.
-- The active development adapter is SQLite behind the same application
-- service boundary. No application code depends on this migration yet.

create table if not exists people (
  id uuid primary key,
  tenant_id uuid not null,
  user_id uuid not null,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists projects (
  id uuid primary key,
  tenant_id uuid not null,
  user_id uuid not null,
  name text not null,
  created_at timestamptz not null default now()
);

create table if not exists expenses (
  id uuid primary key,
  tenant_id uuid not null,
  user_id uuid not null,
  amount_minor bigint not null check (amount_minor >= 0),
  currency text not null,
  description text not null,
  person_id uuid references people(id),
  project_id uuid references projects(id),
  occurred_at timestamptz not null,
  created_at timestamptz not null default now()
);

create table if not exists reminders (
  id uuid primary key,
  tenant_id uuid not null,
  user_id uuid not null,
  text text not null,
  due_at timestamptz not null,
  timezone text not null,
  status text not null check (status in ('pending', 'claimed', 'delivered', 'cancelled')),
  created_at timestamptz not null default now()
);

create unique index if not exists people_owner_name_idx
  on people (tenant_id, user_id, lower(name));

create unique index if not exists projects_owner_name_idx
  on projects (tenant_id, user_id, lower(name));

-- RLS policies and the remaining domain tables are intentionally added only
-- when the production Supabase adapter is introduced.
