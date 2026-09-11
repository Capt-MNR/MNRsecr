# Phase 1 Foundation

**Status:** Implemented foundation  
**Active runtime:** FirstPartyRuntime  
**Hermes:** Optional and inactive

## Boundaries

```text
HTTP API / future channels
        |
        v
Server-derived ExecutionContext
        |
        v
FirstPartyRuntime
        |
        +--> ModelGateway
        |
        +--> ApplicationService
                  |
                  +--> capability authorization
                  +--> domain mutation/read use cases
                  +--> durable persistence adapter

Durable reminder records --> separate worker process
```

The runtime owns orchestration only. It does not own tenant identity, domain
records, permissions, canonical memory, or scheduling state.

## Contracts

`packages/contracts/models.py` defines:

- `ExecutionContext`
- `MemorySnapshot`
- `TurnRequest`
- `ProposedAction`
- `ToolTrace`
- `UsageMetadata`
- `TurnResult`

`packages/agent_runtime/port.py` defines:

```text
AgentRuntime.handle(TurnRequest) -> TurnResult
```

`packages/llm/gateway.py` defines:

```text
ModelGateway.complete(ModelRequest) -> ModelResponse
```

The development implementation is deterministic and local:
`DeterministicDevelopmentProvider`. It requires no provider key and performs
no network call. Hosted providers can implement the same contract later.

## First vertical slice

The active flow is:

```text
Arabic message
  -> deterministic intent plan
  -> FirstPartyRuntime dispatch
  -> ApplicationService capability check
  -> resolve/create Person and Project
  -> persist Expense
  -> structured TurnResult
```

Expense retrieval queries the persisted `expenses` table. It does not use
model memory. Reminder creation persists a product-owned reminder with a
timezone and due time; it is not stored in runtime memory.

## 24/7-ready process model

Run the services as separate long-lived processes in a persistent deployment:

```bash
python -m apps.api.main
python -m apps.worker.main
```

The API provides:

- `GET /healthz`
- `GET /readyz`
- `POST /v1/turns`

Development API requests authenticate with `Authorization: Bearer dev-user`;
the token is mapped server-side to a `TrustedIdentity`. A future
authentication provider replaces that mapping through the
`AuthenticationProvider` boundary.

The worker claims pending reminders transactionally and marks them delivered.
The SQLite adapter is the current development persistence implementation and
uses WAL mode and durable files. A production deployment should replace it
with Postgres/Supabase and a durable outbox/queue without changing the
runtime contract or use-case boundary.

The code does not require a Replit tab, interactive terminal, or in-memory
state to remain alive. Process supervision, restart policy, log collection,
metrics, and production queue hosting belong to the eventual deployment
environment.

## Inactive Hermes location

The future adapter location is:

```text
packages/runtime-hermes/
```

It currently contains only a README and an empty implementation marker. It is
not imported by application startup, API, worker, tests, or `pyproject.toml`
dependencies. The active implementation is:

```text
packages/agent_runtime/
```