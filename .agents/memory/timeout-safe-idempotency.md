---
name: Timeout-safe idempotency
description: The reliability boundary between browser timeouts and server-side write completion.
---

Same-key retries must join the original in-flight request before checking or executing the write path. A durable response lookup alone is insufficient because the first request can have completed a write while its final idempotency response is not stored yet.

**Why:** A browser timeout only ends the client wait; it does not prove that the server stopped. A new key or an uncoordinated retry can execute the same write twice, including when provider failover is still resolving.

**How to apply:** Scope the in-flight coordination by tenant, user, and idempotency key; keep the completed response persisted for retries after the in-flight window. Treat a timeout as an uncertain result in the UI, disable ordinary resubmission, and offer reconciliation with the original key.