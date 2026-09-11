# Phase 1 Implementation Audit

**Audit date:** 2026-09-11  
**Scope:** First-party Phase 1 implementation only  
**Hermes:** Explicitly excluded and inactive  
**Overall result:** **PASS WITH ISSUES**

The core vertical slice works and the main ownership boundary is visible:
the API creates a server-derived context, the first-party runtime plans,
application use cases authorize and mutate, and SQLite persists the result.
The implementation is not yet a production multi-tenant or 24/7 deployment.
The most important open issues are authentication, per-turn capability
enforcement, reminder crash recovery, readiness accuracy, and the limits of
the current SQLite adapter.

## 1. Tenant and identity isolation

### Flow traced

```text
POST /v1/turns
  -> apps/api/main.py:54-89
  -> ExecutionContext at apps/api/main.py:68-80
  -> FirstPartyRuntime.handle at packages/agent_runtime/first_party.py:38-60
  -> allowlisted intent dispatch at packages/agent_runtime/first_party.py:77-186
  -> ApplicationService use case
  -> SQLiteStore queries and transaction
```

### Findings

**PASS for the current development API path:**

- `tenant_id` and `user_id` are read from `SERVER_TENANT_ID` and
  `SERVER_USER_ID`, not from the HTTP body or model output
  (`apps/api/main.py:66-80`).
- The model receives `ExecutionContext` as part of `ModelRequest`, but the
  model response contains an intent and arguments, not a replacement context
  (`packages/llm/gateway.py:9-32`).
- The runtime passes the original `request.context` to each application use
  case (`packages/agent_runtime/first_party.py:81-85`,
  `122-125`, and `154-160`).
- People, projects, expenses, summaries, idempotency records, and audit writes
  use the context's tenant/user fields. Retrieval queries are scoped by both
  tenant and user (`packages/application/use_cases.py:45-89`,
  `116-118`, `190-212`).
- A future authentication middleware can replace the resolver block in the API
  without changing domain or application use cases. Those layers consume
  `ExecutionContext`, not environment variables
  (`packages/contracts/models.py:9-21`).

### Bypasses and limitations

1. **No real authentication exists yet.** Every HTTP request in one process
   receives the same configured identity. If the environment variables are
   absent, all requests use the shared development defaults
   (`apps/api/main.py:66-70`). This is server-derived, but it is not
   multi-user identity isolation.
2. **The API grants the same capabilities to every request**
   (`apps/api/main.py:73-79`). User-specific permission resolution is not
   implemented.
3. **`TurnRequest.allowed_capabilities` is currently ignored.** The
   application checks `ExecutionContext.capabilities`, but the per-turn
   capability set in the request is never intersected with it
   (`packages/contracts/models.py:34-43`,
   `packages/application/use_cases.py:40-43`). A caller with a broad context
   could not use this field to reduce permissions for one turn.
4. `ExecutionContext` is a trusted in-process object, not a cryptographically
   verified principal. Code that bypasses the API could construct an arbitrary
   context. That is an internal boundary limitation, not an HTTP model-input
   bypass.
5. Person/project foreign keys are checked by ID only. The current use cases
   resolve names within the current owner, so the vertical slice does not
   inject cross-tenant IDs. A future mutation accepting arbitrary person or
   project IDs must verify tenant/user ownership or use composite constraints.
6. The worker's global due-reminder claim is intentionally not a user query,
   but `mark_reminder_delivered` accepts only a reminder ID
   (`packages/application/use_cases.py:290-320`). It must remain worker-internal
   or gain ownership/authorization checks before any user-facing reuse.

## 2. Authorization boundary

### Result: PASS WITH ISSUES

- Current runtime mutations call only `ApplicationService.record_expense` and
  `ApplicationService.create_reminder`
  (`packages/agent_runtime/first_party.py:81-85` and `152-160`).
- Both mutations call `_assert_capability` before persistence
  (`packages/application/use_cases.py:102` and `231`).
- Expense retrieval also has an explicit read capability
  (`packages/application/use_cases.py:186-195`).
- The runtime has no `SQLiteStore` reference and no SQL statements
  (`packages/agent_runtime/first_party.py:20-25`).
- The deterministic provider cannot directly invoke persistence.
- No external action implementation exists yet, so there is currently no
  external-send mutation path to audit.

The boundary is enforced by module ownership and constructor wiring, not by a
type system or capability-limited persistence interface. `SQLiteStore` has
public `execute`, `transaction`, and fetch methods
(`packages/persistence/sqlite.py:112-133`). A future developer could bypass
the application layer by importing the store directly. This is a code
architecture guardrail, not a hard security boundary.

The malicious-provider test confirms that supplying `tenant_id` or `user_id`
inside model arguments cannot override the trusted context: the current
Python signature rejects the injected fields before any write. However, it
currently surfaces as an uncaught `TypeError`, which the API converts to a
500 response. The next hardening step should validate intent arguments and
return a structured rejected action rather than expose an internal exception.

## 3. Idempotency

### Result: PASS for domain writes; PARTIAL for worker delivery

HTTP extracts `Idempotency-Key` or a body key and generates a key only when
the caller supplies neither (`apps/api/main.py:60-65`). The key is passed into
the runtime and then into each mutation use case.

Expense and reminder mutations:

1. fingerprint their operation arguments
2. look up `(tenant_id, user_id, idempotency_key)`
3. reject the same key with a different fingerprint
4. perform domain writes, idempotency record, and audit event in one
   `BEGIN IMMEDIATE` transaction
5. return the stored result for a repeated equivalent request

Relevant references:

- `packages/application/use_cases.py:107-184`
- `packages/application/use_cases.py:234-288`
- `packages/persistence/sqlite.py:112-121`
- `packages/persistence/sqlite.py:135-162`

### Crash behavior

| Crash point | Current behavior |
|---|---|
| Before persistence transaction | No domain mutation; retry can execute |
| During transaction | SQLite rollback/journal semantics should remove the partial transaction |
| After commit, before HTTP response | Retry returns the stored idempotent result; no duplicate expense/reminder |
| After reminder claim, before delivery completion | Row remains `claimed`; current worker does not reclaim it |
| After future external delivery, before `delivered` update | External delivery could be duplicated or reconciliation could be required; no outbox exists yet |

The HTTP/domain idempotency tests pass for expenses and reminders. Reminder
processing is not fully crash-safe: a claimed row has no lease, timeout, retry
state, or recovery path. This is a release-blocking issue for reliable
proactive delivery, though not for the current proof-of-architecture slice.

## 4. Domain model status

| Domain capability | Status | Current evidence / gap |
|---|---|---|
| Users / tenants | **PARTIAL** | Context fields and server defaults exist; no persisted identity, tenant table, or auth middleware |
| People | **IMPLEMENTED** | Basic tenant/user-scoped person resolution and persistence |
| Relationships | **PLANNED** | No entity or table |
| Projects | **IMPLEMENTED** | Basic tenant/user-scoped project resolution and persistence |
| Expenses | **IMPLEMENTED** | Record, retrieve by project, idempotency, and audit event |
| Tasks | **PLANNED** | No entity or table |
| Commitments | **PLANNED** | No entity or table |
| Events | **PLANNED** | No entity or table |
| Reminders | **PARTIAL** | Durable creation and basic worker processing; no reliable delivery/recovery/outbox |
| Memories | **PARTIAL** | `MemorySnapshot` contract exists; no structured personal-memory persistence or retrieval service |
| Permissions | **PARTIAL** | In-process capability checks exist; no persisted grants, consent, expiry, or policy service |
| Conversations | **PARTIAL** | Product conversation ID travels through a turn and audit event; no conversation/turn tables |
| Tool calls | **PARTIAL** | `ToolTrace` is returned; no durable tool-call ledger |
| Audit events | **IMPLEMENTED** | Basic expense/reminder mutation events are persisted; coverage/query policy is incomplete |

The SQL migration reflects only the current slice and intentionally does not
claim to implement the missing domain (`supabase/migrations/0001_personal_ai_os_foundation.sql:51-52`).

## 5. Context and memory separation

### Result: PASS for the current slice; structured personal memory is missing

1. **Canonical structured domain data:** expenses, people, projects, reminders,
   idempotency records, and audit events live in the persistence adapter.
2. **Structured personal memory:** not implemented yet. `MemorySnapshot` is
   only a contract for a product-owned projection
   (`packages/contracts/models.py:24-30`).
3. **Temporary runtime context:** `TurnRequest` and `ModelRequest` carry the
   request context and optional snapshot
   (`packages/contracts/models.py:34-43`,
   `packages/llm/gateway.py:9-14`).

The development provider only returns an `IntentPlan`; it cannot write
canonical data. The runtime sends mutations to application use cases, and the
provider is not a persistence source. `memory_operations` is currently an
empty result field, so no hidden model-memory system exists.

## 6. ModelGateway

### Result: PASS

`FirstPartyRuntime` depends on the `ModelGateway` protocol rather than a
provider class (`packages/agent_runtime/first_party.py:17` and
`27-33`). The protocol has one provider-neutral `complete` method
(`packages/llm/gateway.py:35-43`).

The deterministic provider has no network access and no credentials. Gemini,
Qwen, DeepSeek, OpenAI, and OpenAI-compatible local endpoints can later
implement the same `ModelGateway.complete(ModelRequest) -> ModelResponse`
contract. Application and domain use cases do not import provider code, so
provider replacement does not require changing them.

The current model response is trusted as a plan shape after intent-name
dispatch. Argument schema validation and provider-specific timeout/retry
policy are still missing.

## 7. Worker and 24/7 readiness

### Result: PASS WITH ISSUES

**Positive findings:**

- API and worker are separate processes (`apps/api/main.py:99-113`,
  `apps/worker/main.py:40-55`).
- Domain state is persisted; the runtime does not rely on in-memory records.
- SQLite uses WAL and transaction boundaries
  (`packages/persistence/sqlite.py:98-121`).
- Worker handles SIGTERM/SIGINT by stopping its loop
  (`apps/worker/main.py:18-19` and `46-47`).
- The normal worker path claims once, marks delivered, and does not process the
  same delivered row again (`apps/worker/main.py:21-31`).
- The code does not require a Replit tab or developer workstation to remain
  open.

**Issues:**

1. Claimed reminders are not reclaimed after worker crash. There is no lease,
   `claimed_at`, retry count, dead-letter state, or recovery query
   (`packages/persistence/sqlite.py:45-54`,
   `packages/application/use_cases.py:290-314`).
2. The API has no SIGTERM handler. Its graceful cleanup is only reached through
   `KeyboardInterrupt` (`apps/api/main.py:107-113`).
3. `/readyz` returns `"ready"` without querying the persistence connection
   (`apps/api/main.py:45-46`). It does not reflect actual dependency health.
4. There is no metrics endpoint or durable outbox for external delivery.
5. The worker uses polling rather than a durable queue. That is acceptable for
   this slice but limits scale and precise scheduling.

Therefore this is **24/7-ready in process shape**, not currently hosted 24/7.
No persistent production host, supervisor, managed database, queue, alerting,
or deployment has been configured.

## 8. SQLite to Postgres readiness

### Current transaction and concurrency assumptions

- `BEGIN IMMEDIATE` is SQLite-specific and serializes writers per database
  (`packages/persistence/sqlite.py:112-121`).
- WAL mode is enabled at connection startup
  (`packages/persistence/sqlite.py:102-110`).
- `check_same_thread=False` shares a connection across API request threads,
  but there is no explicit connection pool or Python lock
  (`packages/persistence/sqlite.py:102-106`).
- Worker claiming uses select-then-conditional-update, not a Postgres
  `FOR UPDATE SKIP LOCKED` claim pattern
  (`packages/application/use_cases.py:292-313`).
- Reads outside explicit transactions use the shared connection directly.

### Data type and schema mapping risks

- IDs are application-generated text such as `expense_<uuid>` in SQLite, while
  the future migration uses UUID columns. The adapter contract needs one
  deliberate ID strategy.
- Timestamps are ISO strings in SQLite and `timestamptz` in Postgres.
  UTC normalization and comparison semantics must be preserved.
- `amount_minor INTEGER` maps well to `bigint`, but currency precision and
  multi-currency aggregation rules are not defined.
- JSON is stored as text in `idempotency_records` and `audit_events`; Postgres
  should likely use `jsonb` with validation/index decisions.
- SQLite's `lower(name)` behavior and the current case-sensitive unique
  constraint do not exactly match the query behavior. The Postgres migration
  uses expression indexes, but SQLite does not.
- SQLite foreign keys are enabled, but the current person/project references
  are not composite tenant-scoped foreign keys.

### Required Postgres design work later

- RLS policies for every tenant-owned table
- composite ownership constraints or service-layer ownership checks
- unique `(tenant_id, user_id, idempotency_key)`
- idempotency request fingerprint, result, status, and retention policy
- indexes beginning with tenant/user scope for common reads
- a safe claim pattern using row locks and leases
- outbox/event delivery semantics
- durable conversation, turn, tool-call, permission, and memory tables
- connection pooling and transaction isolation policy
- audit append-only constraints and access policy

The existing application service boundary is a useful replacement seam, but
the SQLite adapter is not yet proof that Postgres replacement is drop-in.

## 9. Hermes audit

### Result: PASS

The active application has:

- no Hermes imports
- no Hermes dependency in `pyproject.toml`
- no Hermes startup or launch command
- no Hermes runtime calls
- no Hermes-generated canonical state

`packages/runtime-hermes/` contains only an inactive README and an empty
marker. Its rules explicitly prohibit adding dependencies, imports, launches,
vendored code, or forks (`packages/runtime-hermes/README.md:1-15`).

The active runtime imports only product-owned contracts, application services,
and the provider-neutral gateway (`packages/agent_runtime/first_party.py:8-17`).

## 10. Tests

Focused tests were added in `tests/test_phase1_boundaries.py` for:

- cross-tenant retrieval isolation
- unauthorized expense and reminder mutations
- model-supplied tenant/user argument rejection
- expense and reminder idempotency
- persisted expense retrieval after store restart
- normal reminder processing without repeat after delivery/restart
- explicit detection of the claimed-reminder crash recovery gap
- first-party runtime import without a Hermes module

Existing vertical-slice tests remain in `tests/test_vertical_slice.py`.

Latest verification:

```text
python -m unittest discover -q
Ran 11 tests ... OK
```

The tests prove the current vertical slice and expose the known claimed-state
recovery limitation. They do not constitute a production penetration test,
load test, or Postgres/RLS test.

## 11. Recommended next step

Do not migrate to Supabase or add a real provider yet.

The next step should be a small hardening pass, still before feature
expansion:

1. introduce an explicit authentication/principal resolver interface
2. intersect `TurnRequest.allowed_capabilities` with server-granted context
   capabilities
3. validate model intent names and argument schemas before dispatch
4. add API signal handling and a real persistence probe for `/readyz`
5. add reminder leases/retries and an outbox boundary
6. define the persistence ports and Postgres mapping contract

After those boundaries are tested, the project can move to a Postgres adapter
and then select one real `ModelGateway` provider without changing the domain
or runtime contracts.

## Phase 1.1 — Security and Reliability Hardening

**Status:** Completed  
**Result:** Hardening tests pass; SQLite remains the active development adapter.

### Issues fixed

- Added a replaceable `AuthenticationProvider` boundary in
  `packages/identity/auth.py`. The development API now maps bearer tokens to
  server-side `TrustedIdentity` objects. Request bodies and model arguments
  cannot supply tenant or user identity.
- Added structured 401 responses for missing/invalid identity and structured
  400/403 responses for rejected runtime actions.
- Enforced `TurnRequest.allowed_capabilities` as an upper bound by intersecting
  it with trusted server capabilities before model planning and application
  dispatch (`packages/agent_runtime/first_party.py`).
- Added model intent argument allowlists. Identity and capability fields are
  rejected as action arguments instead of reaching application calls or
  becoming an HTTP 500.
- Added reminder `claimed_at`, `lease_until`, `attempt_count`, and
  `last_error` fields. Expired claims can be reclaimed, failed deliveries
  return to pending with observable error state, and completed reminders
  cannot be claimed again.
- Added persistence probing to `/readyz`, retained `/healthz` as a process
  liveness endpoint, and added SIGTERM/SIGINT shutdown handling for the API.
- Kept worker, application, runtime, persistence, and model gateway boundaries
  separate.

### Remaining limitations

- Development authentication is not production authentication. A future auth
  provider must replace `DevelopmentAuthenticator` with the same
  `AuthenticationProvider` contract.
- Reminder delivery still needs a durable outbox and external-channel
  idempotency key before real Telegram or other delivery is added.
- SQLite still uses a shared development connection, WAL, and SQLite
  transaction semantics. Postgres/Supabase and RLS are not implemented.
- Capabilities are development token policy, not the final persisted
  permission/consent product.
- The deterministic provider remains active; no production AI provider has
  been added.

### Tests added and result

`tests/test_phase1_boundaries.py` now covers trusted identity, cross-tenant
isolation, missing/invalid authentication, capability upper bounds, final
application authorization, model identity/capability injection, reminder
leases, retries, restart recovery, readiness, shutdown, idempotency, and
Hermes-free imports.

The complete suite result is:

```text
Ran 19 tests ... OK
```

The claimed-reminder recovery test simulates a worker crash by expiring the
lease and confirms that a later worker reclaims and completes the reminder.

### Current 24/7 readiness

The system is more robustly **24/7-ready**, but it is still not hosted 24/7.
API and worker remain independent processes, durable state survives process
restart, API readiness checks persistence, worker claims are lease-based, and
both services support graceful shutdown paths. No production host, process
supervisor, queue, managed database, alerting, or external channel delivery
has been configured.