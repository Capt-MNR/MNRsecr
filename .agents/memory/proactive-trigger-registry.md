---
name: Proactive trigger registry
description: The extensibility rule established by the proactive architecture stress test.
---

New proactive trigger types should register a deterministic evaluator by event type and aggregate type. The dispatcher should only claim, fence, retry, quarantine, and hand off the evaluator's WorkIntent; it should not gain a source-specific branch for each new trigger.

**Why:** Deadline/version and threshold/state transitions both reused the same PostgreSQL outbox and Agent Work handoff. Keeping eligibility in a registry made the dispatcher trigger-agnostic while preserving stable dedupe keys for collision handling.

**How to apply:** Keep trigger-specific stale/version/state checks and WorkIntent dedupe-key construction in the evaluator module. Keep domain writes and their outbox rows transactional, and keep execution/recovery in Agent Work.