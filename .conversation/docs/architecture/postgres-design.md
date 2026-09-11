# Personal AI OS — Postgres/Supabase Persistence Design

**Phase:** 1.2 — Design review only  
**Status:** Baseline accepted for design review; implementation not approved  
**Date:** 2026-09-11  
**Current adapter:** SQLite development adapter  
**Hermes:** Inactive and excluded  

This document defines the first Postgres/Supabase persistence model without
creating or executing a migration. It is a design for review. The existing
SQLite adapter remains the only active persistence implementation.

## 1. Design goals and non-goals

### Goals

- Make tenant ownership explicit on every tenant-owned record.
- Make the database a second security boundary through PostgreSQL RLS.
- Preserve the current flow:

  ```text
  Authentication
    -> TrustedIdentity
    -> ExecutionContext
    -> Application Use Cases
    -> Persistence Port
  ```

- Keep `AgentRuntime` and `ModelGateway` independent of storage technology.
- Represent the personal context graph as queryable records and joins.
- Support durable idempotency, worker leases, domain events, and a future
  outbox.
- Keep locale, timezone, country, and currency explicit rather than embedding
  Egypt-specific assumptions.
- Provide a clean replacement path from SQLite to Postgres.

### Non-goals for Phase 1.2

- No Postgres migration is being written or run.
- No existing SQLite data is being moved.
- No RLS policy is being deployed.
- No production model provider is being selected.
- No Hermes integration is being implemented.
- No Android, Telegram, A2A, billing, or complete permission product is being
  built.

The current placeholder file
`supabase/migrations/0001_personal_ai_os_foundation.sql` is not a complete
production schema and must not be treated as the Phase 1.2 migration.

## 1.1. Accepted Phase 1.2 baseline

The following decisions are now baseline for this design:

1. Personal OS records are owner-only by default. Sharing between users is
   always an explicit permission. The model leaves room for a later Business
   Mode with shared tenant records, but tenant membership alone does not grant
   access to personal records.
2. A product user may belong to multiple tenants. The active tenant is a
   server/session context selected and validated outside the model. The model
   cannot select or change a tenant.
3. `users.id` is an independent product UUID. `users.auth_subject` maps it to
   Supabase Auth without assuming that product IDs equal `auth.users.id`.
4. Monetary values use integer minor units plus a currency code. A
   currency-metadata reference determines the exponent; two decimal places are
   never assumed.
5. Memories use structured JSONB as their canonical content, with optional
   human-readable text/context. A conversation does not become permanent memory
   automatically. Durable memories require explicit user input or an approved,
   high-confidence application event with provenance.
6. The permission model supports `READ`, `COMMUNICATE`, `NEGOTIATE`, `COMMIT`,
   and `EXECUTE`. The first activated slice may expose only `READ`,
   `COMMUNICATE`, and `EXECUTE`; the model cannot grant itself permissions.
7. Conversations are owner-only by default and require explicit permission to
   share.
8. Retention is configurable. Retention of conversation, tool, audit, or
   domain-event data must not automatically delete canonical domain records.
9. `DELIVERED` is the explicit reminder delivery state. The design reserves
   separate reminder lifecycle and delivery lifecycle fields for later use.
10. The initial trusted worker may use a Supabase service role, never exposed
    to a model or client. The boundary remains replaceable with a
    least-privilege Postgres role.
11. Core context-graph links use typed join tables, not permanent
    polymorphic links.
12. Structured Postgres data remains the System of Record. Supabase is the
    persistence/security platform, not the brain; `AgentRuntime` and
    `ModelGateway` remain replaceable; the deployment remains cloud-first and
    local-ready.

## 2. Persistence boundary review

### Current boundary

The current application service is constructed with `SQLiteStore` directly:

```text
ApplicationService(SQLiteStore)
  -> SQLiteStore.fetchone / execute / transaction
```

Important current references:

- `packages/application/use_cases.py:30-34`
- `packages/application/use_cases.py:45-89`
- `packages/application/use_cases.py:124-184`
- `packages/application/use_cases.py:290-352`
- `packages/persistence/sqlite.py:95-219`

The runtime itself does not access persistence, which is correct:

```text
FirstPartyRuntime
  -> ModelGateway
  -> ApplicationService
  -> SQLiteStore
```

### SQLite-specific assumptions currently leaking upward

The following must be removed from the application boundary before a
Postgres adapter is implemented:

1. `ApplicationService` is typed against `SQLiteStore`, not a persistence
   port.
2. Use cases issue SQL strings directly through `fetchone` and `execute`.
3. Use cases depend on `sqlite3.Row` mapping behavior.
4. Use cases open the transaction through a SQLite-specific
   `BEGIN IMMEDIATE` context manager.
5. The application knows the storage shape of `idempotency_records`,
   `audit_events`, and reminder lease columns.
6. Reminder claiming is implemented as SQLite select-then-update logic rather
   than a storage-level claim operation with an explicit concurrency contract.
7. SQLite stores timestamps as ISO text; Postgres should expose timezone-aware
   datetime values through the port.
8. SQLite stores JSON as text; Postgres should expose structured JSON values
   through the port.
9. SQLite IDs currently use text values such as `expense_<uuid>`, while the
   proposed Postgres model uses UUIDs.
10. `check_same_thread=False`, WAL, and the shared connection are SQLite
    runtime details and must not become application assumptions.

### Proposed replacement boundary

The application should depend on product-level ports, not SQL or a concrete
database:

```text
packages/persistence/ports.py

PersistenceUnitOfWork
  people
  projects
  relationships
  tasks
  expenses
  commitments
  events
  reminders
  memories
  permissions
  conversations
  tool_calls
  idempotency
  audit_events
  domain_events
  outbox
```

The exact Python interfaces are deferred until implementation, but the
contract should have these properties:

- repository methods accept `ExecutionContext` or an already-authorized
  persistence scope;
- repositories return domain records or explicit persistence results, never
  driver-specific rows;
- one unit of work can atomically write a domain record, idempotency result,
  audit event, and domain event;
- reminder claiming is one atomic repository operation;
- the SQLite and Postgres adapters implement the same port;
- no use case constructs SQL;
- no use case relies on SQLite transaction syntax;
- no adapter leaks its connection or cursor into application code.

The application layer remains responsible for use-case authorization. RLS is
the independent database boundary, not a replacement for application policy.

## 3. Global schema conventions

### Identifiers

- Use `uuid` primary keys generated server-side with `gen_random_uuid()` or
  an equivalent application-controlled UUID generator.
- Do not accept a model-supplied identifier as an ownership claim.
- Every tenant-owned table has a `tenant_id uuid not null`.
- Every user-owned record has an `owner_user_id` or `created_by_user_id`
  where the distinction matters.
- Tenant-scoped references should use composite foreign keys of the form
  `(tenant_id, related_id)`, backed by a matching unique constraint. This
  prevents a valid UUID from being used to reference a record in another
  tenant.

### Timestamps

- Use `timestamptz` for instants.
- Store all instants in UTC at the database boundary.
- Keep a separate IANA timezone name where user-facing scheduling requires
  local-time interpretation.
- Use `created_at` and `updated_at` on mutable records.
- Use `archived_at`, `deleted_at`, or a lifecycle status rather than physical
  deletion for records that must remain auditable.

### JSON

- Use `jsonb` for bounded provider metadata, structured payloads, and
  extensible attributes.
- Do not put canonical relationships or authorization decisions only in JSON.
- JSON payloads must not be used to bypass tenant ownership checks.

### Money and locale

- Store `amount_minor bigint` plus `currency_code char(3)` using ISO-4217
  codes.
- Resolve the number of minor units from the global `currency_metadata`
  reference table; do not assume every currency has two decimal places.
- A monetary record may retain an immutable `currency_exponent_snapshot` when
  historical rendering must remain stable even if reference metadata is
  corrected.
- Store locale, country code, and timezone as explicit fields where they affect
  behavior.
- Do not encode EGP or `Africa/Cairo` as database-wide defaults.

### Lifecycle and deletion

- Default to archive/status transitions for personal records, financial
  records, audit records, conversations, and domain events.
- Hard deletion requires a separate retention/privacy decision and must not
  silently break audit or event references.
- Audit events and domain events are append-only.

### `currency_metadata` (global reference data)

Purpose: defines the ISO currency code and its minor-unit exponent. It is not
tenant-owned and is not a source of user identity or authorization.

| Column | Design |
|---|---|
| `code` | ISO-4217 primary key |
| `minor_unit_exponent` | Non-negative smallint |
| `status` | `active`, `deprecated` |
| `display_name`, `symbol` | Optional presentation metadata |
| `updated_at` | Timestamp |

Monetary rows store the code and integer minor amount. The application uses
this reference for validation and display; it never silently converts between
currencies.

## 4. Tenant and identity model

### `tenants`

Purpose: account boundary and tenant-wide defaults.

| Column | Design |
|---|---|
| `id` | UUID primary key |
| `name` | Display name |
| `slug` | Unique stable human identifier |
| `country_code` | Optional ISO-3166-1 alpha-2 |
| `default_locale` | Optional BCP-47 locale |
| `default_timezone` | IANA timezone |
| `default_currency_code` | Optional ISO-4217 code |
| `retention_policy` | Versioned `jsonb` policy configuration |
| `status` | `active`, `suspended`, `archived` |
| `created_at`, `updated_at`, `archived_at` | Lifecycle timestamps |

Indexes and constraints:

- unique `slug`;
- index on `status`;
- no user data is stored here.

### `users`

Purpose: product user profile mapped to an authentication subject.

| Column | Design |
|---|---|
| `id` | Product UUID primary key |
| `auth_subject` | Unique Supabase Auth subject, normally `auth.users.id` |
| `display_name` | Optional profile name |
| `locale` | Optional BCP-47 locale |
| `timezone` | Optional IANA timezone |
| `country_code` | Optional ISO country |
| `status` | `active`, `disabled`, `deleted` |
| `created_at`, `updated_at`, `deleted_at` | Lifecycle timestamps |

Constraints:

- unique `auth_subject`;
- `users.id` is never assumed to equal `auth.users.id`;
- no tenant is embedded as a single column because one authenticated user may
  belong to multiple tenants;
- the API resolves the active tenant through a validated server/session
  context and checks `tenant_memberships` before creating `ExecutionContext`.

### `tenant_memberships`

Purpose: maps users to tenants and records membership status/role.

| Column | Design |
|---|---|
| `tenant_id` | FK to `tenants` |
| `user_id` | FK to `users` |
| `role` | `owner`, `member`, or future role values |
| `status` | `invited`, `active`, `suspended`, `removed` |
| `joined_at`, `created_at`, `updated_at` | Membership timestamps |

Primary key: `(tenant_id, user_id)`.

Indexes:

- `(user_id, status)`;
- `(tenant_id, status)`.

This table is the source for resolving which tenant contexts an authenticated
user may use. A JWT claim, request body, or model output must not be trusted as
a tenant membership or active-tenant selection.

## 5. Canonical context graph

The first graph uses explicit foreign keys and join tables:

```text
Tenant
  ├── Users through TenantMemberships
  ├── People
  │     └── Relationships(Person ↔ Person)
  ├── Projects
  │     └── ProjectPeople(Person ↔ Project)
  ├── Expenses ── optional Person
  │             └─ optional Project
  ├── Tasks ───── optional Project
  │             └─ optional Person/User
  ├── Commitments ─ optional Person
  │                └─ optional Project
  ├── Events
  ├── Reminders ── optional source entity
  ├── Memories ─── MemoryReferences
  └── Conversations ─ ConversationLinks
```

All graph edges carry `tenant_id`. A relationship edge is not allowed to
connect records from different tenants, even if the referenced UUIDs are
otherwise valid.

Graph membership is not access permission. For example, a person being linked
to a project does not make that project readable by the person or by another
tenant member. Access remains owner-only unless an explicit permission grant
authorizes sharing. This preserves Personal OS behavior while leaving room for
Business Mode shared tenant records.

## 6. Domain tables

The following table proposals are intentionally limited to the product
entities needed for a real first foundation and the persistence required to
operate them safely.

### `people`

Purpose: people in the user's personal graph, including contacts who are not
product users.

| Column | Design |
|---|---|
| `id` | UUID primary key |
| `tenant_id` | FK to `tenants` |
| `owner_user_id` | FK to `users`; personal owner |
| `display_name` | Required text |
| `name_key` | Normalized lookup key |
| `notes` | Optional text |
| `attributes` | Optional `jsonb`, non-canonical metadata |
| `status` | `active`, `archived` |
| `created_at`, `updated_at`, `archived_at` | Timestamps |

Constraints and indexes:

- unique `(tenant_id, owner_user_id, name_key)` for active records;
- index `(tenant_id, owner_user_id, status)`;
- composite tenant-scoped references from relationship and domain tables.

### `relationships`

Purpose: typed, queryable person-to-person edges.

| Column | Design |
|---|---|
| `id` | UUID primary key |
| `tenant_id` | FK to `tenants` |
| `source_person_id` | Tenant-scoped FK to `people` |
| `target_person_id` | Tenant-scoped FK to `people` |
| `relationship_type` | Controlled text such as `friend`, `vendor`, `family` |
| `strength` | Optional numeric or smallint |
| `valid_from`, `valid_until` | Temporal validity |
| `status` | `active`, `superseded`, `archived` |
| `created_by_user_id` | FK to `users` |
| `created_at`, `updated_at` | Timestamps |

Constraints and indexes:

- source and target cannot be the same person;
- index `(tenant_id, source_person_id, status)`;
- index `(tenant_id, target_person_id, status)`;
- optional unique active edge on `(tenant_id, source_person_id,
  target_person_id, relationship_type)`.

### `projects`

Purpose: named areas of work or context such as a renovation project.

| Column | Design |
|---|---|
| `id` | UUID primary key |
| `tenant_id` | FK to `tenants` |
| `owner_user_id` | FK to `users` |
| `name` | Display name |
| `name_key` | Normalized lookup key |
| `description` | Optional text |
| `status` | `active`, `paused`, `completed`, `archived` |
| `start_at`, `due_at` | Optional instants |
| `created_at`, `updated_at`, `archived_at` | Timestamps |

Constraints and indexes:

- unique active `(tenant_id, owner_user_id, name_key)`;
- index `(tenant_id, owner_user_id, status, due_at)`.

### `project_people`

Purpose: first-class Person → Project membership and role.

| Column | Design |
|---|---|
| `tenant_id` | FK to `tenants` |
| `project_id` | Tenant-scoped FK to `projects` |
| `person_id` | Tenant-scoped FK to `people` |
| `role` | Optional text such as `contractor`, `client`, `contact` |
| `created_by_user_id` | FK to `users` |
| `created_at`, `ended_at` | Lifecycle timestamps |

Primary key: `(tenant_id, project_id, person_id)`.

Index: `(tenant_id, person_id, ended_at)`.

This is a context-graph edge only; it does not grant project access.

### `tasks`

Purpose: actionable work items.

| Column | Design |
|---|---|
| `id` | UUID primary key |
| `tenant_id` | FK to `tenants` |
| `owner_user_id` | FK to `users` |
| `project_id` | Optional tenant-scoped FK to `projects` |
| `related_person_id` | Optional tenant-scoped FK to `people` |
| `title` | Required text |
| `description` | Optional text |
| `status` | `open`, `in_progress`, `blocked`, `completed`, `cancelled` |
| `priority` | Optional controlled value |
| `due_at` | Optional timestamptz |
| `completed_at` | Optional timestamptz |
| `created_at`, `updated_at`, `archived_at` | Timestamps |

Indexes:

- `(tenant_id, owner_user_id, status, due_at)`;
- `(tenant_id, project_id, status)`;
- `(tenant_id, related_person_id, status)`.

### `expenses`

Purpose: canonical financial records.

| Column | Design |
|---|---|
| `id` | UUID primary key |
| `tenant_id` | FK to `tenants` |
| `owner_user_id` | FK to `users` |
| `person_id` | Optional tenant-scoped FK to `people` |
| `project_id` | Optional tenant-scoped FK to `projects` |
| `amount_minor` | `bigint`, non-negative |
| `currency_code` | ISO-4217 `char(3)` |
| `currency_exponent_snapshot` | Optional smallint snapshot when needed |
| `description` | Required text |
| `occurred_at` | Timestamptz |
| `source_type`, `source_id` | Optional provenance reference |
| `created_at`, `updated_at` | Timestamps |

Constraints and indexes:

- `amount_minor >= 0`;
- `currency_code` must be a valid normalized three-letter code through a
  check/reference policy;
- index `(tenant_id, owner_user_id, occurred_at desc)`;
- index `(tenant_id, project_id, occurred_at desc)`;
- index `(tenant_id, person_id, occurred_at desc)`.

The database does not assume that all expenses are EGP or have two decimal
places.

### `commitments`

Purpose: promises, obligations, or follow-ups that must remain visible beyond a
single conversation.

| Column | Design |
|---|---|
| `id` | UUID primary key |
| `tenant_id` | FK to `tenants` |
| `owner_user_id` | FK to `users` |
| `project_id` | Optional tenant-scoped FK to `projects` |
| `person_id` | Optional tenant-scoped FK to `people` |
| `title` | Required text |
| `description` | Optional text |
| `status` | `open`, `in_progress`, `fulfilled`, `cancelled`, `archived` |
| `due_at` | Optional timestamptz |
| `timezone` | Optional IANA timezone for local deadlines |
| `created_at`, `updated_at`, `completed_at` | Timestamps |

Indexes:

- `(tenant_id, owner_user_id, status, due_at)`;
- `(tenant_id, project_id, status)`;
- `(tenant_id, person_id, status)`.

### `events`

Purpose: user-facing calendar or time-bound events, distinct from immutable
domain events.

| Column | Design |
|---|---|
| `id` | UUID primary key |
| `tenant_id` | FK to `tenants` |
| `owner_user_id` | FK to `users` |
| `project_id` | Optional tenant-scoped FK |
| `person_id` | Optional tenant-scoped FK |
| `title` | Required text |
| `description` | Optional text |
| `starts_at`, `ends_at` | Timestamptz |
| `timezone` | IANA timezone used for presentation/creation |
| `location` | Optional text |
| `status` | `scheduled`, `cancelled`, `completed` |
| `created_at`, `updated_at` | Timestamps |

Indexes:

- `(tenant_id, owner_user_id, starts_at)`;
- `(tenant_id, project_id, starts_at)`;
- `(tenant_id, person_id, starts_at)`.

### `reminders`

Purpose: durable product reminders, not runtime-private memory.

| Column | Design |
|---|---|
| `id` | UUID primary key |
| `tenant_id` | FK to `tenants` |
| `owner_user_id` | FK to `users` |
| `source_type`, `source_id` | Optional task/commitment/event reference |
| `text` | Required text |
| `due_at` | Timestamptz |
| `timezone` | IANA timezone |
| `lifecycle_status` | `scheduled`, `cancelled`, `archived` |
| `delivery_status` | `pending`, `claimed`, `delivered`, `failed`, `dead_letter` |
| `claimed_at` | Optional timestamptz |
| `lease_until` | Optional timestamptz |
| `attempt_count` | Non-negative integer |
| `max_attempts` | Optional bounded retry count |
| `last_error` | Optional text |
| `delivered_at`, `acknowledged_at` | Optional delivery/user lifecycle timestamps |
| `created_at`, `updated_at` | Timestamps |

Indexes and constraints:

- partial index for due work:
  `(tenant_id, due_at)` where `delivery_status` is `pending` or an expired
  `claimed`;
- index `(delivery_status, lease_until)`;
- `attempt_count >= 0`;
- source references must be tenant-scoped when materialized as typed foreign
  keys.

`DELIVERED` is the explicit delivery state. A reminder may be delivered while
its lifecycle remains active, acknowledged, or later archived. This separation
allows recurring reminders and future channel delivery state without
overloading one `completed` field. The current SQLite single `status` column
will require an explicit mapping during migration.

## 7. Memory model

### Separation

```text
A. Canonical domain data
   people, projects, expenses, tasks, commitments, events, reminders, etc.

B. Structured personal memory
   durable user-owned facts/preferences with provenance and lifecycle

C. Temporary runtime context
   TurnRequest, MemorySnapshot, prompt projection, model response
```

The model provider can propose a memory operation, but only an application use
case can validate and persist it. A conversation or model summary does not
become permanent memory automatically. Durable memory must originate from
explicit user input or an approved, high-confidence application event, and
must retain provenance. Runtime context is reconstructable from canonical
records and structured memory; it is not the system of record.

### `memories`

Purpose: durable structured personal memory distinct from domain entities.

| Column | Design |
|---|---|
| `id` | UUID primary key |
| `tenant_id` | FK to `tenants` |
| `owner_user_id` | FK to `users` |
| `memory_type` | Controlled value such as `preference`, `fact`, `instruction`, `summary` |
| `content` | Canonical structured `jsonb` payload |
| `content_text` | Optional human-readable/searchable context |
| `confidence` | Numeric 0..1 |
| `importance` | Smallint with documented scale |
| `source_type`, `source_id` | Provenance reference |
| `source_excerpt` | Optional evidence text |
| `visibility` | `private`, `tenant`, `shared` |
| `lifecycle` | `active`, `superseded`, `retracted`, `archived` |
| `valid_from`, `valid_until` | Temporal validity |
| `created_at`, `updated_at`, `archived_at` | Timestamps |

Indexes:

- `(tenant_id, owner_user_id, lifecycle, importance desc)`;
- `(tenant_id, owner_user_id, memory_type, lifecycle)`;
- optional full-text index on `content_text`;
- application validation that the source is explicit user input or an
  approved/high-confidence event.

### Typed memory context joins

Core context links use typed join tables instead of a permanent
`entity_type/entity_id` polymorphic link. Each table has the same shape:

| Table | Relationship |
|---|---|
| `memory_people` | Memory → Person |
| `memory_projects` | Memory → Project |
| `memory_tasks` | Memory → Task |
| `memory_commitments` | Memory → Commitment |

Each table contains `tenant_id`, `memory_id`, the typed entity ID, and
`created_at`. The primary key is the tenant plus both IDs, and both sides use
tenant-scoped composite foreign keys. These joins are owner-restricted by the
memory's visibility policy and cannot expand access to the linked entity.

Events and expenses remain queryable through their canonical foreign keys and
provenance fields; they do not require a generic memory-link table in the first
slice.

## 8. Permissions and consent

### `permissions`

Purpose: current capability grants. This is intentionally a foundation, not
the complete permission product.

| Column | Design |
|---|---|
| `id` | UUID primary key |
| `tenant_id` | FK to `tenants` |
| `grantee_type` | `user`, `service`, future `assistant` |
| `grantee_id` | Product principal UUID |
| `capability` | Stable capability identifier |
| `access_level` | `READ`, `COMMUNICATE`, `NEGOTIATE`, `COMMIT`, `EXECUTE` |
| `scope_type` | `tenant`, `entity`, `channel`, `operation` |
| `scope_entity_type` | Optional controlled entity type |
| `scope_entity_id` | Optional UUID |
| `status` | `active`, `revoked`, `expired` |
| `granted_by_user_id` | FK to `users` |
| `expires_at` | Optional timestamptz |
| `revoked_at` | Optional timestamptz |
| `created_at`, `updated_at` | Timestamps |

Constraints and indexes:

- unique active grant over tenant, grantee, capability, access level, and
  scope;
- index `(tenant_id, grantee_type, grantee_id, status)`;
- index `(tenant_id, capability, status, expires_at)`;
- scope entity references must be tenant-scoped through application checks and
  composite references where the type is fixed.

The production foundation reserves all five levels, but the first activated
slice may grant only `READ`, `COMMUNICATE`, and `EXECUTE`. `NEGOTIATE` and
`COMMIT` remain represented but inactive until their policies are approved.
The model cannot create or broaden a permission row.

Personal records and conversations remain owner-only unless an active,
explicitly scoped permission grants access. A graph edge or tenant membership
does not grant sharing. Permission changes are recorded in `audit_events` with
before/after payloads.
A separate permission-history table is not required for the first version.

## 9. Conversations and runtime records

### `conversations`

Purpose: durable product conversation identity, separate from runtime session
identity.

| Column | Design |
|---|---|
| `id` | UUID primary key |
| `tenant_id` | FK to `tenants` |
| `owner_user_id` | FK to `users` |
| `channel` | `web`, future channel identifiers |
| `external_conversation_key` | Optional channel-specific key |
| `status` | `active`, `archived`, `deleted` |
| `started_at`, `last_activity_at`, `created_at`, `updated_at` | Timestamps |
| `metadata` | Optional `jsonb` |

Unique `(tenant_id, owner_user_id, channel, external_conversation_key)` when
the external key is present.

### `conversation_turns`

Purpose: durable user/assistant turn history.

| Column | Design |
|---|---|
| `id` | UUID primary key |
| `tenant_id` | FK to `tenants` |
| `conversation_id` | Tenant-scoped FK |
| `actor_type` | `user`, `assistant`, `system`, `tool` |
| `content` | Structured `jsonb` plus optional text projection |
| `sequence_no` | Monotonic integer per conversation |
| `runtime_session_id` | Optional implementation identifier |
| `idempotency_key` | Optional request key |
| `status` | `received`, `processing`, `completed`, `failed` |
| `created_at`, `completed_at` | Timestamps |

Unique `(tenant_id, conversation_id, sequence_no)`.
Index `(tenant_id, conversation_id, created_at)`.

### `tool_calls`

Purpose: durable trace of tool/action execution.

| Column | Design |
|---|---|
| `id` | UUID primary key |
| `tenant_id` | FK to `tenants` |
| `conversation_id` | Optional tenant-scoped FK |
| `turn_id` | Tenant-scoped FK to `conversation_turns` |
| `tool_name` | Stable product action name |
| `arguments` | `jsonb` |
| `result` | Optional `jsonb` |
| `status` | `proposed`, `authorized`, `completed`, `rejected`, `failed` |
| `error_code` | Optional controlled error |
| `started_at`, `completed_at`, `created_at` | Timestamps |

Indexes:

- `(tenant_id, turn_id, created_at)`;
- `(tenant_id, tool_name, status, created_at)`.

Tool records are audit/history, not a permission source.

Conversations and their turns are owner-only by default. Sharing requires an
explicit permission grant scoped to the conversation or an approved broader
scope. A conversation link is a context edge, not an access grant.

## 10. Retention and privacy

Retention is policy-driven and changeable, not hard-coded into table
deletion behavior. `tenants.retention_policy` stores a versioned configuration
or points to the approved policy configuration used by the application and
scheduled retention workers.

Recommended independent retention classes:

- conversation content and turn payloads;
- tool arguments/results and runtime metadata;
- audit events;
- domain events;
- idempotency responses;
- structured memories;
- canonical domain records.

Retention of conversation, tool, audit, domain-event, or idempotency data must
not automatically delete canonical people, projects, expenses, tasks,
commitments, events, or reminders. Those records follow their own archive and
privacy policy.

Privacy behavior:

- A user may request deletion or redaction of conversation content and tool
  payloads without deleting the canonical records created from them.
- Memory deletion removes or tombstones the memory content and its
  context-link rows, while retaining a minimal privacy/audit record where
  legally required.
- Canonical financial and audit history is archived or redacted according to
  policy; it is not silently cascaded from conversation deletion.
- Domain events are immutable by default. If privacy requires removal of
  sensitive payload data, use a documented redaction/tombstone operation while
  preserving event identity and auditability.
- Retention workers must be tenant-scoped, idempotent, observable, and must
  not infer deletion authority from model output.

## 11. Idempotency, audit, and domain events

### `idempotency_records`

Purpose: durable request deduplication and replay of a committed result.

| Column | Design |
|---|---|
| `id` | UUID primary key |
| `tenant_id` | FK to `tenants` |
| `owner_user_id` | FK to `users` |
| `operation` | Stable use-case name |
| `idempotency_key` | Client/request key |
| `request_fingerprint` | Hash of normalized operation arguments |
| `status` | `processing`, `completed`, `failed` |
| `response` | Optional `jsonb` |
| `resource_type`, `resource_id` | Optional committed resource |
| `expires_at` | Optional retention boundary |
| `created_at`, `completed_at`, `updated_at` | Timestamps |

Unique `(tenant_id, owner_user_id, operation, idempotency_key)`.
The domain write, idempotency completion, audit event, and domain event must
commit in one transaction.

### `audit_events`

Purpose: append-only security and product audit history.

| Column | Design |
|---|---|
| `id` | UUID primary key |
| `tenant_id` | FK to `tenants` |
| `actor_type` | `user`, `service`, `system`, `assistant` |
| `actor_id` | Optional product principal UUID |
| `event_type` | Stable audit event name |
| `aggregate_type`, `aggregate_id` | Optional affected record |
| `conversation_id`, `turn_id` | Optional trace links |
| `payload` | `jsonb` |
| `created_at` | Immutable timestamptz |

Indexes:

- `(tenant_id, created_at desc)`;
- `(tenant_id, event_type, created_at desc)`;
- `(tenant_id, aggregate_type, aggregate_id, created_at desc)`.

Audit rows are append-only. Application roles should not update or delete
them; retention requires an explicit system process.

### `domain_events`

Purpose: immutable product events that can later drive proactive work.

| Column | Design |
|---|---|
| `id` | UUID primary key |
| `tenant_id` | FK to `tenants` |
| `aggregate_type` | `expense`, `task`, `commitment`, etc. |
| `aggregate_id` | UUID |
| `event_type` | `expense.created`, `reminder.due`, etc. |
| `aggregate_version` | Monotonic version where needed |
| `payload` | `jsonb` |
| `occurred_at` | Timestamptz |
| `created_at` | Timestamptz |

Unique `(tenant_id, aggregate_type, aggregate_id, aggregate_version)` when
versioned. Index `(tenant_id, occurred_at)` and
`(tenant_id, event_type, occurred_at)`.

Examples:

```text
expense.created
task.created
commitment.created
reminder.due
person.updated
```

Domain events are written in the same transaction as the state change. They
are not yet a full event bus.

### `outbox_messages` — future, not implemented in Phase 1.2

The design should reserve a durable outbox for external delivery:

| Column | Design |
|---|---|
| `id` | UUID primary key |
| `tenant_id` | FK to `tenants` |
| `domain_event_id` | Tenant-scoped FK |
| `channel_type` | Future channel identifier |
| `destination_key` | Provider/channel destination |
| `delivery_key` | Stable idempotency key |
| `status` | `pending`, `claimed`, `sent`, `failed`, `dead_letter` |
| `attempt_count`, `lease_until`, `last_error` | Retry state |
| `payload` | `jsonb` |
| `created_at`, `sent_at`, `updated_at` | Timestamps |

The outbox row and domain event must be created in the same transaction.
External exactly-once delivery is not promised; the channel adapter must use
`delivery_key` where supported.

## 12. Context graph queries

The first queryable graph should support:

- Person → Project through `project_people`.
- Person → Expense through `expenses.person_id`.
- Person → Commitment through `commitments.person_id`.
- Project → Expense through `expenses.project_id`.
- Project → Task through `tasks.project_id`.
- Project → Commitment through `commitments.project_id`.
- Conversation → Person through `conversation_people`.
- Conversation → Project through `conversation_projects`.
- Conversation → Task through `conversation_tasks`.
- Conversation → Commitment through `conversation_commitments`.
- Memory → Person through `memory_people`.
- Memory → Project through `memory_projects`.
- Memory → Task through `memory_tasks`.
- Memory → Commitment through `memory_commitments`.

### Typed conversation context joins

Core conversation context uses typed join tables:

| Table | Relationship |
|---|---|
| `conversation_people` | Conversation → Person |
| `conversation_projects` | Conversation → Project |
| `conversation_tasks` | Conversation → Task |
| `conversation_commitments` | Conversation → Commitment |

Each table contains `tenant_id`, `conversation_id`, the typed entity ID, and
`first_referenced_at`, `last_referenced_at`. Each uses a composite primary key
over the tenant and both entity IDs, plus tenant-scoped foreign keys.

This avoids making polymorphic links a permanent part of the core Context
Graph. Additional typed joins can be added only when a real query/use case
justifies them.

## 13. RLS and identity summary

RLS is specified in `docs/architecture/rls-design.md`.

The essential rule is:

```text
auth.uid()
  -> users.auth_subject
  -> users.id
  -> active tenant_memberships
  -> row tenant_id and owner_user_id checks
```

The application still passes a trusted `ExecutionContext`, but authenticated
database sessions derive membership from `auth.uid()` rather than trusting
`tenant_id`, `user_id`, or capabilities from model output.

Service-role workers are infrastructure principals. They bypass Supabase RLS
by design, so they must receive a server-derived tenant scope, use application
use cases, and write audit records. A service role must never be exposed to a
client or model.

## 14. SQLite → Postgres migration plan

No migration is performed in this phase.

### Current SQLite tables

| SQLite table | Proposed Postgres destination | Main work |
|---|---|---|
| `people` | `people` | UUID IDs, ownership, archive lifecycle, composite references |
| `projects` | `projects` | UUID IDs, normalized name key, lifecycle |
| `expenses` | `expenses` | `bigint`, currency metadata, tenant-scoped FKs |
| `reminders` | `reminders` | `timestamptz`, lease fields, retry lifecycle |
| `idempotency_records` | `idempotency_records` | `jsonb`, status/resource fields, retention |
| `audit_events` | `audit_events` | append-only actor/aggregate structure, `jsonb` |

New tables are required for tenants, users, memberships, relationships,
project links, tasks, commitments, events, memories, typed memory joins,
permissions, conversations, turns, tool calls, typed conversation joins, and
domain events. The outbox remains a later addition.

### Type mappings

| SQLite | Postgres |
|---|---|
| Text IDs such as `expense_<uuid>` | UUID primary keys |
| ISO timestamp text | `timestamptz` |
| Integer amount minor units | `bigint` plus `currency_code` resolved through `currency_metadata` |
| JSON text | `jsonb` |
| `BEGIN IMMEDIATE` | Postgres transaction isolation and row locks |
| SQLite `lower(name)` lookup | normalized `name_key` and/or expression index |
| Shared SQLite connection | pooled Postgres connections |
| WAL file durability | Postgres WAL and managed durability |

### Data migration considerations

1. Create tenants/users/memberships before importing tenant-owned records.
2. Establish a deterministic mapping from legacy text IDs to UUIDs.
3. Preserve old IDs in an optional `legacy_id` column or mapping table during
   migration.
4. Normalize timestamps to UTC and validate malformed values.
5. Normalize names into `name_key` before applying uniqueness constraints.
6. Validate every person/project foreign key belongs to the same tenant.
7. Preserve idempotency fingerprints and replayable results.
8. Import audit history before enabling append-only policies.
9. Map the current single reminder status into the future lifecycle and
   delivery statuses, explicitly preserving `DELIVERED` semantics.
10. Validate row counts, tenant counts, foreign-key integrity, and scoped
    read/write tests before cutover.

## 15. Remaining open questions

1. How is the active tenant selected and persisted in the server/session
   context when a user belongs to multiple tenants?
2. Which tenant roles may grant explicit sharing and which may grant
   `EXECUTE`?
3. What is the first outbox channel and what delivery/idempotency contract
   does it provide?
4. Which exact retention periods and legal/privacy rules apply per retention
   class?
5. Which memory event types qualify as approved/high-confidence sources, and
   who can override or retract them?
6. Should domain events be partitioned by time once production volume is known?
7. Which canonical records may be hard-deleted, and how should required audit
   references be redacted?

## 16. Approval gate

The design is ready for review, not implementation. The next implementation
step should begin only after the ownership model, Auth-to-user mapping,
permission scope, currency representation, and RLS policy strategy are
approved.
