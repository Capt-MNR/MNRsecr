---
name: Proactive engine boundary
description: Architectural audit conclusion for proactive triggers, Agent Work execution, and PostgreSQL event delivery.
---

The proactive engine should evolve by separating trigger/rule eligibility from Agent Work execution and recovery, while keeping PostgreSQL as the initial coordination layer.

**Why:** Agent Work already provides durable tenant-scoped work, leases, idempotency, evidence, approval recovery, and notification outbox integration. The current coupling is mainly that the runner also owns source/rule special cases. `activity_events` is an audit/timeline projection without consumer cursors, claim state, or a generic delivery contract, so treating it as a trigger queue would create correctness and recovery gaps.

**How to apply:** Keep time polling and the existing Agent Work safety machinery. Introduce event-trigger delivery through a separate transactional outbox and a deterministic Trigger/Rule evaluator; emit durable work intents into Agent Work. Defer an external queue or scheduler until measured throughput, fairness, or latency requires it. Do not use an LLM per polling tick.