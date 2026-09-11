# Personal AI OS — System Architecture

**Status:** Proposed  
**Scope:** Initial cloud-first product, local-ready deployment model  
**Date:** 2026-09-11

## 1. Architectural position

The product is a personal operating system, not a chat surface. Natural
language is an input to domain operations; it is not the storage model.

The durable source of truth is the product's own structured data layer:

- tenant/account and user identity
- people and relationships
- projects and tasks
- expenses and commitments
- events and reminders
- memories with provenance and lifecycle
- permissions, consent, and tool grants
- conversations, turns, tool calls, and audit records

An agent runtime may propose actions and invoke approved capabilities, but it
must not become the owner of these records.

## 2. Logical layers

```text
Channels
  Telegram | Android | Web/API | future assistant-to-assistant
                              |
                              v
Product API / Identity / Tenant Context
  authentication, authorization, rate limits, idempotency, audit
                              |
                              v
Application Use Cases
  capture task | record expense | schedule reminder | resolve person
  update commitment | recall context | approve/send external action
                              |
              +---------------+----------------+
              |                                |
              v                                v
Domain + Policy                         Agent Runtime Port
entities, invariants,                   turn execution, tool selection,
permissions, domain events               model calls, structured outcome
              |                                |
              v                                v
Structured Persistence                   Runtime Adapters
Supabase/Postgres + RLS                  Hermes (optional), own runtime,
object storage, event log                future local runtime
              |
              v
Durable Jobs / Proactive Scheduler
  reminders, follow-ups, digests, integrations, assistant messages
```

The runtime is below the application boundary, not above it. A runtime tool
such as `create_task` should call an application use case that enforces the
current user's permissions and writes the domain record. It should never write
directly to arbitrary tables.

## 3. Runtime-neutral contract

The first implementation should define a narrow port before selecting an
engine. The contract should carry an explicit immutable execution context:

```text
TurnRequest
  tenant_id
  user_id
  conversation_id
  turn_id / idempotency_key
  channel
  user_message
  allowed_capabilities
  model_policy
  memory_snapshot or memory_query handle
  deadline / cancellation

TurnResult
  assistant_message
  proposed_actions
  committed_actions
  referenced_entities
  memory_operations
  tool_trace
  usage
  provider/runtime metadata
  warnings and failure classification
```

The contract must not expose Hermes classes, `HERMES_HOME`, Hermes session
files, Hermes tool names, or Hermes-specific message metadata. An adapter may
translate those details internally.

### Required runtime invariants

1. Every request has a server-derived tenant and user context. The model
   cannot choose either value.
2. Every tool call receives the same context and is authorized again at the
   application boundary.
3. Runtime memory is a read/write projection of canonical product memory, not
   the only copy.
4. Conversation/session identifiers are opaque product identifiers. Runtime
   session IDs are implementation details.
5. A retry is idempotent or rejected with a durable outcome; external sends
   cannot be duplicated silently.
6. The runtime can be replaced while preserving conversations, domain records,
   memories, permissions, and channel connections.

## 4. Persistence strategy

Supabase/Postgres is the planned structured persistence layer. The schema
should be designed around tenant ownership and row-level authorization from the
start, even while the application is running in Replit:

- every user-owned record carries an account/tenant boundary
- relationships and commitments are first-class records, not prompt text
- memories have source, confidence, timestamps, visibility, and provenance
- permissions are explicit capabilities with scope, expiry, and audit history
- domain events support proactive workers without requiring the agent to poll
  chat transcripts

The runtime may use a short-lived context projection for prompt assembly, but
the projection must be reconstructable from Postgres and recorded sources.

## 5. Cloud-first, local-ready deployment

The same application ports should support:

- **Cloud:** managed Postgres/Supabase, queue/worker infrastructure, hosted
  model APIs, webhook-based channels.
- **Local/self-hosted later:** local Postgres-compatible storage, local queue,
  Ollama/vLLM or another OpenAI-compatible endpoint, local channel bridges,
  and GPU-hosted model services.

Provider configuration belongs in deployment/runtime configuration, never in
domain code. The product should be able to select Gemini, Qwen, DeepSeek, or
OpenAI through a provider-neutral model gateway without changing use cases.

## 6. What is intentionally deferred

- Android implementation
- production API implementation
- final provider selection
- exact queue/orchestration technology
- assistant-to-assistant protocol
- Hermes source changes or vendoring
