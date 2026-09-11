# Personal AI OS — Supabase/Postgres RLS Design

**Phase:** 1.2 — Design review only  
**Status:** Baseline accepted for design review; no policies deployed  
**Date:** 2026-09-11  

This document defines the database-level tenant security strategy for the
proposed Postgres/Supabase model. It is policy design, not a migration. No SQL
in this document should be executed until the ownership model and Auth
mapping are approved.

## Accepted RLS baseline

The RLS design now follows these approved decisions:

- Personal OS records and conversations are owner-only by default.
- Any sharing is an explicit permission grant; tenant membership and context
  graph edges do not grant access.
- A user may belong to multiple tenants. Active tenant selection is a
  server/session concern and is never supplied by the model or request body.
- Product `users.id` is an independent UUID mapped through
  `users.auth_subject`; it is not assumed to equal `auth.users.id`.
- The permission model reserves `READ`, `COMMUNICATE`, `NEGOTIATE`, `COMMIT`,
  and `EXECUTE`. The first active slice may use only `READ`,
  `COMMUNICATE`, and `EXECUTE`.
- The initial worker may use the Supabase service role as a trusted
  infrastructure path. The boundary must remain replaceable with a
  least-privilege Postgres role.
- Core Context Graph relationships use typed join tables, not permanent
  polymorphic links.

## 1. Security objectives

The database must independently prevent:

- a user from reading another tenant's records;
- a user from writing a row under another tenant;
- a user from attaching a record from another tenant through a relationship;
- a client from selecting a tenant by changing a request body or JWT-like
  model output;
- a model from choosing identity, permissions, or database claims;
- a service-role operation from being mistaken for end-user authorization.

Application authorization remains necessary. RLS is the second boundary.

## 2. Identity mapping

The proposed identity chain is:

```text
Supabase Auth JWT
  -> auth.uid()
  -> users.auth_subject
  -> product users.id
  -> active tenant_memberships
  -> trusted tenant/user scope
  -> ExecutionContext
```

### Rules

1. `auth.uid()` is the only user identity source for an end-user database
   session.
2. `tenant_id` is resolved through `tenant_memberships`; it is not trusted
   from a request body, prompt, model response, or arbitrary JWT metadata.
3. If a user belongs to multiple tenants, the API selects an active tenant
   from a server/session context and verifies membership before creating
   `ExecutionContext`.
4. The selected tenant must still satisfy the RLS policy for every query.
5. Capabilities are resolved by the application permission service and are
   never granted by the model.
6. `ExecutionContext` is immutable after creation and carries the
   server-derived tenant/user identity into application use cases.
7. `users.id` is a product UUID independent from `auth.users.id`; only
   `users.auth_subject` performs the Auth mapping.

### Suggested helper functions

The eventual database layer should expose carefully reviewed helper functions
with a fixed `search_path`, such as:

```text
app.current_product_user_id()
app.is_active_tenant_member(target_tenant_id)
app.can_access_owned_row(target_tenant_id, owner_user_id)
```

These are conceptual names. Their implementation must avoid recursive RLS
queries and must be covered by cross-tenant tests.

`current_product_user_id()` maps `auth.uid()` to `users.id`. It must return no
identity when the mapping is absent or the product user is disabled.

## 3. Tenant ownership rules

### Required columns

Every tenant-owned table includes:

```text
tenant_id uuid not null
```

Every personal/user-owned table also includes:

```text
owner_user_id uuid not null
```

Records created by a system process may use `created_by_user_id` or an
explicit actor field, but the data's tenant ownership remains mandatory.

### Ownership classes

1. **Tenant-owned and owner-restricted:** people, projects, expenses, tasks,
   commitments, events, reminders, memories.
2. **Tenant-owned and explicitly shared:** selected projects, domain records,
   or conversations only when an explicit permission grants access.
3. **Tenant-owned append-only:** audit events and domain events.
4. **Global/account identity:** users, with tenant membership through
   `tenant_memberships`.
5. **Worker/system records:** outbox and worker lease rows, still tenant-owned
   even when processed by a service role.

The initial and ongoing Personal OS default is owner-restricted. Sharing is an
explicit product permission, not an accidental consequence of tenant
membership, a graph edge, or a conversation link. Business Mode can later
add shared tenant records by extending the permission predicate.

## 4. RLS policy shape

For a user-owned table such as `expenses`, the policy shape is:

```text
SELECT:
  row.tenant_id is an active tenant of auth.uid()
  AND row.owner_user_id = current_product_user_id()

INSERT:
  row.tenant_id is an active tenant of auth.uid()
  AND row.owner_user_id = current_product_user_id()

UPDATE:
  old row satisfies SELECT
  AND new row satisfies INSERT ownership conditions

DELETE:
  denied by default; archive through an authorized application operation
```

For a membership-shareable table such as a future shared project, the
ownership predicate can become:

```text
row.owner_user_id = current_product_user_id()
OR an active permission grants access to this row
```

The permission lookup must itself be tenant-scoped and must not use a
model-supplied tenant or entity ID.

## 5. Representative table policies

These are policy requirements, not executable migration statements.

### `people`

- Enable RLS.
- Select only when the row's `tenant_id` is a tenant of `auth.uid()` and the
  current user owns the row, unless an explicit sharing permission exists.
- Insert only when `tenant_id` is a current tenant and `owner_user_id` equals
  the mapped product user.
- Update must check both old-row access and new-row ownership.
- Deny physical delete to normal users; archive through the application.

### `projects`

- Same owner and tenant rules as people by default.
- `project_people` never makes a project shared; only an explicit
  `project.read`/`project.write` permission can do so.
- A project link cannot grant access to a person or expense outside the same
  tenant.

### `expenses`

- Select/insert/update predicates require matching `tenant_id` and owner.
- `person_id` and `project_id` references must be same-tenant composite
  foreign keys.
- Insert cannot set `owner_user_id` to another user.
- Cross-tenant reads return no rows, not a row with redacted data.

### `relationships`

- Both source and target person references use composite
  `(tenant_id, person_id)` foreign keys.
- RLS checks membership/ownership for the relationship row.
- An edge cannot be used to infer or join a person from another tenant.
- Updates cannot change `tenant_id` or move an edge across tenants.

### `conversations` and `conversation_turns`

- Owner-only by default.
- Sharing requires an explicit conversation-scoped or approved broader
  permission.
- A turn inherits the conversation tenant through a tenant-scoped foreign key.
- A client cannot insert a turn for a conversation it cannot select.
- Runtime session IDs are metadata and never a security principal.

### `memories`

- Private memories are readable only by their owner.
- Tenant/shared visibility requires an explicit policy and permission.
- RLS checks `tenant_id` and `owner_user_id` before exposing provenance or
  source excerpts.
- Memory references cannot expand visibility beyond the memory's own policy.

### `permissions`

- Users may not grant themselves permissions.
- Grant/revoke operations require an application use case and an authorized
  grantor.
- The schema reserves `READ`, `COMMUNICATE`, `NEGOTIATE`, `COMMIT`, and
  `EXECUTE`; the first active slice may issue only `READ`, `COMMUNICATE`, and
  `EXECUTE`.
- A permission row is visible only to authorized tenant administrators or its
  subject, according to future product policy.
- Every grant/revoke is copied to append-only `audit_events`.

### `audit_events` and `domain_events`

- End-user roles may read only rows within their tenant and allowed visibility.
- Normal end-user roles cannot update or delete events.
- Inserts should be performed by application/service roles after authorization;
  a client must not forge an actor or aggregate tenant.

## 6. Cross-tenant relationship protection

Tenant boundaries must be enforced at three levels:

1. **Schema:** composite tenant-scoped foreign keys:

   ```text
   (tenant_id, project_id)
     -> projects(tenant_id, id)
   ```

2. **RLS:** the current session must be allowed to see the relationship row
   and all referenced rows.
3. **Application:** use cases resolve and authorize referenced entities within
   the trusted `ExecutionContext`.

A UUID alone is not enough. A malicious client or malformed model output could
otherwise provide a valid entity ID from another tenant. Composite references
make the database reject that mismatch.

Core context relationships use typed tables such as
`conversation_people`, `conversation_projects`, `conversation_tasks`,
`conversation_commitments`, `memory_people`, `memory_projects`,
`memory_tasks`, and `memory_commitments`. Each typed table has tenant-scoped
foreign keys to both sides, so RLS and the schema can enforce the boundary.
New polymorphic links are not the default design for the core graph.

## 7. End-user sessions versus backend service role

### End-user/API path

- Use Supabase `authenticated` sessions.
- The API validates the Auth token and constructs `TrustedIdentity`.
- Queries execute with the user identity available to `auth.uid()`.
- RLS is active and denies rows outside membership/ownership.
- Application use cases still perform capability and consent checks.

### Worker/system path

The initial trusted worker may use Supabase service-role access, which bypasses
normal RLS. It must therefore be treated as a privileged infrastructure path:

- never expose service credentials to clients, models, or channels;
- never accept tenant/user identity from model output;
- receive tenant scope from a trusted job/domain event;
- call the same application use cases where possible;
- write an actor type of `system` or `service` to audit events;
- keep every row write explicitly tenant-scoped;
- add separate integration tests for service-role scoping.

The worker boundary must not depend on service-role semantics. Later it can be
replaced with a least-privilege Postgres role with only the required tables and
operations, without changing domain use cases or `ExecutionContext`.

## 8. Permission interaction

RLS answers:

```text
May this database principal see or write this tenant-owned row?
```

Application authorization answers:

```text
May this actor perform this capability on this operation now?
```

Examples:

- RLS may allow a user to read their expense row.
- The application may still deny a runtime action because the current turn
  lacks `expenses.read`.
- RLS may allow a tenant administrator to read a permission row.
- The application decides whether that administrator may grant
  `COMMIT`/`EXECUTE`.

The model never participates in either identity or grant resolution.

### Retention and privacy boundary

RLS controls who may access a row; retention policy controls how long the row
or its sensitive payload remains. These are separate concerns.

- Conversation and tool payloads may be redacted or deleted without deleting
  canonical domain records created from them.
- Memory deletion must remove or tombstone memory content and typed context
  joins, while retaining only the minimum required privacy/audit record.
- Audit and domain-event retention must not cascade into deletion of canonical
  people, projects, expenses, tasks, commitments, events, or reminders.
- Domain events are append-only by default. Privacy-driven payload redaction
  must preserve event identity and auditability.
- Retention workers operate with explicit tenant scope and must not infer
  deletion authority from model output.

## 9. Domain events and outbox security

Domain events inherit `tenant_id` from the authorized mutation. The mutation,
domain event, and future outbox row must be inserted in one transaction.

Outbox workers may use a service role, but each row must include:

- tenant ID;
- source domain event ID;
- destination/channel;
- stable delivery key;
- lease and retry fields.

An outbox worker must not query all tenants and make decisions from message
content alone. It claims a tenant-scoped row, uses the server-known
destination, and records attempts and errors.

## 10. RLS test matrix

Before enabling production policies, test at least:

| Scenario | Expected result |
|---|---|
| User A selects tenant A expense | Row visible |
| User A selects tenant B expense | No row |
| User A inserts row with tenant B | Rejected |
| User A inserts tenant A row owned by user B | Rejected |
| User A references tenant B project UUID with tenant A | Foreign-key/policy rejection |
| User A updates tenant B relationship | Rejected/no row |
| User A reads memory linked to tenant B | No row |
| User A changes request tenant field | Database still uses Auth/membership scope |
| Model returns another tenant/user | No effect on database context |
| Revoked membership reads old tenant data | No row |
| Suspended product user queries data | No row |
| Service worker claims tenant-scoped outbox row | Only its authorized job scope |

Tests must run against an actual Postgres/Supabase environment. SQLite tests
cannot prove RLS behavior.

## 11. Operational safeguards

- Set a fixed `search_path` for security-definer helper functions.
- Revoke public execute privileges from helper functions unless explicitly
  needed.
- Never put service-role credentials in Android, Telegram, prompt context, or
  model provider configuration.
- Log authentication failures and authorization denials without logging
  credentials or sensitive payloads.
- Keep RLS enabled on every tenant-owned table, including future join,
  event, outbox, and link tables.
- Review policies whenever a new table gains a tenant reference.
- Add schema checks that reject nullable `tenant_id` on tenant-owned tables.

## 12. Open questions

1. Which tenant roles may grant explicit sharing, and which may grant
   `EXECUTE`?
2. How is the active tenant selected and persisted in the server/session
   context?
3. What exact retention periods and legal/privacy rules apply to each
   retention class?
4. Which memory event types qualify as approved/high-confidence durable
   sources?
5. Which audit and domain-event rows are visible to ordinary users?
6. When should a typed context join be replaced with a more specialized
   access-controlled relation?

## 13. Approval gate

No RLS policy or migration should be implemented until the following are
approved:

- tenant/membership semantics;
- owner versus shared-record rules;
- Supabase Auth subject mapping;
- service-role worker boundary;
- permission scope vocabulary;
- composite foreign-key strategy;
- treatment of polymorphic context links.