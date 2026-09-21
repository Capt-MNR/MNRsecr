---
name: Agent Work runner boundary
description: Safety and identity rules for background Agent Work execution.
---

Background Agent Work execution must discover due rows from durable tenant-scoped Work records, resolve each identity through the configured background identity adapter, claim a lease with an idempotency key, and complete only with the same lease. Evidence is bounded and redacted; unsupported sources become `needs_review` rather than simulated success.

**Why:** A scheduler request has no trustworthy user header or single tenant, and treating an existing active claim as permission to process can duplicate side effects. Unknown external sources cannot be verified safely.

**How to apply:** Keep the runner disabled by default outside development until production identity and explicitly allowlisted read-only source adapters are available. Add each new source as a narrow executor with evidence and failure semantics.