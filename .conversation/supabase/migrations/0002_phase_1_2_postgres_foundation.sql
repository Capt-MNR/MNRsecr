-- Phase 1.2 production foundation.
-- This migration is intended for Supabase/Postgres after the original
-- development boundary migration. It does not create an outbox, channels,
-- A2A tables, or provider tables.

create extension if not exists pgcrypto;
create schema if not exists app;
create schema if not exists auth;

-- Supabase already provides auth.uid(). The compatibility function makes the
-- same migration testable on an empty vanilla Postgres database without
-- replacing Supabase's implementation when it exists.
do $$
begin
  if to_regprocedure('auth.uid()') is null then
    execute $function$
      create function auth.uid()
      returns uuid
      language sql
      stable
      as $body$
        select nullif(current_setting('request.jwt.claim.sub', true), '')::uuid
      $body$
    $function$;
  end if;
end
$$;

create table if not exists tenants (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  slug text not null unique,
  country_code char(2),
  default_locale text,
  default_timezone text not null default 'UTC',
  default_currency_code char(3),
  retention_policy jsonb not null default '{}'::jsonb,
  status text not null default 'active'
    check (status in ('active', 'suspended', 'archived')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz
);

create table if not exists users (
  id uuid primary key default gen_random_uuid(),
  auth_subject uuid not null unique,
  display_name text,
  locale text,
  timezone text,
  country_code char(2),
  status text not null default 'active'
    check (status in ('active', 'disabled', 'deleted')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  deleted_at timestamptz
);

create table if not exists tenant_memberships (
  tenant_id uuid not null references tenants(id),
  user_id uuid not null references users(id),
  role text not null default 'member',
  status text not null default 'active'
    check (status in ('invited', 'active', 'suspended', 'removed')),
  joined_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  primary key (tenant_id, user_id)
);

create index if not exists tenant_memberships_user_status_idx
  on tenant_memberships (user_id, status);
create index if not exists tenant_memberships_tenant_status_idx
  on tenant_memberships (tenant_id, status);

create table if not exists currency_metadata (
  code char(3) primary key,
  minor_unit_exponent smallint not null check (minor_unit_exponent >= 0),
  status text not null default 'active'
    check (status in ('active', 'deprecated')),
  display_name text,
  symbol text,
  updated_at timestamptz not null default now()
);

-- Upgrade the original placeholder tables without deleting development data.
drop index if exists people_owner_name_idx;
drop index if exists projects_owner_name_idx;

alter table people add column if not exists owner_user_id uuid;
alter table people add column if not exists display_name text;
alter table people add column if not exists name_key text;
alter table people add column if not exists status text;
alter table people add column if not exists updated_at timestamptz;
update people set owner_user_id = user_id where owner_user_id is null;
update people set display_name = name where display_name is null;
update people set name_key = lower(name) where name_key is null;
update people set status = 'active' where status is null;
update people set updated_at = created_at where updated_at is null;
alter table people alter column owner_user_id set not null;
alter table people alter column display_name set not null;
alter table people alter column name_key set not null;
alter table people alter column status set default 'active';
alter table people alter column status set not null;
alter table people alter column updated_at set default now();
alter table people add constraint people_status_check
  check (status in ('active', 'archived'));
alter table people add constraint people_tenant_id_unique unique (tenant_id, id);
alter table people add constraint people_tenant_fk
  foreign key (tenant_id) references tenants(id);
alter table people add constraint people_owner_membership_fk
  foreign key (tenant_id, owner_user_id)
  references tenant_memberships(tenant_id, user_id);

alter table projects add column if not exists owner_user_id uuid;
alter table projects add column if not exists name_key text;
alter table projects add column if not exists description text;
alter table projects add column if not exists status text;
alter table projects add column if not exists updated_at timestamptz;
update projects set owner_user_id = user_id where owner_user_id is null;
update projects set name_key = lower(name) where name_key is null;
update projects set status = 'active' where status is null;
update projects set updated_at = created_at where updated_at is null;
alter table projects alter column owner_user_id set not null;
alter table projects alter column name_key set not null;
alter table projects alter column status set default 'active';
alter table projects alter column status set not null;
alter table projects alter column updated_at set default now();
alter table projects add constraint projects_status_check
  check (status in ('active', 'paused', 'completed', 'archived'));
alter table projects add constraint projects_tenant_id_unique unique (tenant_id, id);
alter table projects add constraint projects_tenant_fk
  foreign key (tenant_id) references tenants(id);
alter table projects add constraint projects_owner_membership_fk
  foreign key (tenant_id, owner_user_id)
  references tenant_memberships(tenant_id, user_id);

alter table expenses add column if not exists owner_user_id uuid;
alter table expenses add column if not exists currency_code char(3);
alter table expenses add column if not exists currency_exponent_snapshot smallint;
alter table expenses add column if not exists updated_at timestamptz;
update expenses set owner_user_id = user_id where owner_user_id is null;
update expenses set currency_code = currency where currency_code is null;
update expenses set updated_at = created_at where updated_at is null;
alter table expenses alter column owner_user_id set not null;
alter table expenses alter column currency_code set not null;
alter table expenses alter column updated_at set default now();
alter table expenses add constraint expenses_amount_nonnegative
  check (amount_minor >= 0);
alter table expenses add constraint expenses_tenant_person_fk
  foreign key (tenant_id, person_id) references people(tenant_id, id);
alter table expenses add constraint expenses_tenant_project_fk
  foreign key (tenant_id, project_id) references projects(tenant_id, id);
alter table expenses add constraint expenses_tenant_fk
  foreign key (tenant_id) references tenants(id);
alter table expenses add constraint expenses_owner_membership_fk
  foreign key (tenant_id, owner_user_id)
  references tenant_memberships(tenant_id, user_id);
alter table expenses add constraint expenses_currency_metadata_fk
  foreign key (currency_code) references currency_metadata(code);

alter table reminders add column if not exists owner_user_id uuid;
alter table reminders add column if not exists lifecycle_status text;
alter table reminders add column if not exists delivery_status text;
alter table reminders add column if not exists claimed_at timestamptz;
alter table reminders add column if not exists lease_until timestamptz;
alter table reminders add column if not exists attempt_count integer;
alter table reminders add column if not exists last_error text;
alter table reminders add column if not exists delivered_at timestamptz;
alter table reminders add column if not exists acknowledged_at timestamptz;
alter table reminders add column if not exists updated_at timestamptz;
update reminders set owner_user_id = user_id where owner_user_id is null;
update reminders
set lifecycle_status = case
  when status = 'cancelled' then 'cancelled'
  else 'scheduled'
end
where lifecycle_status is null;
update reminders
set delivery_status = case
  when status = 'delivered' then 'delivered'
  when status = 'claimed' then 'claimed'
  else 'pending'
end
where delivery_status is null;
update reminders set attempt_count = 0 where attempt_count is null;
update reminders set updated_at = created_at where updated_at is null;
alter table reminders alter column owner_user_id set not null;
alter table reminders alter column lifecycle_status set default 'scheduled';
alter table reminders alter column lifecycle_status set not null;
alter table reminders alter column delivery_status set default 'pending';
alter table reminders alter column delivery_status set not null;
alter table reminders alter column attempt_count set default 0;
alter table reminders alter column attempt_count set not null;
alter table reminders alter column updated_at set default now();
alter table reminders add constraint reminders_lifecycle_status_check
  check (lifecycle_status in ('scheduled', 'cancelled', 'archived'));
alter table reminders add constraint reminders_delivery_status_check
  check (delivery_status in ('pending', 'claimed', 'delivered', 'failed', 'dead_letter'));
alter table reminders add constraint reminders_tenant_fk
  foreign key (tenant_id) references tenants(id);
alter table reminders add constraint reminders_owner_membership_fk
  foreign key (tenant_id, owner_user_id)
  references tenant_memberships(tenant_id, user_id);

-- Remove only placeholder-era duplicate columns after their values have been
-- copied into the production columns above.
alter table people drop column if exists user_id;
alter table people drop column if exists name;
alter table projects drop column if exists user_id;
alter table expenses drop column if exists user_id;
alter table expenses drop column if exists currency;
alter table reminders drop column if exists user_id;
alter table reminders drop column if exists status;

create table if not exists relationships (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  source_person_id uuid not null,
  target_person_id uuid not null,
  relationship_type text not null,
  strength numeric,
  valid_from timestamptz,
  valid_until timestamptz,
  status text not null default 'active'
    check (status in ('active', 'superseded', 'archived')),
  created_by_user_id uuid not null references users(id),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  check (source_person_id <> target_person_id),
  foreign key (tenant_id, source_person_id)
    references people(tenant_id, id),
  foreign key (tenant_id, target_person_id)
    references people(tenant_id, id)
);

create table if not exists project_people (
  tenant_id uuid not null references tenants(id),
  project_id uuid not null,
  person_id uuid not null,
  role text,
  created_by_user_id uuid not null references users(id),
  created_at timestamptz not null default now(),
  ended_at timestamptz,
  primary key (tenant_id, project_id, person_id),
  foreign key (tenant_id, project_id) references projects(tenant_id, id),
  foreign key (tenant_id, person_id) references people(tenant_id, id)
);

create table if not exists tasks (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  owner_user_id uuid not null references users(id),
  project_id uuid,
  related_person_id uuid,
  title text not null,
  description text,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'blocked', 'completed', 'cancelled')),
  priority text,
  due_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, project_id) references projects(tenant_id, id),
  foreign key (tenant_id, related_person_id) references people(tenant_id, id)
);

create table if not exists commitments (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  owner_user_id uuid not null references users(id),
  project_id uuid,
  person_id uuid,
  title text not null,
  description text,
  status text not null default 'open'
    check (status in ('open', 'in_progress', 'fulfilled', 'cancelled', 'archived')),
  due_at timestamptz,
  timezone text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, id),
  foreign key (tenant_id, project_id) references projects(tenant_id, id),
  foreign key (tenant_id, person_id) references people(tenant_id, id)
);

create table if not exists events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  owner_user_id uuid not null references users(id),
  project_id uuid,
  person_id uuid,
  title text not null,
  description text,
  starts_at timestamptz not null,
  ends_at timestamptz,
  timezone text not null,
  location text,
  status text not null default 'scheduled'
    check (status in ('scheduled', 'cancelled', 'completed')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, project_id) references projects(tenant_id, id),
  foreign key (tenant_id, person_id) references people(tenant_id, id)
);

create table if not exists memories (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  owner_user_id uuid not null references users(id),
  memory_type text not null,
  content jsonb not null,
  content_text text,
  confidence numeric not null check (confidence >= 0 and confidence <= 1),
  importance smallint not null default 0,
  source_type text not null,
  source_id uuid,
  source_excerpt text,
  visibility text not null default 'private'
    check (visibility in ('private', 'tenant', 'shared')),
  lifecycle text not null default 'active'
    check (lifecycle in ('active', 'superseded', 'retracted', 'archived')),
  valid_from timestamptz,
  valid_until timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  archived_at timestamptz,
  unique (tenant_id, id)
);

create table if not exists memory_people (
  tenant_id uuid not null references tenants(id),
  memory_id uuid not null,
  person_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, memory_id, person_id),
  foreign key (tenant_id, memory_id) references memories(tenant_id, id),
  foreign key (tenant_id, person_id) references people(tenant_id, id)
);

create table if not exists memory_projects (
  tenant_id uuid not null references tenants(id),
  memory_id uuid not null,
  project_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, memory_id, project_id),
  foreign key (tenant_id, memory_id) references memories(tenant_id, id),
  foreign key (tenant_id, project_id) references projects(tenant_id, id)
);

create table if not exists memory_tasks (
  tenant_id uuid not null references tenants(id),
  memory_id uuid not null,
  task_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, memory_id, task_id),
  foreign key (tenant_id, memory_id) references memories(tenant_id, id),
  foreign key (tenant_id, task_id) references tasks(tenant_id, id)
);

create table if not exists memory_commitments (
  tenant_id uuid not null references tenants(id),
  memory_id uuid not null,
  commitment_id uuid not null,
  created_at timestamptz not null default now(),
  primary key (tenant_id, memory_id, commitment_id),
  foreign key (tenant_id, memory_id) references memories(tenant_id, id),
  foreign key (tenant_id, commitment_id) references commitments(tenant_id, id)
);

create table if not exists permissions (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  grantee_type text not null check (grantee_type in ('user', 'service', 'assistant')),
  grantee_id uuid not null,
  capability text not null,
  access_level text not null
    check (access_level in ('READ', 'COMMUNICATE', 'NEGOTIATE', 'COMMIT', 'EXECUTE')),
  scope_type text not null
    check (scope_type in ('tenant', 'entity', 'channel', 'operation')),
  scope_entity_type text,
  scope_entity_id uuid,
  grant_reason text,
  status text not null default 'active'
    check (status in ('active', 'revoked', 'expired')),
  granted_by_user_id uuid not null references users(id),
  expires_at timestamptz,
  revoked_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (
    tenant_id, grantee_type, grantee_id, capability, access_level,
    scope_type, scope_entity_type, scope_entity_id
  )
);

create table if not exists conversations (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  owner_user_id uuid not null references users(id),
  channel text not null,
  external_conversation_key text,
  status text not null default 'active'
    check (status in ('active', 'archived', 'deleted')),
  started_at timestamptz not null default now(),
  last_activity_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  metadata jsonb not null default '{}'::jsonb,
  unique (tenant_id, id)
);

create unique index if not exists conversations_external_key_idx
  on conversations (tenant_id, owner_user_id, channel, external_conversation_key)
  where external_conversation_key is not null;

create table if not exists conversation_turns (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  conversation_id uuid not null,
  actor_type text not null check (actor_type in ('user', 'assistant', 'system', 'tool')),
  content jsonb not null,
  content_text text,
  sequence_no bigint not null,
  runtime_session_id text,
  idempotency_key text,
  status text not null default 'received'
    check (status in ('received', 'processing', 'completed', 'failed')),
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  unique (tenant_id, id),
  unique (tenant_id, conversation_id, sequence_no),
  foreign key (tenant_id, conversation_id) references conversations(tenant_id, id)
);

create table if not exists conversation_people (
  tenant_id uuid not null references tenants(id),
  conversation_id uuid not null,
  person_id uuid not null,
  first_referenced_at timestamptz not null default now(),
  last_referenced_at timestamptz not null default now(),
  primary key (tenant_id, conversation_id, person_id),
  foreign key (tenant_id, conversation_id) references conversations(tenant_id, id),
  foreign key (tenant_id, person_id) references people(tenant_id, id)
);

create table if not exists conversation_projects (
  tenant_id uuid not null references tenants(id),
  conversation_id uuid not null,
  project_id uuid not null,
  first_referenced_at timestamptz not null default now(),
  last_referenced_at timestamptz not null default now(),
  primary key (tenant_id, conversation_id, project_id),
  foreign key (tenant_id, conversation_id) references conversations(tenant_id, id),
  foreign key (tenant_id, project_id) references projects(tenant_id, id)
);

create table if not exists conversation_tasks (
  tenant_id uuid not null references tenants(id),
  conversation_id uuid not null,
  task_id uuid not null,
  first_referenced_at timestamptz not null default now(),
  last_referenced_at timestamptz not null default now(),
  primary key (tenant_id, conversation_id, task_id),
  foreign key (tenant_id, conversation_id) references conversations(tenant_id, id),
  foreign key (tenant_id, task_id) references tasks(tenant_id, id)
);

create table if not exists conversation_commitments (
  tenant_id uuid not null references tenants(id),
  conversation_id uuid not null,
  commitment_id uuid not null,
  first_referenced_at timestamptz not null default now(),
  last_referenced_at timestamptz not null default now(),
  primary key (tenant_id, conversation_id, commitment_id),
  foreign key (tenant_id, conversation_id) references conversations(tenant_id, id),
  foreign key (tenant_id, commitment_id) references commitments(tenant_id, id)
);

create table if not exists tool_calls (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  conversation_id uuid,
  turn_id uuid not null,
  tool_name text not null,
  arguments jsonb not null default '{}'::jsonb,
  result jsonb,
  status text not null
    check (status in ('proposed', 'authorized', 'completed', 'rejected', 'failed')),
  error_code text,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now(),
  unique (tenant_id, id),
  foreign key (tenant_id, conversation_id) references conversations(tenant_id, id),
  foreign key (tenant_id, turn_id) references conversation_turns(tenant_id, id)
);

create table if not exists idempotency_records (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  owner_user_id uuid not null references users(id),
  operation text not null,
  idempotency_key text not null,
  request_fingerprint text not null,
  status text not null default 'processing'
    check (status in ('processing', 'completed', 'failed')),
  response jsonb,
  resource_type text,
  resource_id uuid,
  expires_at timestamptz,
  created_at timestamptz not null default now(),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  unique (tenant_id, owner_user_id, operation, idempotency_key)
);

create table if not exists audit_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  actor_type text not null check (actor_type in ('user', 'service', 'system', 'assistant')),
  actor_id uuid,
  event_type text not null,
  aggregate_type text,
  aggregate_id uuid,
  conversation_id uuid,
  turn_id uuid,
  payload jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  foreign key (tenant_id, conversation_id) references conversations(tenant_id, id),
  foreign key (tenant_id, turn_id) references conversation_turns(tenant_id, id)
);

create table if not exists domain_events (
  id uuid primary key default gen_random_uuid(),
  tenant_id uuid not null references tenants(id),
  aggregate_type text not null,
  aggregate_id uuid not null,
  event_type text not null,
  aggregate_version bigint,
  payload jsonb not null default '{}'::jsonb,
  occurred_at timestamptz not null default now(),
  created_at timestamptz not null default now(),
  unique (tenant_id, aggregate_type, aggregate_id, aggregate_version)
);

alter table relationships add constraint relationships_creator_membership_fk
  foreign key (tenant_id, created_by_user_id)
  references tenant_memberships(tenant_id, user_id);
alter table project_people add constraint project_people_creator_membership_fk
  foreign key (tenant_id, created_by_user_id)
  references tenant_memberships(tenant_id, user_id);
alter table tasks add constraint tasks_owner_membership_fk
  foreign key (tenant_id, owner_user_id)
  references tenant_memberships(tenant_id, user_id);
alter table commitments add constraint commitments_owner_membership_fk
  foreign key (tenant_id, owner_user_id)
  references tenant_memberships(tenant_id, user_id);
alter table events add constraint events_owner_membership_fk
  foreign key (tenant_id, owner_user_id)
  references tenant_memberships(tenant_id, user_id);
alter table memories add constraint memories_owner_membership_fk
  foreign key (tenant_id, owner_user_id)
  references tenant_memberships(tenant_id, user_id);
alter table conversations add constraint conversations_owner_membership_fk
  foreign key (tenant_id, owner_user_id)
  references tenant_memberships(tenant_id, user_id);
alter table idempotency_records add constraint idempotency_owner_membership_fk
  foreign key (tenant_id, owner_user_id)
  references tenant_memberships(tenant_id, user_id);

create unique index if not exists people_owner_name_v2_idx
  on people (tenant_id, owner_user_id, name_key)
  where status = 'active';
create unique index if not exists projects_owner_name_v2_idx
  on projects (tenant_id, owner_user_id, name_key)
  where status <> 'archived';
create index if not exists expenses_project_idx
  on expenses (tenant_id, project_id, occurred_at desc);
create index if not exists reminders_due_idx
  on reminders (tenant_id, due_at)
  where lifecycle_status = 'scheduled' and delivery_status in ('pending', 'claimed');
create index if not exists reminders_lease_idx
  on reminders (delivery_status, lease_until);
create index if not exists domain_events_type_idx
  on domain_events (tenant_id, event_type, occurred_at);
create index if not exists audit_events_created_idx
  on audit_events (tenant_id, created_at desc);

-- Auth-to-product identity helpers. Supabase supplies auth.uid().
create or replace function app.current_product_user_id()
returns uuid
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select id
  from public.users
  where auth_subject = auth.uid()
    and status = 'active'
  limit 1
$$;

create or replace function app.is_active_tenant_member(target_tenant_id uuid)
returns boolean
language sql
stable
security definer
set search_path = public, app, pg_temp
as $$
  select exists (
    select 1
    from public.tenant_memberships membership
    where membership.tenant_id = target_tenant_id
      and membership.user_id = app.current_product_user_id()
      and membership.status = 'active'
  )
$$;

revoke execute on function app.current_product_user_id() from public;
revoke execute on function app.is_active_tenant_member(uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'authenticated') then
    execute 'grant execute on function app.current_product_user_id() to authenticated';
    execute 'grant execute on function app.is_active_tenant_member(uuid) to authenticated';
  end if;
  if exists (select 1 from pg_roles where rolname = 'service_role') then
    execute 'grant execute on function app.current_product_user_id() to service_role';
    execute 'grant execute on function app.is_active_tenant_member(uuid) to service_role';
  end if;
end
$$;

alter table tenants enable row level security;
alter table users enable row level security;
alter table tenant_memberships enable row level security;
alter table people enable row level security;
alter table projects enable row level security;
alter table relationships enable row level security;
alter table project_people enable row level security;
alter table tasks enable row level security;
alter table expenses enable row level security;
alter table commitments enable row level security;
alter table events enable row level security;
alter table reminders enable row level security;
alter table memories enable row level security;
alter table memory_people enable row level security;
alter table memory_projects enable row level security;
alter table memory_tasks enable row level security;
alter table memory_commitments enable row level security;
alter table permissions enable row level security;
alter table conversations enable row level security;
alter table conversation_turns enable row level security;
alter table conversation_people enable row level security;
alter table conversation_projects enable row level security;
alter table conversation_tasks enable row level security;
alter table conversation_commitments enable row level security;
alter table tool_calls enable row level security;
alter table idempotency_records enable row level security;
alter table audit_events enable row level security;
alter table domain_events enable row level security;

-- Owner-only policies. Explicit sharing policies can extend these predicates
-- later without changing tenant columns or foreign keys.
create policy tenants_member_select on tenants for select
  using (app.is_active_tenant_member(id));
create policy users_self_select on users for select
  using (id = app.current_product_user_id());
create policy memberships_self_select on tenant_memberships for select
  using (user_id = app.current_product_user_id());

create policy people_owner_all on people for all
  using (app.is_active_tenant_member(tenant_id)
         and owner_user_id = app.current_product_user_id())
  with check (app.is_active_tenant_member(tenant_id)
              and owner_user_id = app.current_product_user_id());
create policy projects_owner_all on projects for all
  using (app.is_active_tenant_member(tenant_id)
         and owner_user_id = app.current_product_user_id())
  with check (app.is_active_tenant_member(tenant_id)
              and owner_user_id = app.current_product_user_id());
create policy tasks_owner_all on tasks for all
  using (app.is_active_tenant_member(tenant_id)
         and owner_user_id = app.current_product_user_id())
  with check (app.is_active_tenant_member(tenant_id)
              and owner_user_id = app.current_product_user_id());
create policy expenses_owner_all on expenses for all
  using (app.is_active_tenant_member(tenant_id)
         and owner_user_id = app.current_product_user_id())
  with check (app.is_active_tenant_member(tenant_id)
              and owner_user_id = app.current_product_user_id());
create policy commitments_owner_all on commitments for all
  using (app.is_active_tenant_member(tenant_id)
         and owner_user_id = app.current_product_user_id())
  with check (app.is_active_tenant_member(tenant_id)
              and owner_user_id = app.current_product_user_id());
create policy events_owner_all on events for all
  using (app.is_active_tenant_member(tenant_id)
         and owner_user_id = app.current_product_user_id())
  with check (app.is_active_tenant_member(tenant_id)
              and owner_user_id = app.current_product_user_id());
create policy reminders_owner_all on reminders for all
  using (app.is_active_tenant_member(tenant_id)
         and owner_user_id = app.current_product_user_id())
  with check (app.is_active_tenant_member(tenant_id)
              and owner_user_id = app.current_product_user_id());
create policy memories_owner_all on memories for all
  using (app.is_active_tenant_member(tenant_id)
         and owner_user_id = app.current_product_user_id())
  with check (app.is_active_tenant_member(tenant_id)
              and owner_user_id = app.current_product_user_id());
create policy idempotency_owner_all on idempotency_records for all
  using (app.is_active_tenant_member(tenant_id)
         and owner_user_id = app.current_product_user_id())
  with check (app.is_active_tenant_member(tenant_id)
              and owner_user_id = app.current_product_user_id());
create policy conversations_owner_all on conversations for all
  using (app.is_active_tenant_member(tenant_id)
         and owner_user_id = app.current_product_user_id())
  with check (app.is_active_tenant_member(tenant_id)
              and owner_user_id = app.current_product_user_id());

create policy relationships_creator_all on relationships for all
  using (app.is_active_tenant_member(tenant_id)
         and created_by_user_id = app.current_product_user_id())
  with check (app.is_active_tenant_member(tenant_id)
              and created_by_user_id = app.current_product_user_id());
create policy project_people_creator_all on project_people for all
  using (app.is_active_tenant_member(tenant_id)
         and created_by_user_id = app.current_product_user_id())
  with check (app.is_active_tenant_member(tenant_id)
              and created_by_user_id = app.current_product_user_id());

create policy permission_subject_or_grantor_select on permissions for select
  using (app.is_active_tenant_member(tenant_id)
         and (grantee_id = app.current_product_user_id()
              or granted_by_user_id = app.current_product_user_id()));
-- No authenticated/user policy grants INSERT or UPDATE on permissions.
-- Explicit grants are created by a trusted, audited server path (or the
-- service-role worker), never by a model/runtime request.

create policy conversation_turn_owner_all on conversation_turns for all
  using (exists (
    select 1 from conversations c
    where c.tenant_id = conversation_turns.tenant_id
      and c.id = conversation_turns.conversation_id
      and c.owner_user_id = app.current_product_user_id()
  ))
  with check (exists (
    select 1 from conversations c
    where c.tenant_id = conversation_turns.tenant_id
      and c.id = conversation_turns.conversation_id
      and c.owner_user_id = app.current_product_user_id()
  ));

create policy tool_call_owner_all on tool_calls for all
  using (exists (
    select 1 from conversations c
    where c.tenant_id = tool_calls.tenant_id
      and c.id = tool_calls.conversation_id
      and c.owner_user_id = app.current_product_user_id()
  ))
  with check (exists (
    select 1 from conversations c
    where c.tenant_id = tool_calls.tenant_id
      and c.id = tool_calls.conversation_id
      and c.owner_user_id = app.current_product_user_id()
  ));

-- Typed graph joins inherit access from their owner-side records.
create policy memory_people_owner_all on memory_people for all
  using (exists (
    select 1 from memories m
    where m.tenant_id = memory_people.tenant_id
      and m.id = memory_people.memory_id
      and m.owner_user_id = app.current_product_user_id()
  ))
  with check (exists (
    select 1 from memories m
    where m.tenant_id = memory_people.tenant_id
      and m.id = memory_people.memory_id
      and m.owner_user_id = app.current_product_user_id()
  ));
create policy memory_projects_owner_all on memory_projects for all
  using (exists (
    select 1 from memories m
    where m.tenant_id = memory_projects.tenant_id
      and m.id = memory_projects.memory_id
      and m.owner_user_id = app.current_product_user_id()
  ))
  with check (exists (
    select 1 from memories m
    where m.tenant_id = memory_projects.tenant_id
      and m.id = memory_projects.memory_id
      and m.owner_user_id = app.current_product_user_id()
  ));
create policy memory_tasks_owner_all on memory_tasks for all
  using (exists (
    select 1 from memories m
    where m.tenant_id = memory_tasks.tenant_id
      and m.id = memory_tasks.memory_id
      and m.owner_user_id = app.current_product_user_id()
  ))
  with check (exists (
    select 1 from memories m
    where m.tenant_id = memory_tasks.tenant_id
      and m.id = memory_tasks.memory_id
      and m.owner_user_id = app.current_product_user_id()
  ));
create policy memory_commitments_owner_all on memory_commitments for all
  using (exists (
    select 1 from memories m
    where m.tenant_id = memory_commitments.tenant_id
      and m.id = memory_commitments.memory_id
      and m.owner_user_id = app.current_product_user_id()
  ))
  with check (exists (
    select 1 from memories m
    where m.tenant_id = memory_commitments.tenant_id
      and m.id = memory_commitments.memory_id
      and m.owner_user_id = app.current_product_user_id()
  ));

create policy conversation_people_owner_all on conversation_people for all
  using (exists (
    select 1 from conversations c
    where c.tenant_id = conversation_people.tenant_id
      and c.id = conversation_people.conversation_id
      and c.owner_user_id = app.current_product_user_id()
  ))
  with check (exists (
    select 1 from conversations c
    where c.tenant_id = conversation_people.tenant_id
      and c.id = conversation_people.conversation_id
      and c.owner_user_id = app.current_product_user_id()
  ));
create policy conversation_projects_owner_all on conversation_projects for all
  using (exists (
    select 1 from conversations c
    where c.tenant_id = conversation_projects.tenant_id
      and c.id = conversation_projects.conversation_id
      and c.owner_user_id = app.current_product_user_id()
  ))
  with check (exists (
    select 1 from conversations c
    where c.tenant_id = conversation_projects.tenant_id
      and c.id = conversation_projects.conversation_id
      and c.owner_user_id = app.current_product_user_id()
  ));
create policy conversation_tasks_owner_all on conversation_tasks for all
  using (exists (
    select 1 from conversations c
    where c.tenant_id = conversation_tasks.tenant_id
      and c.id = conversation_tasks.conversation_id
      and c.owner_user_id = app.current_product_user_id()
  ))
  with check (exists (
    select 1 from conversations c
    where c.tenant_id = conversation_tasks.tenant_id
      and c.id = conversation_tasks.conversation_id
      and c.owner_user_id = app.current_product_user_id()
  ));
create policy conversation_commitments_owner_all on conversation_commitments for all
  using (exists (
    select 1 from conversations c
    where c.tenant_id = conversation_commitments.tenant_id
      and c.id = conversation_commitments.conversation_id
      and c.owner_user_id = app.current_product_user_id()
  ))
  with check (exists (
    select 1 from conversations c
    where c.tenant_id = conversation_commitments.tenant_id
      and c.id = conversation_commitments.conversation_id
      and c.owner_user_id = app.current_product_user_id()
  ));

create policy audit_actor_select on audit_events for select
  using (app.is_active_tenant_member(tenant_id)
         and actor_id = app.current_product_user_id());
create policy audit_actor_insert on audit_events for insert
  with check (app.is_active_tenant_member(tenant_id)
              and actor_type = 'user'
              and actor_id = app.current_product_user_id());
create policy domain_event_actor_select on domain_events for select
  using (app.is_active_tenant_member(tenant_id));
-- Domain-event inserts are application/service-role operations only. There is
-- deliberately no authenticated policy that lets a model or client forge one.

-- Physical deletion is not part of the Personal OS write surface. The
-- restrictive policies combine with the owner policies above and deny DELETE
-- to ordinary RLS sessions; the trusted service role remains an explicit
-- infrastructure exception and must use audited application operations.
create policy no_delete_people on people as restrictive for delete using (false);
create policy no_delete_projects on projects as restrictive for delete using (false);
create policy no_delete_tasks on tasks as restrictive for delete using (false);
create policy no_delete_expenses on expenses as restrictive for delete using (false);
create policy no_delete_commitments on commitments as restrictive for delete using (false);
create policy no_delete_events on events as restrictive for delete using (false);
create policy no_delete_reminders on reminders as restrictive for delete using (false);
create policy no_delete_memories on memories as restrictive for delete using (false);
create policy no_delete_idempotency on idempotency_records as restrictive for delete using (false);
create policy no_delete_conversations on conversations as restrictive for delete using (false);
create policy no_delete_relationships on relationships as restrictive for delete using (false);
create policy no_delete_project_people on project_people as restrictive for delete using (false);
create policy no_delete_conversation_turns on conversation_turns as restrictive for delete using (false);
create policy no_delete_tool_calls on tool_calls as restrictive for delete using (false);
create policy no_delete_memory_people on memory_people as restrictive for delete using (false);
create policy no_delete_memory_projects on memory_projects as restrictive for delete using (false);
create policy no_delete_memory_tasks on memory_tasks as restrictive for delete using (false);
create policy no_delete_memory_commitments on memory_commitments as restrictive for delete using (false);
create policy no_delete_conversation_people on conversation_people as restrictive for delete using (false);
create policy no_delete_conversation_projects on conversation_projects as restrictive for delete using (false);
create policy no_delete_conversation_tasks on conversation_tasks as restrictive for delete using (false);
create policy no_delete_conversation_commitments on conversation_commitments as restrictive for delete using (false);

-- The service role bypasses RLS intentionally for the trusted worker path.
-- It must be replaced by a restricted role when operationally available.