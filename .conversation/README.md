# Personal AI OS

Production-oriented AI Personal Secretary / Personal AI OS.

This repository is the product source of truth. Replit is currently the
development environment; it is not assumed to be the permanent production
runtime. GitHub should remain the canonical remote and history for this
project.

## Current phase

The active product runtime is the
first-party runtime in `packages/agent_runtime/`; Hermes remains an inactive
future adapter and is not installed, imported, launched, or required.

The first product boundary is deliberately clear:

- The **Personal Secretary product** owns tenants, identity, permissions,
  structured personal context, domain workflows, persistence, and channel
  policy.
- An **Agent Runtime** is a replaceable execution dependency that interprets a
  request, selects tools, calls models, and returns an outcome.
- **Hermes Agent** is currently an evaluated candidate adapter, not the
  product architecture or system of record.

## Architecture documents

- [System architecture](docs/architecture/system-architecture.md)
- [Hermes Agent technical assessment](docs/architecture/hermes-agent-assessment.md)
- [Runtime boundary decision](docs/architecture/ADR-001-runtime-boundary.md)

## Planned domain

The canonical structured domain is expected to include:

`People`, `Projects`, `Expenses`, `Tasks`, `Commitments`, `Events`,
`Reminders`, `Memories`, `Relationships`, and `Permissions`.

The design also reserves room for proactive behavior, Telegram, Android, and
later assistant-to-assistant communication without making any of those
channels the domain model.

## Project layout

```text
apps/
  api/                 Product API and authentication boundary
  worker/              Durable jobs, proactive behavior, and scheduled work
packages/
  domain/              Entities, invariants, policies, and domain events
  application/         Use cases and orchestration independent of an agent
  agent-runtime/       Runtime-neutral port and lifecycle contracts
  runtime-hermes/      Optional Hermes adapter; no Hermes source is vendored
  llm/                 Provider-neutral model gateway contracts
  channels/            Telegram/Android/channel adapter contracts
  persistence/         Repository contracts and Postgres/Supabase adapters
  contracts/           API and event schemas
supabase/
  migrations/          Future Postgres schema and RLS migrations
infra/                 Cloud/local deployment definitions
docs/
  architecture/       Architecture, decisions, and verified investigations
tests/                 Contract, integration, and end-to-end tests
```

The first vertical slice uses a durable SQLite development adapter behind the
persistence boundary. A Postgres/Supabase adapter can replace it without
changing the domain or application use cases.

## Run the usable product locally

The API now serves the mobile-first web UI and the API from the same process:

```bash
python -m apps.api.main
```

Open `http://localhost:8000/` in a browser. From an Android phone on the same
network, use the computer's local network address, for example
`http://192.168.1.20:8000/`. The UI's default development token is
`dev-user`; custom development tokens can be entered in the UI or configured
with `DEV_AUTH_TOKENS`.

The API and worker remain separate processes when reminders should be polled:

```bash
python -m apps.worker.main
```

The API exposes `/healthz`, `/readyz`, `GET /v1/today` (also available as
`/v1/context`), and authenticated `POST /v1/turns`. Configure the database
location with `DATABASE_PATH`; the default is
`data/personal-ai-os.sqlite3`. Development requests use the server-side token
`Authorization: Bearer dev-user`; `DEV_AUTH_TOKENS` can provide a JSON mapping
of development tokens to trusted identities. The worker polls durable reminder
records and survives API or worker process restarts because state is persisted
outside runtime memory.

The web UI is intentionally vanilla HTML/CSS/JavaScript served by the API. It
does not contain domain logic, database access, provider configuration, or
provider credentials. The browser keeps only a conversation identifier and a
temporary session transcript for presentation; durable records are loaded from
`/v1/today`.

The development model provider remains deterministic and local. It supports the
Phase 1.3 examples for expenses, expense totals by project/person, project
people derived from persisted relationships, and reminders. Unsupported
natural-language requests return a clear "not understood" response rather than
creating data. Conversation rows are still not persisted by the Phase 1
runtime, as documented in the Phase 1.2 limitation.

The Postgres adapter is selected explicitly with
`PERSISTENCE_BACKEND=postgres` and `DATABASE_URL`. Apply the migrations through
Supabase/Postgres before starting that mode. SQLite remains the default
development adapter during the transition. Postgres integration tests require
an operator-provided `TEST_POSTGRES_DSN`; they are skipped when no test
database is configured. The Postgres reminder worker also requires the
trusted `WORKER_TENANT_ID` scope; worker reminder claims and delivery changes
are written to `audit_events` as service actions.

When running the API against Postgres, configure `DEV_AUTH_TOKENS` with UUID
tenant and user identities that exist in the migrated database. The built-in
`dev-user` identity is intended for the default SQLite development database.
