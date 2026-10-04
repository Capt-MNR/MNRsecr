---
name: Transactional trigger outbox
description: Phase 2 boundary for durable domain-trigger delivery and Agent Work handoff
---

The first proactive trigger uses a PostgreSQL-owned outbox row written in the same transaction as the domain mutation. The outbox is a delivery state machine, not `activity_events`: activity remains history/timeline data, while trigger rows carry leases, retries, quarantine, and fencing.

**Why:** A domain write must not appear committed while its proactive trigger is missing, and activity history must not acquire queue semantics. PostgreSQL must remain the source of truth without introducing an external bus.

**How to apply:** New trigger types should use tenant/owner-scoped database dedupe, claim/lease completion predicates that include the lease token, bounded retry with quarantine, and a deterministic evaluator that creates an Agent Work intent in the same transaction. Do not put LLM calls, notifications, or direct actions in the outbox dispatcher.

Dispatcher ticks claim from the shared queue across tenants, so parallel integration tests can consume another fixture's events. Assert the target event and tenant-scoped state rather than relying on aggregate tick counts.

**Why:** A concurrent test run let one dispatcher process a different test's event, making per-test counters look like duplicate delivery.

**How to apply:** Run database tests that call the global dispatcher serially, or assert the scoped outbox row, Work, and notification counts instead of summing `inspected` or `processed`.