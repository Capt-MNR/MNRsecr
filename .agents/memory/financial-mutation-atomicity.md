---
name: Financial mutation atomicity
description: Transaction boundary and test expectations for approved graph mutations
---

Approved domain mutations must execute their persistence and activity-event insert through the same transaction-aware executor. An activity writer failure is a mutation failure, not a warning; successful mutation completion must imply the event exists.

**Why:** A best-effort activity write can leave the graph state and audit/timeline state inconsistent, which is especially harmful for approved financial changes and later corrections.

**How to apply:** Inject a failing activity writer in tests and assert both domain rows and activity rows are absent; also test the successful pair and preserve the executor injection when adding new mutation tools.