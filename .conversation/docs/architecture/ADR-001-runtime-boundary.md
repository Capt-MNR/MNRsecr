# ADR-001: Keep the Agent Runtime Replaceable

**Status:** Accepted for architecture phase  
**Date:** 2026-09-11

## Context

The product needs natural-language orchestration, tools, persistent personal
context, proactive behavior, multiple model providers, Telegram/Android
channels, and cloud-first/local-ready deployment. Hermes Agent provides many
agent features, but its core state and isolation model is centered on
filesystem-backed profiles, sessions, and gateway processes.

Committing product state directly to Hermes would make provider changes,
runtime replacement, multi-user authorization, and structured Postgres
persistence harder later.

## Decision

The Personal AI OS will own a runtime-neutral `AgentRuntime` port. Hermes, if
used, will be implemented behind an adapter and will not define:

- tenant or user identity
- domain entities or transactions
- permissions or consent
- canonical memory
- product conversation identity
- scheduling ownership
- channel identity
- model/provider configuration exposed to application code

The first Hermes integration, if built, must be a bounded spike or adapter
with contract tests. Hermes source will not be vendored or forked during the
architecture phase.

## Consequences

### Positive

- domain and data architecture remain independent of Hermes
- Hermes can be evaluated with real tools and sessions without becoming the
  system of record
- cloud and local runtimes can share product contracts
- model providers can change without rewriting domain use cases
- tenant authorization remains server-derived and auditable

### Costs

- a translation layer and duplicate contracts must be maintained
- some Hermes capabilities may require explicit adapter work
- the first prototype may be slower than calling Hermes internals directly

## Exit criteria for reconsidering Hermes

Hermes may be promoted from experimental adapter only after a spike
demonstrates, with automated tests and security review:

1. tenant/user/session isolation under concurrent load
2. server-derived identity for every tool and memory operation
3. product authorization before every domain mutation and external side effect
4. bounded tool/MCP capabilities and secret isolation
5. durable retry/idempotency behavior
6. acceptable startup, memory, and horizontal-scaling costs
7. a maintainable integration surface that survives upstream upgrades
