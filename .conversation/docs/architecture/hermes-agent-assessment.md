# Hermes Agent — Technical Assessment

**Assessment status:** Initial verified investigation  
**Checked:** 2026-09-11  
**Repository:** [NousResearch/hermes-agent](https://github.com/NousResearch/hermes-agent)  
**Verified checkout:** `a3190625c0a2ed89ed33356ef8e3184e95dc08e5`  
**License observed:** MIT

This assessment is based on the repository checkout above and its first-party
documentation in the same repository. Hermes was inspected read-only in a
temporary directory. It was not installed into this project, modified, or
forked.

## Executive conclusion

Hermes is a capable **agent application and gateway** with a reusable Python
entry point, not a tenant-aware Personal Secretary runtime. It can provide a
strong experimental execution backend behind an adapter, especially for
tool-using conversations, provider routing, MCP, skills, messaging, and
automation.

It should not own this product's identity, structured personal context,
permissions, or system-of-record memory. The recommended direction is:

> **Build our own Personal Secretary Agent Runtime boundary and keep Hermes as
> an optional, replaceable adapter/reference. Do not fork Hermes now.**

Using Hermes directly as the server-side runtime for a multi-user SaaS product
would couple the product to filesystem profiles, process lifecycle, internal
Python modules, and Hermes' session/memory semantics before those semantics
have been proven for our domain.

## Repository and runtime structure

The current repository is a large Python application organized broadly as:

| Area | Observed responsibility |
|---|---|
| `agent/` | `AIAgent`, conversation/turn loop, prompt construction, compression, tool execution, session and memory hooks |
| `gateway/` | Long-running gateway, platform adapters, routing, authorization, session lifecycle, API server |
| `hermes_cli/` | CLI, config/home resolution, profiles, model setup, web/dashboard surfaces |
| `tools/` | Built-in tool registry, schemas, dispatch, toolsets, MCP tool plumbing |
| `providers/` and `plugins/model-providers/` | Provider profiles, runtime resolution, model-specific adapters |
| `plugins/memory/` | Optional external memory providers |
| `skills/` and `optional-skills/` | Bundled and optional `SKILL.md` procedural instructions |
| `cron/` | Scheduled job storage and scheduler |
| `website/docs/` | First-party user and developer documentation |
| `apps/desktop/` and `web/` | Desktop/web surfaces |

The documented Python entry point is `run_agent.AIAgent`, with `chat()` and
`run_conversation()`. The repository's own library guide says Hermes is
normally used from its editable checkout and does not publish a supported
wheel/source distribution for ordinary `requirements.txt` installation.

At a high level, a turn is:

1. gateway/API/CLI receives a message
2. a Hermes session and profile context are resolved
3. prompt layers, memory snapshot, skills, and tool schemas are assembled
4. the model provider is selected and called
5. tool calls are dispatched through the registry/MCP layer
6. the loop continues until a final response or failure
7. session state and optional memory-provider hooks are persisted

## Capability findings

### A. What Hermes can provide

| Requirement | Finding | Fit |
|---|---|---|
| Agent loop | Full multi-turn loop with tool calling, retries, compression, streaming, and session persistence | Strong |
| Model abstraction | Provider profiles/plugins, custom endpoints, runtime provider resolution, fallback/routing surfaces | Strong for generation |
| Target providers | Current provider plugins/docs include Google/Gemini, Alibaba/DashScope/Qwen variants, DeepSeek, OpenAI-compatible/custom endpoints, and many others | Strong, verify each model at integration time |
| Tools/function calling | Central registry with schemas, handlers, toolsets, availability checks, error bounding, command approval/guardrails | Strong execution substrate; not our authorization model |
| Skills | `SKILL.md` procedural instructions, bundled/optional skills, skill discovery and filtering, skill self-improvement workflows | Useful extension mechanism; not structured domain logic |
| MCP | stdio and remote HTTP MCP servers, automatic discovery, tool prefixing, per-server filtering, resource/prompt utilities, optional identity header from profile | Strong integration surface; security and tenant scoping remain ours |
| Subagents | Delegated isolated context/terminal sessions, roles, model selection, allowed toolsets, blocked tools, parent session and lifecycle/status contracts | Useful for bounded work; not tenant isolation by itself |
| Cron/automation | JSON-backed cron jobs, fresh agent sessions, attached skills, model pins, script-only jobs, platform delivery, recursion guard | Strong for agent-owned routines; product scheduler should remain canonical |
| Messaging | Gateway adapters for Telegram, Discord, Slack, WhatsApp, Signal, email, webhooks, and others, with routing and authorization features | Strong channel reference/accelerator |
| API surface | OpenAI-compatible API server plus run/session endpoints and streaming; Python `AIAgent` import path | Useful for experiments and an adapter prototype |
| Local/cloud execution | Local, container, SSH, and several remote/sandbox terminal backends; configurable model endpoints | Good alignment with cloud-first/local-ready goals |

### B. What Hermes does not provide for this product

1. **Canonical personal domain model.** Hermes has sessions, profiles,
   memories, skills, tools, and messages. It does not provide our
   tenant-aware People/Projects/Expenses/Tasks/Commitments/Events/
   Reminders/Relationships/Permissions model.
2. **Product-owned authorization.** Hermes has platform allowlists, pairing,
   command approval, toolsets, and tool blocking. These control agent
   capabilities, not row-level access to a user's personal graph or consent
   to specific external actions.
3. **A SaaS tenant boundary.** Its primary isolation primitive is a separate
   Hermes home/profile, with filesystem/config/env/session state and generally
   a separate agent/gateway lifecycle.
4. **A Postgres/Supabase system of record.** Hermes' core session storage is
   SQLite/FTS5 and its built-in memory is files. External memory plugins can
   connect to other stores, but they are plugin-specific and not our domain
   schema.
5. **A generic embedding service contract.** Embeddings/vector search appear
   in particular memory integrations and optional workflows, but Hermes does
   not expose a product-level, provider-neutral embedding port that should
   become our memory architecture.
6. **Domain-grade provenance and lifecycle.** Canonical facts need source,
   confidence, temporal validity, visibility, correction, and audit semantics.
   Prompt memory files and session recall are not a substitute.
7. **Android or assistant-to-assistant product protocols.** Hermes has channel
   adapters and an A2A-related messaging surface, but those are not the
   product's future device and agent identity contracts.

## Detailed findings

### Memory implementation

The built-in memory is intentionally small and curated:

- `MEMORY.md`: 2,200-character limit
- `USER.md`: 1,375-character limit
- stored under the active Hermes home at `memories/`
- loaded into the system prompt as a frozen snapshot at session start
- writes happen through the `memory` tool and are not reflected in the current
  system prompt until a later session

Hermes explicitly warns against two processes sharing one home because memory
writes are automatic and can compound. Named profiles give each agent its own
config, `.env`, memories, skills, sessions, cron state, and database.

The `MemoryProvider` plugin contract is more extensible. It receives values
such as `hermes_home`, `platform`, `session_id`, and optional `user_id`, and
providers such as RetainDB, Mem0, Hindsight, Supermemory, and OpenViking can
use external stores. However:

- only one external memory provider is selected at a time
- identity/scoping semantics are provider-specific
- the contract does not define our entities, permissions, provenance, or
  Postgres row-level policy
- built-in memory remains profile/file-oriented

**Assessment:** useful context recall, insufficient as the Personal AI OS
system of record. Product memory should be canonical in our own service and
projected into any runtime.

### Tools and function calling

Hermes self-registers tools into a central registry. Tool schemas are exposed
to the model, tool calls are dispatched, and toolsets/availability checks
control what a session sees. It also has command approval and terminal
backends.

This is a good execution mechanism for an adapter, but it is intentionally
powerful: terminal, file, browser, network, and external integration tools
may be available. For our product, a domain tool must be a thin adapter to an
authorized application use case:

```text
model -> runtime tool -> product authorization -> domain use case -> database
```

We should not expose raw Hermes tools or arbitrary MCP servers to an
untrusted multi-user SaaS session by default.

### Skills

Skills use `SKILL.md` files with frontmatter, instructions, requirements, and
tool dependencies. They are procedural context and can be bundled, optional,
discovered, or installed from supported sources.

Skills are appropriate for reusable procedures such as “prepare a weekly
review.” They are not a safe replacement for executable domain invariants,
permissions, or database transactions. Product-owned skills should call our
application tools rather than contain direct credentials or unrestricted
filesystem assumptions.

### MCP

Hermes supports local stdio and remote HTTP MCP servers, discovers their
tools, prefixes names to avoid collisions, and supports per-server filtering.
The configuration also documents an optional identity header whose value can
come from a profile.

This is valuable for integration experiments. It is not evidence that
per-request tenant identity and authorization are enforced end-to-end. The
product must own MCP server selection, credential binding, tool allowlists,
approval policy, timeout/cancellation, and audit. A remote MCP server should
receive a server-derived identity context, never an identity chosen by model
output.

### Subagents

Hermes supports delegated subagents with isolated context and terminal
sessions. The public lifecycle request includes a goal, context, role, model,
allowed toolsets, blocked tools, working directory, parent session, metadata,
and timeout.

That is a useful primitive for parallel research or bounded background work.
The documented restrictions on leaf subagents also block several high-impact
tools such as memory, messaging, cron management, and delegation. Isolation
here means execution/context separation; it does not by itself prove
tenant-level data isolation, database authorization, or secret separation.
Our runtime must carry and enforce tenant/user/tool-policy context for every
child.

### Cron and proactive automation

Hermes cron jobs are stored per profile and execute in a fresh agent session:
they do not inherit prior conversation history, and cron recursion is guarded.
Jobs can attach skills, run scripts without an agent, pin models, and deliver
to supported platforms.

This maps well to agent routines, but product reminders and commitments need
durable ownership, time zones, deduplication, retries, consent, and audit in
our own scheduler. Hermes cron can be an adapter target, not the canonical
reminder system.

### Messaging integrations

The gateway has many platform adapters and handles routing, session
continuity, DM authorization/pairing, and delivery. Profiles can have
separate bot tokens and gateways, and profile routes can map platform
identities to profiles.

This is useful infrastructure to learn from. A product gateway still needs a
canonical account/user/channel identity mapping outside profile names, plus
webhook verification, replay protection, channel ownership, and per-action
consent.

### Model/provider abstraction

The provider system is one of Hermes' strongest fit areas. It resolves
provider/model settings, credentials, API modes, custom endpoints, and
provider-specific request behavior through profiles/plugins. The current docs
cover cloud and self-hosted endpoints, and the repository includes plugins for
many provider families.

We should still put a product-owned `ModelGateway` port in front of it. That
preserves the ability to change providers, route different tasks to different
models, meter usage, redact data, and select a local endpoint without
exposing Hermes' provider config to the rest of the product.

### API and embedding possibilities

Hermes has an OpenAI-compatible HTTP API and can be imported as a Python
library through `AIAgent`. The first-party library documentation describes
editable-checkout usage and explicitly says there is no supported wheel or
source distribution for ordinary `requirements.txt` installation.

That makes it viable as an isolated service/adapter experiment, but risky as a
deep in-process dependency on internal modules. The product should prefer a
small adapter process or a narrow integration module with contract tests if
Hermes is tested.

Hermes' session search uses SQLite FTS5. Embedding/vector behavior is found in
specific optional memory integrations (for example Mem0 or provider-specific
memory backends), not as a universal core API. We should own a memory/retrieval
port and choose Postgres/pgvector or another backend independently.

### Licensing

The checked repository contains an MIT license dated 2025 and identifies Nous
Research as copyright holder. MIT permits commercial use, modification, and
distribution subject to its notice/permission conditions. A production
decision must still review transitive dependencies, optional MCP servers,
skills, model SDKs, and any hosted-service terms separately.

## Multi-user SaaS isolation assessment

| Isolation requirement | Hermes evidence | Decision |
|---|---|---|
| Separate config/secrets | Per-profile `config.yaml` and `.env`; profile-scoped secret handling exists | Possible, but operationally heavy |
| Separate memory | Per-profile files; external providers can accept `user_id` | Possible only with strict adapter/provider discipline |
| Separate sessions | Per-profile SQLite state and session identifiers; API supports session headers | Partial; product auth must own the mapping |
| Separate tools | Toolsets, blocked tools, profile overlays, MCP filtering | Partial; domain authorization still required |
| Separate model policy | Profiles and per-request model/provider options | Partial; product policy and metering still required |
| Separate permissions | Gateway allowlists/pairing/approvals | Insufficient for domain row/action permissions |
| Dynamic tenant lifecycle | Profiles are directories/process/gateway units | Not a natural SaaS tenant primitive |
| Strong request identity | API server uses bearer `API_SERVER_KEY`; session key is a header | Insufficient as a product identity model |
| Durable cloud data | SQLite/files plus optional providers | Insufficient as product system of record |
| Horizontal scaling | Some multi-profile/process support exists | Requires substantial external orchestration and fencing |

The API server's bearer key is a gateway credential, not a built-in account
directory. Profile-prefixed routes can select a profile, but profile selection
does not replace server-side authorization for a user-owned graph. The
`X-Hermes-Session-Key` and `X-Hermes-Session-Id` headers help Hermes scope and
continue conversations; they should not be treated as the Personal AI OS
tenant boundary.

## C. Integration risks

1. **State coupling:** profile directories combine secrets, prompt identity,
   memory, skills, sessions, cron, logs, and workspace state.
2. **Concurrency and lifecycle:** Hermes documentation warns against multiple
   writers sharing a home. A SaaS deployment would need one carefully fenced
   runtime home per isolated unit, or a redesigned persistence layer.
3. **Security blast radius:** terminal and MCP tools can perform powerful
   actions. A profile/toolset boundary is not equivalent to a per-user
   policy engine.
4. **Identity confusion:** platform IDs, profile IDs, session keys, and
   external-provider `user_id` values are different concepts. An adapter must
   derive and bind them explicitly.
5. **Upstream churn:** direct use of `agent/`, `gateway/`, and `hermes_cli/`
   internals would create a high-maintenance coupling surface.
6. **Packaging:** no supported standalone wheel/source distribution means
   upgrades and reproducible deployment need a repository checkout or a
   separately maintained packaging strategy.
7. **Memory semantics:** small frozen snapshots and provider-specific external
   memory are not enough for a structured personal graph.
8. **Operational duplication:** Hermes gateway, cron, sessions, and product
   API/worker would each want ownership of retries, delivery, lifecycle, and
   audit unless the boundary is explicit.
9. **License/dependency review:** MIT is favorable, but every selected
   optional integration and transitive dependency still needs review.

## D. Recommendation

### Recommended: build our own Agent Runtime boundary; use Hermes only as an optional adapter/reference

Implement the Personal AI OS around the runtime-neutral contract in
[system-architecture.md](system-architecture.md). Then, if useful, add a
Hermes adapter that:

- launches Hermes in an isolated, explicitly owned execution context
- exposes only product-approved tools
- injects a server-created context snapshot
- maps Hermes sessions to product conversations
- writes canonical domain changes through product use cases
- treats Hermes memory as a cache/projection
- records tool calls, approvals, failures, and model usage
- can be removed without changing the domain or database

### Not recommended now

- **Using Hermes directly:** too much product state and tenant policy would
  leak into Hermes profiles and internal lifecycle.
- **Forking Hermes:** premature; it would make upstream synchronization and
  security ownership our problem before we know which changes are required.

### Conditional future options

- Hermes may be a good **internal/single-user or tightly controlled beta
  backend** after an isolation proof-of-concept.
- A fork becomes reasonable only if a bounded, upstream-independent runtime
  contract has been proven and Hermes is demonstrably the best engine for it.
- If Hermes cannot meet the adapter contract without invasive patches, use it
  as a reference for tools, gateway, and provider ideas and build the runtime
  ourselves.

## Verification limits

This is a source and documentation assessment, not a production penetration
test, load test, or multi-tenant proof. The following remain to be tested in a
future isolated spike:

- concurrent requests for many tenants
- process/profile startup and memory cost
- child-process and MCP secret isolation
- session/key authorization under adversarial inputs
- failover and horizontal scaling
- provider/model behavior for the exact Gemini, Qwen, DeepSeek, and OpenAI
  models selected later
